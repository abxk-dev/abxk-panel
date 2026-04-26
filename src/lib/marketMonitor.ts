import cron from "node-cron"
import { sendTelegram } from "@/lib/telegram"
import { computeNewsStatus, fetchForexFactoryWeek, type NewsStatus } from "@/lib/newsFilter"
import { formatSentimentTelegram, getCombinedSentiment } from "@/lib/sentiment"

export type MonitorFlags = {
  pauseAllUntil?: number
  longsBlockedUntil?: number
  shortsBlockedUntil?: number
  note?: string
}

export type MarketMonitorSummary = {
  started: boolean
  updatedAt: number
  flags: MonitorFlags
  news?: NewsStatus
  lastWhaleAlertAt?: number
  lastFearGreedAlertAt?: number
  lastFlashMoveAt?: number
  lastFundingAlertAt?: number
  lastOiAlertAt?: number
}

type Runtime = {
  started: boolean
  summary: MarketMonitorSummary
  lastWhaleTxId?: string
  lastFngState?: "FEAR" | "GREED" | "OK"
  lastFundingState?: "HIGH" | "OK"
  lastOi?: { value: number; at: number }
  lastFlashKey?: string
  lastNewsState?: NewsStatus["state"]
  lastNewsEventId?: string
  lastNewsUpcomingEventId?: string
  lastSentimentReportAt?: number
}

const g = globalThis as unknown as {
  __abxkMonitor?: Runtime
  __abxkCommand?: { paused?: boolean; skipOnce?: boolean; updatedAt?: number }
  __abxkSnapshot?: { timeframe?: string; symbol?: string; settings?: any }
}

function runtime(): Runtime {
  if (g.__abxkMonitor) return g.__abxkMonitor
  const r: Runtime = {
    started: false,
    summary: {
      started: false,
      updatedAt: Date.now(),
      flags: {}
    }
  }
  g.__abxkMonitor = r
  return r
}

function setFlags(next: Partial<MonitorFlags>) {
  const r = runtime()
  r.summary.flags = { ...r.summary.flags, ...next }
  r.summary.updatedAt = Date.now()
}

function clearExpiredFlags() {
  const now = Date.now()
  const flags = { ...runtime().summary.flags }
  if (flags.pauseAllUntil && now >= flags.pauseAllUntil) delete flags.pauseAllUntil
  if (flags.longsBlockedUntil && now >= flags.longsBlockedUntil) delete flags.longsBlockedUntil
  if (flags.shortsBlockedUntil && now >= flags.shortsBlockedUntil) delete flags.shortsBlockedUntil
  runtime().summary.flags = flags
  runtime().summary.updatedAt = now
}

function setPaused(paused: boolean) {
  const cur = g.__abxkCommand ?? {}
  g.__abxkCommand = { ...cur, paused, updatedAt: Date.now() }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function whaleCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.whaleAlert === true
  const notify = settings?.notifications?.whale !== false
  if (!enabled || !notify) return

  const key = process.env.WHALE_ALERT_API_KEY
  if (!key) return

  const start = Math.floor((Date.now() - 15 * 60_000) / 1000)
  const url = `https://api.whale-alert.io/v1/transactions?api_key=${encodeURIComponent(
    key
  )}&start=${encodeURIComponent(start)}&min_value=500000&currency=btc,eth`

  const data = await fetchJson(url)
  const txs: any[] = Array.isArray(data?.transactions) ? data.transactions : []
  if (txs.length === 0) return
  txs.sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))
  const tx = txs[0]
  const id = String(tx?.id ?? tx?.hash ?? `${tx?.timestamp}-${tx?.symbol}-${tx?.amount_usd}`)
  const r = runtime()
  if (r.lastWhaleTxId === id) return

  const amountUsd = Number(tx?.amount_usd ?? 0)
  const symbol = String(tx?.symbol ?? "").toUpperCase()
  const to = String(tx?.to?.owner ?? tx?.to?.address ?? "Unknown wallet")
  const toType = String(tx?.to?.owner_type ?? "")
  const exchangeInflow = toType.toLowerCase().includes("exchange")

  r.lastWhaleTxId = id
  r.summary.lastWhaleAlertAt = Date.now()
  r.summary.updatedAt = Date.now()

  const amountM = amountUsd > 0 ? (amountUsd / 1_000_000).toFixed(0) : "0"
  const toLabel = to.toLowerCase().includes("binance")
    ? "Binance"
    : to.toLowerCase().includes("coinbase")
      ? "Coinbase"
      : to.toLowerCase().includes("okx")
        ? "OKX"
        : to.toLowerCase().includes("bybit")
          ? "Bybit"
          : exchangeInflow
            ? "Exchange"
            : "Unknown"

  const msg = `🐋 <b>WHALE ALERT</b>
━━━━━━━━━━━━━━
$${amountM}M ${symbol} → ${escapeHtml(toLabel)}
Possible sell pressure
Bot: Longs blocked 1 candle`

  setFlags({ longsBlockedUntil: Date.now() + 4 * 60 * 60_000, note: "Whale inflow" })
  await sendTelegram(msg).catch(() => undefined)
}

