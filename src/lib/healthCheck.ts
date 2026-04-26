import WebSocket from "ws"
import cron from "node-cron"
import zlib from "zlib"
import { bingxRequest } from "@/lib/bingx"
import { sendTelegram } from "@/lib/telegram"

export type HealthState = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CRITICAL"

export type HealthSummary = {
  state: HealthState
  apiLatencyMs?: number
  wsConnected: boolean
  lastWsMessageAt?: number
  authConfigured: boolean
  authOk?: boolean
  lastAuthAt?: number
  lastAuthError?: string
  balanceUsd?: number
  lastBalanceAt?: number
  orderFailuresLastHour: number
  updatedAt: number
  history: { time: number; state: HealthState; message: string }[]
}

type OrderAttempt = { time: number; ok: boolean }

type HealthRuntime = {
  started: boolean
  ws?: WebSocket
  wsRetries: number
  orderAttempts: OrderAttempt[]
  summary: HealthSummary
  lastCriticalAt?: number
}

const g = globalThis as unknown as {
  __abxkHealth?: HealthRuntime
  __abxkCommand?: { paused?: boolean; skipOnce?: boolean; updatedAt?: number }
  __abxkSnapshot?: { settings?: any }
}

function runtime(): HealthRuntime {
  if (g.__abxkHealth) return g.__abxkHealth
  const r: HealthRuntime = {
    started: false,
    wsRetries: 0,
    orderAttempts: [],
    summary: {
      state: "UNKNOWN",
      wsConnected: false,
      authConfigured: false,
      orderFailuresLastHour: 0,
      updatedAt: Date.now(),
      history: []
    }
  }
  g.__abxkHealth = r
  return r
}

function setState(next: Partial<HealthSummary>) {
  const r = runtime()
  r.summary = { ...r.summary, ...next, updatedAt: Date.now() }
}

function pushHistory(state: HealthState, message: string) {
  const r = runtime()
  r.summary.history = [{ time: Date.now(), state, message }, ...r.summary.history].slice(0, 50)
}

async function pingApi(): Promise<{ ok: boolean; latencyMs: number }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  const start = Date.now()
  try {
    const res = await fetch("https://open-api.bingx.com/openApi/swap/v2/server/time", {
      cache: "no-store",
      signal: ctrl.signal
    })
    const latencyMs = Date.now() - start
    return { ok: res.status < 500, latencyMs }
  } catch {
    const latencyMs = Date.now() - start
    return { ok: false, latencyMs }
  } finally {
    clearTimeout(t)
  }
}

function classifyLatency(latencyMs: number, ok: boolean): HealthState {
  if (!ok) return "CRITICAL"
  if (latencyMs < 200) return "HEALTHY"
  if (latencyMs < 500) return "DEGRADED"
  return "CRITICAL"
}

function setPaused(paused: boolean) {
  const cur = g.__abxkCommand ?? {}
  g.__abxkCommand = { ...cur, paused, updatedAt: Date.now() }
}

async function maybeNotifyTransition(prev: HealthState, next: HealthState, latencyMs?: number) {
  const settings = g.__abxkSnapshot?.settings ?? {}
  const enabled = settings?.features?.healthCheck !== false
  const notify = settings?.notifications?.health !== false
  if (!enabled || !notify) return

  if (prev === next) return
  if (next === "DEGRADED") {
    pushHistory(next, `API slow: ${latencyMs ?? "—"}ms`)
    await sendTelegram(`⚠️ <b>EXCHANGE HEALTH WARNING</b>\n━━━━━━━━━━━━━━\nBingX API latency: ${Math.round(latencyMs ?? 0)}ms\nStatus: Degraded\nAction: Bot in cautious mode\nMonitoring: Every 1 minute`).catch(
      () => undefined
    )
    return
  }
  if (next === "CRITICAL") {
    pushHistory(next, "API DOWN / WS issue")
    setPaused(true)
    runtime().lastCriticalAt = Date.now()
    await sendTelegram(
      `🚨 <b>SYSTEM ALERT</b>
━━━━━━━━━━━━━━
❌ BingX API: Connection failed
✅ Telegram: OK
${runtime().summary.wsConnected ? "✅" : "❌"} Price Feed: ${runtime().summary.wsConnected ? "OK" : "DISCONNECTED"}
Bot: AUTO-PAUSED
Fix and restart: npm run bot`
    ).catch(() => undefined)
    return
  }
  if (next === "HEALTHY") {
    pushHistory(next, `Recovered: ${latencyMs ?? "—"}ms`)
    const downAt = runtime().lastCriticalAt
    const downtimeMin = downAt ? Math.max(0, Math.round((Date.now() - downAt) / 60_000)) : undefined
    await sendTelegram(
      `✅ <b>SYSTEM RECOVERED</b>
━━━━━━━━━━━━━━
BingX API back online
Bot: RESUMING
Downtime: ${downtimeMin !== undefined ? `${downtimeMin} minutes` : "—"}`
    ).catch(() => undefined)
    setTimeout(() => setPaused(false), 120_000)
    runtime().lastCriticalAt = undefined
  }
}

