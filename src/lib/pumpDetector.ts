import type { Candle, ExecutionMode } from "@/types/bot"

export type PumpLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME"

export type PumpDetection = {
  symbol: string
  currentPrice: number
  priceChange1m: number
  priceChange5m: number
  priceChange15m: number
  volumeRatio: number
  pumpLevel: PumpLevel
  confidence: number
  shortEntry: number
  suggestedTP: number
  suggestedSL: number
  detectedAt: number
}

export type PumpThreshold = {
  priceChange5m: number
  volumeMultiplier: number
  color: string
  action: "ALERT_ONLY" | "TRADE"
}

export const PUMP_THRESHOLDS: Record<PumpLevel, PumpThreshold> = {
  LOW: { priceChange5m: 1.5, volumeMultiplier: 2.0, color: "🟡", action: "ALERT_ONLY" },
  MEDIUM: { priceChange5m: 3.0, volumeMultiplier: 3.0, color: "🟠", action: "TRADE" },
  HIGH: { priceChange5m: 5.0, volumeMultiplier: 5.0, color: "🔴", action: "TRADE" },
  EXTREME: { priceChange5m: 10.0, volumeMultiplier: 10.0, color: "🚨", action: "TRADE" }
}

export type PumpLevelSettings = {
  margin: number
  leverage: number
  tpPercent: number
  slPercent: number
  trailingEnabled: boolean
  trailingActivateAt: number
  trailingDistance: number
}

export type PumpAlertSettings = {
  enabled: boolean
  mode: ExecutionMode
  tradeLow: boolean
  tradeMedium: boolean
  tradeHigh: boolean
  tradeExtreme: boolean
  levels: Record<PumpLevel, PumpLevelSettings>
  maxConcurrentPumps: number
  maxPumpsPerHour: number
  cooldownAfterTrade: number
  minConfidence: number
  blacklistedCoins: string[]
}

export const DEFAULT_PUMP_SETTINGS: PumpAlertSettings = {
  enabled: false,
  mode: "paper",
  tradeLow: false,
  tradeMedium: true,
  tradeHigh: true,
  tradeExtreme: true,
  levels: {
    LOW: {
      margin: 5,
      leverage: 5,
      tpPercent: 1.5,
      slPercent: 1.0,
      trailingEnabled: true,
      trailingActivateAt: 1.0,
      trailingDistance: 0.5
    },
    MEDIUM: {
      margin: 10,
      leverage: 10,
      tpPercent: 3.0,
      slPercent: 1.5,
      trailingEnabled: true,
      trailingActivateAt: 2.0,
      trailingDistance: 0.8
    },
    HIGH: {
      margin: 15,
      leverage: 15,
      tpPercent: 5.0,
      slPercent: 2.0,
      trailingEnabled: true,
      trailingActivateAt: 3.0,
      trailingDistance: 1.0
    },
    EXTREME: {
      margin: 20,
      leverage: 20,
      tpPercent: 8.0,
      slPercent: 3.0,
      trailingEnabled: true,
      trailingActivateAt: 5.0,
      trailingDistance: 1.5
    }
  },
  maxConcurrentPumps: 3,
  maxPumpsPerHour: 5,
  cooldownAfterTrade: 10,
  minConfidence: 60,
  blacklistedCoins: ["BTC-USDT"]
}

let nextKlinesAtMs = 0
const KLINES_GAP_MS = 180
let pumpScanCursor = 0

export async function scanAllCoinsForPump(): Promise<PumpDetection[]> {
  const pumps: PumpDetection[] = []

  const contractsRes = await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/contracts", { cache: "no-store" })
  const contractsJson = (await contractsRes.json()) as any
  const contracts = Array.isArray(contractsJson?.data) ? contractsJson.data : []
  const symbols: string[] = contracts
    .filter((c: any) => c?.status === 1)
    .map((c: any): string => String(c?.symbol ?? ""))
    .filter((s: string): s is string => Boolean(s))

  const tickerRes = await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/ticker", { cache: "no-store" })
  const tickers = await tickerRes.json().catch(() => null)

  const active = new Set(symbols)
  const rows = Array.isArray((tickers as any)?.data) ? ((tickers as any).data as any[]) : []
  const ranked = rows
    .map((r) => {
      const sym = String(r?.symbol ?? r?.s ?? "")
      const q = Number(r?.quoteVolume ?? r?.q ?? r?.quoteVol ?? r?.quoteTurnover ?? r?.turnover)
      return { sym, q }
    })
    .filter((x) => x.sym && active.has(x.sym) && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.sym)

  const ordered = ranked.length ? ranked : symbols
  if (pumpScanCursor < 0 || pumpScanCursor >= ordered.length) pumpScanCursor = 0

  const topKeep = ordered.slice(0, Math.min(60, ordered.length))
  const windowSize = Math.min(180, Math.max(0, ordered.length - topKeep.length))
  const start = pumpScanCursor
  const end = Math.min(ordered.length, start + windowSize)
  const rotating = ordered.slice(start, end)
  pumpScanCursor = end >= ordered.length ? 0 : end

  const set = new Set<string>()
  const scanSymbols: string[] = []
  for (const s of [...topKeep, ...rotating]) {
    if (!s) continue
    if (set.has(s)) continue
    set.add(s)
    scanSymbols.push(s)
  }

  const chunks = chunkArray(scanSymbols, 4)
  for (const chunk of chunks) {
    const results = await Promise.allSettled(chunk.map((symbol) => analyzePump(symbol, tickers)))
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) pumps.push(r.value)
    }
    await sleep(10)
  }

  return pumps.sort((a, b) => b.priceChange5m - a.priceChange5m)
}