async function fearGreedCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.marketMonitor !== false
  const notify = settings?.notifications?.marketMonitor !== false
  if (!enabled || !notify) return

  const data = await fetchJson("https://api.alternative.me/fng/")
  const score = Number(data?.data?.[0]?.value)
  if (!Number.isFinite(score)) return
  const r = runtime()

  if (score < 20) {
    if (r.lastFngState !== "FEAR") {
      r.lastFngState = "FEAR"
      r.summary.lastFearGreedAlertAt = Date.now()
      r.summary.updatedAt = Date.now()
      await sendTelegram(
        `😱 <b>EXTREME FEAR: ${score}</b>
━━━━━━━━━━━━━━
Historical buy zone
Bot: Long bias activated`
      ).catch(() => undefined)
    }
    return
  }
  if (score > 80) {
    if (r.lastFngState !== "GREED") {
      r.lastFngState = "GREED"
      r.summary.lastFearGreedAlertAt = Date.now()
      r.summary.updatedAt = Date.now()
      setFlags({ longsBlockedUntil: Date.now() + 6 * 60 * 60_000, note: "Extreme greed" })
      await sendTelegram(
        `🤑 <b>EXTREME GREED: ${score}</b>
━━━━━━━━━━━━━━
Historical sell zone
Bot: Longs blocked 1 candle`
      ).catch(() => undefined)
    }
    return
  }

  if (r.lastFngState !== "OK") {
    r.lastFngState = "OK"
    r.summary.updatedAt = Date.now()
  }
}

type Kline = { openTime: number; close: number }

function parseKlines(raw: any): Kline[] {
  const rows: any[] = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : raw?.data?.data ?? []
  const out: Kline[] = []
  for (const r of rows) {
    if (Array.isArray(r)) {
      const openTime = Number(r[0])
      const close = Number(r[4])
      if (Number.isFinite(openTime) && Number.isFinite(close)) out.push({ openTime, close })
    }
  }
  return out.sort((a, b) => a.openTime - b.openTime)
}

async function flashMoveCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.marketMonitor !== false
  const notify = settings?.notifications?.marketMonitor !== false
  if (!enabled || !notify) return

  const url = `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=BTC-USDT&interval=5m&limit=10`
  const data = await fetchJson(url)
  const candles = parseKlines(data)
  if (candles.length < 4) return
  const last = candles[candles.length - 1]
  const back = candles[candles.length - 4]
  const pct = back.close > 0 ? ((last.close - back.close) / back.close) * 100 : 0
  const key = `${back.openTime}-${last.openTime}-${Math.round(pct * 100) / 100}`
  const r = runtime()
  if (r.lastFlashKey === key) return
  if (Math.abs(pct) < 3) return

  r.lastFlashKey = key
  r.summary.lastFlashMoveAt = Date.now()
  r.summary.updatedAt = Date.now()
  setFlags({ pauseAllUntil: Date.now() + 30 * 60_000, note: "Flash move" })
  setPaused(true)

  const msg = `🚨 <b>FLASH MOVE DETECTED</b>
━━━━━━━━━━━━━━
BTC: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% in 15 minutes
⛔ All trades PAUSED
Reason: Extreme volatility
Resume: After 2 stable candles`

  await sendTelegram(msg).catch(() => undefined)
}