function startWs(symbol = "BTC-USDT") {
  const r = runtime()
  try {
    if (r.ws) r.ws.close()
  } catch {
    return
  }

  const ws = new WebSocket("wss://open-api-swap.bingx.com/swap-market")
  r.ws = ws
  const dataType = `${symbol}@ticker`

  ws.on("open", () => {
    r.wsRetries = 0
    setState({ wsConnected: true })
    ws.send(JSON.stringify({ id: `health-${Date.now()}`, reqType: "sub", dataType }))
  })

  ws.on("message", (data: WebSocket.RawData) => {
    const text = decodeWsPayload(data)
    if (!text) return
    if (text === "Ping") {
      ws.send("Pong")
      return
    }
    setState({ wsConnected: true, lastWsMessageAt: Date.now() })
  })

  const scheduleRetry = () => {
    setState({ wsConnected: false })
    r.wsRetries = Math.min(10, (r.wsRetries ?? 0) + 1)
    const delay = Math.min(30_000, 1500 * r.wsRetries)
    setTimeout(() => startWs(symbol), delay)
  }

  ws.on("close", scheduleRetry)
  ws.on("error", scheduleRetry)
}

function decodeWsPayload(data: WebSocket.RawData): string {
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.isBuffer(data) ? data : Buffer.from(data as any)
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      return zlib.gunzipSync(buf).toString("utf8")
    }
    const asText = buf.toString("utf8")
    if (asText === "Ping") return asText
    try {
      const maybe = JSON.parse(asText)
      return JSON.stringify(maybe)
    } catch {
      return asText
    }
  } catch {
    return ""
  }
}