export async function analyzePump(symbol: string, tickers: any): Promise<PumpDetection | null> {
  void tickers

  const candles1m = await fetchCandles(symbol, "1m", 30)
  if (!candles1m || candles1m.length < 20) return null

  const current = candles1m[candles1m.length - 1]
  const prev1m = candles1m[candles1m.length - 2]
  const prev5m = candles1m[candles1m.length - 6]
  const prev15m = candles1m[candles1m.length - 16]
  if (!current || !prev1m || !prev5m) return null

  const priceChange1m = ((current.close - prev1m.close) / Math.max(1e-12, prev1m.close)) * 100
  const priceChange5m = ((current.close - prev5m.close) / Math.max(1e-12, prev5m.close)) * 100
  const priceChange15m = prev15m ? ((current.close - prev15m.close) / Math.max(1e-12, prev15m.close)) * 100 : 0

  const avgVolume = candles1m
    .slice(-20, -1)
    .reduce((s, c) => s + (Number.isFinite(c.volume) ? c.volume : 0), 0) / 19
  const currentVolume = current.volume
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 0

  if (priceChange5m <= 0) return null

  const pumpLevel = classifyPumpLevel(priceChange5m, volumeRatio)
  if (!pumpLevel) return null

  const confidence = Math.min((priceChange5m / 10) * 40 + (volumeRatio / 10) * 40 + (priceChange1m > 0.5 ? 20 : 0), 100)

  return {
    symbol,
    currentPrice: current.close,
    priceChange1m: round(priceChange1m, 3),
    priceChange5m: round(priceChange5m, 3),
    priceChange15m: round(priceChange15m, 3),
    volumeRatio: round(volumeRatio, 2),
    pumpLevel,
    confidence: round(confidence, 1),
    shortEntry: current.close,
    suggestedTP: 0,
    suggestedSL: 0,
    detectedAt: Date.now()
  }
}

export async function fetchCandles(symbol: string, interval: "1m" | "5m", limit: number): Promise<Candle[]> {
  const now = Date.now()
  const wait = Math.max(0, nextKlinesAtMs - now)
  if (wait > 0) await sleep(wait)
  nextKlinesAtMs = Date.now() + KLINES_GAP_MS

  const url = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("interval", interval)
  url.searchParams.set("limit", String(limit))
  const res = await fetch(url.toString(), { cache: "no-store" })
  if (!res.ok) return []
  const json = (await res.json().catch(() => null)) as any
  const code = Number(json?.code)
  if (code === 100410) {
    const msg = String(json?.msg ?? "")
    const m = msg.match(/after\s+(\d{10,13})/)
    const unblockAt = m ? Number(m[1]) : NaN
    if (Number.isFinite(unblockAt)) {
      nextKlinesAtMs = Math.max(nextKlinesAtMs, unblockAt + 100)
    }
    return []
  }
  return parseKlines(json)
}

function parseKlines(raw: unknown): Candle[] {
  const data = raw as any
  const rows: any[] =
    Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : []

  const candles: Candle[] = []
  for (const r of rows) {
    if (Array.isArray(r)) {
      const openTime = toNum(r[0])
      const open = toNum(r[1])
      const high = toNum(r[2])
      const low = toNum(r[3])
      const close = toNum(r[4])
      const volume = toNum(r[5])
      if (openTime !== null && open !== null && high !== null && low !== null && close !== null && volume !== null) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    } else if (r && typeof r === "object") {
      const openTime = toNum((r as any).time ?? (r as any).openTime)
      const open = toNum((r as any).open)
      const high = toNum((r as any).high)
      const low = toNum((r as any).low)
      const close = toNum((r as any).close)
      const volume = toNum((r as any).volume)
      if (openTime !== null && open !== null && high !== null && low !== null && close !== null && volume !== null) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    }
  }

  return candles.sort((a, b) => a.openTime - b.openTime)
}

function classifyPumpLevel(priceChange5m: number, volumeRatio: number): PumpLevel | null {
  if (priceChange5m >= PUMP_THRESHOLDS.EXTREME.priceChange5m && volumeRatio >= PUMP_THRESHOLDS.EXTREME.volumeMultiplier) return "EXTREME"
  if (priceChange5m >= PUMP_THRESHOLDS.HIGH.priceChange5m && volumeRatio >= PUMP_THRESHOLDS.HIGH.volumeMultiplier) return "HIGH"
  if (priceChange5m >= PUMP_THRESHOLDS.MEDIUM.priceChange5m && volumeRatio >= PUMP_THRESHOLDS.MEDIUM.volumeMultiplier) return "MEDIUM"
  if (priceChange5m >= PUMP_THRESHOLDS.LOW.priceChange5m && volumeRatio >= PUMP_THRESHOLDS.LOW.volumeMultiplier) return "LOW"
  return null
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const k = 10 ** dp
  return Math.round(n * k) / k
}