async function fundingCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.marketMonitor !== false
  const notify = settings?.notifications?.marketMonitor !== false
  if (!enabled || !notify) return

  const data = await fetchJson("https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex?symbol=BTC-USDT")
  const row = data?.data ?? data
  const rate = Number(row?.lastFundingRate ?? row?.fundingRate ?? row?.fundingRatePercent)
  if (!Number.isFinite(rate)) return
  const pct = rate * 100
  const r = runtime()
  if (pct > 0.08) {
    if (r.lastFundingState !== "HIGH") {
      r.lastFundingState = "HIGH"
      r.summary.lastFundingAlertAt = Date.now()
      r.summary.updatedAt = Date.now()
      setFlags({ longsBlockedUntil: Date.now() + 60 * 60_000, note: "High funding" })
      await sendTelegram(
        `💸 <b>HIGH FUNDING RATE ALERT</b>\nBTC Funding: ${pct.toFixed(
          2
        )}%\n⚠️ Longs paying heavy premium\n📉 Historical: Dump often follows\n🛑 Bot: Longs blocked until < 0.03%`
      ).catch(() => undefined)
    }
    return
  }
  if (pct < 0.03 && r.lastFundingState === "HIGH") {
    r.lastFundingState = "OK"
    r.summary.updatedAt = Date.now()
    setFlags({ longsBlockedUntil: undefined })
  }
}

async function oiCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.marketMonitor !== false
  const notify = settings?.notifications?.marketMonitor !== false
  if (!enabled || !notify) return

  const data = await fetchJson("https://open-api.bingx.com/openApi/swap/v2/quote/openInterest?symbol=BTC-USDT")
  const row = data?.data ?? data
  const oi = Number(row?.openInterest ?? row?.oi)
  if (!Number.isFinite(oi)) return

  const r = runtime()
  const prev = r.lastOi
  r.lastOi = { value: oi, at: Date.now() }
  if (!prev || Date.now() - prev.at < 55 * 60_000) return

  const dropPct = prev.value > 0 ? ((oi - prev.value) / prev.value) * 100 : 0
  if (dropPct > -10) return

  r.summary.lastOiAlertAt = Date.now()
  r.summary.updatedAt = Date.now()
  setFlags({ pauseAllUntil: Date.now() + 4 * 60 * 60_000, note: "OI liquidation" })
  setPaused(true)

  await sendTelegram(
    `📊 <b>MASS LIQUIDATION DETECTED</b>\nOI dropped: ${dropPct.toFixed(
      2
    )}% in 1H\n💥 Large positions wiped\n⏸ Bot paused: Waiting for stability\nResume: Next 4H candle`
  ).catch(() => undefined)
}

const watchlist = [
  "US CPI",
  "CORE CPI",
  "FOMC",
  "RATE DECISION",
  "FED CHAIR",
  "SPEECH",
  "NON-FARM",
  "NFP",
  "GDP",
  "UNEMPLOYMENT",
  "PPI",
  "RETAIL SALES"
]

function isWatchedEvent(title: string): boolean {
  const t = title.toUpperCase()
  return watchlist.some((k) => t.includes(k))
}