async function checkBalance() {
  const settings = g.__abxkSnapshot?.settings ?? {}
  const enabled = settings?.features?.healthCheck !== false
  const notify = settings?.notifications?.health !== false
  if (!enabled) return

  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) {
    setState({ authConfigured: false, authOk: undefined, lastAuthError: undefined })
    return
  }
  setState({ authConfigured: true })

  try {
    const data = await bingxRequest<any>({
      method: "GET",
      path: "/openApi/swap/v2/user/balance",
      apiKey,
      secretKey
    })
    const bal = extractUsdtBalanceUsd(data)
    setState({ authOk: true, lastAuthAt: Date.now(), lastAuthError: undefined })
    if (Number.isFinite(bal)) {
      const prev = runtime().summary.balanceUsd
      setState({ balanceUsd: bal, lastBalanceAt: Date.now() })
      if (typeof prev === "number" && prev > 0) {
        const dropPct = ((prev - bal) / prev) * 100
        if (dropPct > 5) {
          pushHistory("DEGRADED", `Balance drop: ${dropPct.toFixed(2)}%`)
          if (notify) {
            await sendTelegram(
              `⚠️ <b>EXCHANGE HEALTH WARNING</b>\n━━━━━━━━━━━━━━\nBalance dropped unexpectedly: ${dropPct.toFixed(
                2
              )}%\nAction: Review account activity`
            ).catch(() => undefined)
          }
        }
      }
      if (bal === 0) {
        pushHistory("CRITICAL", "Balance = 0")
        setPaused(true)
        if (notify) {
          await sendTelegram(
            `🚨 <b>EXCHANGE HEALTH WARNING</b>\n━━━━━━━━━━━━━━\nBalance = $0\n⛔ Bot: EMERGENCY STOP`
          ).catch(() => undefined)
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auth error"
    setState({ authOk: false, lastAuthAt: Date.now(), lastAuthError: msg })
    return
  }
}

function extractUsdtBalanceUsd(raw: unknown): number {
  const data = raw as any
  const root = data?.data ?? data

  const pickNumber = (row: any): number | undefined => {
    const v = row?.balance ?? row?.availableBalance ?? row?.availableMargin ?? row?.userBalance ?? row?.equity ?? row?.totalMargin
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
    return Number.isFinite(n) ? n : undefined
  }

  if (Array.isArray(root)) {
    const usdt = root.find((x) => String(x?.asset ?? x?.currency ?? x?.coin ?? "").toUpperCase() === "USDT")
    const n = usdt ? pickNumber(usdt) : undefined
    if (n !== undefined) return n
    const anyRow = root.map((x) => pickNumber(x)).find((x) => x !== undefined)
    return anyRow ?? NaN
  }

  if (root && typeof root === "object") {
    const n = pickNumber(root)
    if (n !== undefined) return n
    const nested = root?.balance ?? root?.data ?? root?.account ?? undefined
    const n2 = nested ? pickNumber(nested) : undefined
    return n2 ?? NaN
  }

  return NaN
}

function pruneOrders(now: number) {
  const r = runtime()
  r.orderAttempts = r.orderAttempts.filter((a) => now - a.time <= 60 * 60 * 1000)
  const fails = r.orderAttempts.filter((a) => !a.ok).length
  setState({ orderFailuresLastHour: fails })
}

export function recordOrderAttempt(ok: boolean) {
  const settings = g.__abxkSnapshot?.settings ?? {}
  const enabled = settings?.features?.healthCheck !== false
  const notify = settings?.notifications?.health !== false

  const r = runtime()
  const now = Date.now()
  r.orderAttempts = [{ time: now, ok }, ...r.orderAttempts].slice(0, 50)
  pruneOrders(now)
  const fails = r.summary.orderFailuresLastHour
  if (fails > 2) {
    pushHistory("CRITICAL", `Order failures: ${fails}`)
    if (enabled) setPaused(true)
    if (notify) {
      void sendTelegram(
        `🚨 <b>EXCHANGE HEALTH WARNING</b>\n━━━━━━━━━━━━━━\nOrder execution failures: ${fails} in last hour\n⛔ Bot: AUTO-PAUSED\nRetry in: 60 seconds`
      ).catch(() => undefined)
    }
  }
}

export function startHealthCheck() {
  const r = runtime()
  if (r.started) return
  r.started = true

  startWs()

  cron.schedule("*/5 * * * *", async () => {
    const prev = runtime().summary.state
    const { ok, latencyMs } = await pingApi()
    const next = classifyLatency(latencyMs, ok)
    setState({ apiLatencyMs: latencyMs, state: next })
    await maybeNotifyTransition(prev, next, latencyMs)
    await checkBalance()
  })

  setInterval(() => {
    const s = runtime().summary
    const now = Date.now()
    pruneOrders(now)
    if (s.wsConnected && s.lastWsMessageAt && now - s.lastWsMessageAt > 30_000) {
      runtime().wsRetries += 1
      setState({ wsConnected: false })
      if (runtime().wsRetries >= 3) {
        const prev = runtime().summary.state
        setState({ state: "CRITICAL" })
        void maybeNotifyTransition(prev, "CRITICAL", runtime().summary.apiLatencyMs)
      }
      startWs()
    }
  }, 5000)
}

export function getHealthSummary(): HealthSummary {
  return runtime().summary
}

export async function refreshHealthNow(): Promise<HealthSummary> {
  const prev = runtime().summary.state
  const { ok, latencyMs } = await pingApi()
  const next = classifyLatency(latencyMs, ok)
  setState({ apiLatencyMs: latencyMs, state: next })
  await maybeNotifyTransition(prev, next, latencyMs)
  await checkBalance()
  return runtime().summary
}