async function newsCheck() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.newsFilter !== false
  const notify = settings?.notifications?.marketMonitor !== false
  if (!enabled) return

  const now = Date.now()
  const raw = await fetchForexFactoryWeek()
  const status = computeNewsStatus({
    eventsRaw: raw,
    now,
    blackoutMinutes: Number(settings?.thresholds?.newsBlackoutMinutes ?? 30),
    currencies: ["USD", "BTC"],
    impact: "High"
  })

  const r = runtime()
  r.summary.news = status
  r.summary.updatedAt = Date.now()

  if (status.state === "UPCOMING" && isWatchedEvent(status.event.title)) {
    const mins = Math.floor((status.startsAt - now) / 60_000)
    if (mins <= 30 && r.lastNewsUpcomingEventId !== status.event.id) {
      r.lastNewsUpcomingEventId = status.event.id
      if (notify) {
        await sendTelegram(
          `⚠️ <b>NEWS BLACKOUT STARTING SOON</b>\n━━━━━━━━━━━━━━\nEvent: ${escapeHtml(
            status.event.title
          )}\nTime: ${new Date(status.event.time).toUTCString()} (30 min)\nImpact: HIGH\n⛔ No new trades after: ${new Date(
            status.startsAt
          ).toUTCString()}\n📋 Current open trades: monitored`
        ).catch(() => undefined)
      }
    }
  }

  if (status.state === "ACTIVE" && isWatchedEvent(status.event.title)) {
    if (r.lastNewsEventId !== status.event.id || r.lastNewsState !== "ACTIVE") {
      r.lastNewsState = "ACTIVE"
      r.lastNewsEventId = status.event.id
      setFlags({ pauseAllUntil: status.endsAt, note: "News blackout" })
      setPaused(true)
      if (notify) {
        await sendTelegram(
          `⛔ <b>NEWS BLACKOUT</b>
━━━━━━━━━━━━━━
Event: ${escapeHtml(status.event.title)}
Time: NOW
Trading: BLOCKED
Resume: ~${Math.max(1, Math.round((status.endsAt - now) / 60_000))} minutes`
        ).catch(() => undefined)
      }
    }
    return
  }

  if (r.lastNewsState === "ACTIVE" && status.state !== "ACTIVE") {
    r.lastNewsState = status.state
    setPaused(false)
    if (notify) {
      await sendTelegram(
        `✅ <b>NEWS BLACKOUT LIFTED</b>\n${escapeHtml(
          r.lastNewsEventId ? "News released" : "News window ended"
        )}\nMarket: Stabilizing\n⏳ Bot resumes in: 2 candles\nTrading: ALLOWED`
      ).catch(() => undefined)
    }
  }
}

export function startMarketMonitor() {
  const r = runtime()
  if (r.started) return
  r.started = true
  r.summary.started = true
  r.summary.updatedAt = Date.now()

  cron.schedule("*/5 * * * *", async () => {
    clearExpiredFlags()
    await whaleCheck().catch(() => undefined)
    await flashMoveCheck().catch(() => undefined)
    await newsCheck().catch(() => undefined)
  })

  cron.schedule("0 */6 * * *", async () => {
    await fearGreedCheck().catch(() => undefined)
    await sentimentReport().catch(() => undefined)
  })

  cron.schedule("0 * * * *", async () => {
    await fundingCheck().catch(() => undefined)
    await oiCheck().catch(() => undefined)
  })
}

async function sentimentReport() {
  const snap = g.__abxkSnapshot
  const settings = snap?.settings ?? {}
  const enabled = settings?.features?.sentiment === true
  const notify = settings?.notifications?.sentiment !== false
  if (!enabled || !notify) return

  const r = runtime()
  const now = Date.now()
  if (r.lastSentimentReportAt && now - r.lastSentimentReportAt < 5.5 * 60 * 60_000) return

  const combined = await getCombinedSentiment()
  r.lastSentimentReportAt = now
  r.summary.updatedAt = now
  await sendTelegram(formatSentimentTelegram(combined)).catch(() => undefined)
}

export function getMarketMonitorSummary(): MarketMonitorSummary {
  clearExpiredFlags()
  return runtime().summary
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
