"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type {
  Candle,
  EquityPoint,
  MarketRegime,
  Settings,
  StrategySnapshot,
  Trade,
  TradeJournalEntry,
  TradeSide
} from "@/types/bot"
import { generateCompoundingPlan, getActiveLevel, roundUsd } from "@/lib/compounding"
import { evaluateSetup, scoreSetup } from "@/lib/strategy"
import { detectMarketRegime, type MarketRegimeSnapshot } from "@/lib/marketRegime"
import { evaluateCorrelation, type CorrelationDecision } from "@/lib/correlationFilter"
import { scoreSmc } from "@/lib/smc"
import { detectOrderBlocks, detectFairValueGaps } from "@/lib/smc"
import { calculateAdaptiveSL, calculateAdaptiveTP, updateTrailingStop } from "@/lib/adaptiveLevels"
import { SCAN_SYMBOLS, resolveScanSymbols, scanAllSymbolsDetailed } from "@/lib/scanner"
import {
  findDangerLevels,
  findLevelNearPrice,
  findLiquidationMagnets,
  formatHeatmapTelegram,
  getLiquidationHeatmap,
  optimizeTPLevelsFromMagnets,
  optimizeTPWithHeatmap
} from "@/lib/liquidationHeatmap"

type PendingSignal = {
  symbol: string
  timeframe: Settings["timeframe"]
  side: TradeSide
  snapshot: StrategySnapshot
  regime?: MarketRegimeSnapshot
  sizeMultiplier: number
  chartImageBase64?: string
  signalCandleOpenTime: number
  enterAtCandleOpenTime: number
  createdAt: number
}

type ScannerRow = {
  symbol: string
  displaySymbol?: string
  direction?: TradeSide
  totalScore?: number
  entryPrice?: number
  suggestedSL?: number
  suggestedTP?: number
  rr?: number
  regime?: string
  topReason?: string
  rank?: number
  scanTime?: number
  status: "TRADE" | "WATCH" | "BELOW" | "SKIPPED" | "INACTIVE"
}

type BotState = {
  settings: Settings
  completedLevels: number[]
  strategySnapshot?: StrategySnapshot
  paperTrades: Trade[]
  liveTrades: Trade[]
  equityCurve: EquityPoint[]
  dailyTradeCount: Record<string, number>
  dailyPnlUsd: Record<string, number>
  haltedUntilDay?: string
  maxEquity?: number
  lastAutomationCandleClose?: number
  pendingSignal?: PendingSignal
  lastOpenInterest?: number
  lastFearGreed?: number
  lastDailyReportDay?: string
  paused: boolean
  pausedUntil?: number
  lastSkipDay?: string
  lastSkipMessage?: string
  marketRegime?: MarketRegimeSnapshot
  lastRegime?: MarketRegime
  lastBtcDominance?: number
  lastCorrelation?: CorrelationDecision
  lastPreTradeAlertKey?: string
  lockedProfitByLevel: Record<string, number>
  withdrawnLockedProfitUsd: number
  scannerResults: ScannerRow[]
  scannerLastScanAt?: number
  scannerLastScanCandleOpenTime?: number
  scannerSelectedSymbol?: string
  scannerTop?: { symbol: string; requestedSymbol?: string; direction: TradeSide; totalScore: number; snapshot: StrategySnapshot }
  lastScanResult?: {
    symbol: string
    score: number
    direction: TradeSide
    debug?: {
      volumeRatio?: number
      rsiValue?: number
      histValue?: number
      sessionActive?: boolean
      utcHour?: number
    }
  }
  lastHeatmapDangerCheckAt?: number
  lastHeatmapDangerAlertKey?: string

  setSettings: (patch: Partial<Settings>) => void
  toggleFilter: (key: keyof Settings["filters"]) => void
  setPaused: (paused: boolean) => void
  setCompletedLevel: (level: number, done: boolean) => void
  resetProgress: () => void
  withdrawLockedProfits: () => void
  runBotCycle: () => Promise<void>
  checkLiquidationDangerNow: () => Promise<void>
  onPriceTick: (price: number) => void
}

function defaultSettings(): Settings {
  return {
    mode: "paper",
    symbol: "BTC-USDT",
    timeframe: "4h",
    maxTradesPerDay: 1,
    minSetupScore: 75,
    filters: {
      trendEma: true,
      volumeSpike: true,
      atrVolatility: true,
      rsi: true,
      macd: true,
      bbSqueeze: true,
      fibGoldenPocket: true,
      stochRsi: true,
      macdDivergence: true,
      openInterest: true,
      liquidity: true,
      fundingRate: true,
      fundingHardBlock: true,
      session: true,
      htfDailyBias: true,
      newsBlackout: true,
      oiDivergence: true,
      fearGreed: true,
      liquidationTp: false
    },
    thresholds: {
      volumeSpikeMultiplier: 1.5,
      atrMin: 50,
      atrMax: 5000,
      maxSpreadPct: 0.1,
      maxFundingRatePct: 0.01,
      fundingHardBlockPct: 0.05,
      londonNyOverlapStartUtcHour: 13,
      londonNyOverlapEndUtcHour: 16,
      bbSqueezePctOfAvg: 1,
      fibLookbackCandles: 80,
      newsBlackoutMinutes: 30,
      fearGreedLongOnlyBelow: 25,
      fearGreedShortOnlyAbove: 75,
      liquidationExchange: "Binance",
      liquidationSymbol: "BTCUSDT",
      liquidationRange: "24h",
      liquidationTpOffsetPct: 0.2
    },
    features: {
      marketRegime: true,
      correlationFilter: true,
      patternRecognition: false,
      smc: true,
      onChain: false,
      sentiment: false,
      disasterRecovery: true,
      adaptiveLevels: true,
      scanner: false,
      selfLearner: false,
      liquidationHeatmap: true,
      journal: true,
      preTradeAlerts: true,
      marketMonitor: true,
      projection: true,
      partialProfitLock: false,
      newsFilter: true,
      healthCheck: true,
      whaleAlert: false
    },
    notifications: {
      regime: true,
      correlation: true,
      patternRecognition: true,
      smc: true,
      onChain: true,
      sentiment: true,
      disasterRecovery: true,
      scanner: true,
      selfLearner: true,
      liquidationHeatmap: true,
      journal: true,
      preTrade: true,
      marketMonitor: true,
      projection: true,
      partialProfitLock: true,
      health: true,
      whale: true
    },
    capital: {
      initialCapitalUsd: 20
    },
    compounding: {
      levels: 30,
      profitTargetPct: 30,
      riskPctOfBalance: 23
    },
    partialProfitLock: {
      triggerPctOfLevelTarget: 50,
      lockPctOfProfitSoFar: 25
    },
    risk: {
      leverage: 10,
      slMode: "atr",
      slFixedPct: 1,
      slAtrMultiplier: 1.5,
      tpMode: "rr",
      tpFixedPct: 2,
      rrRatio: 2,
      trailingStopEnabled: false,
      trailingActivationPct: 1,
      dailyLossLimitUsd: 10,
      maxDrawdownPct: 30
    }
  }
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`
}

function safeNumber(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x)
  return undefined
}

function acquireAlertLock(key: string, ttlMs: number): boolean {
  try {
    if (typeof window === "undefined") return true
    const storageKey = `abxk_alert_${key}`
    const now = Date.now()
    const raw = window.localStorage.getItem(storageKey)
    const prev = raw ? Number(raw) : 0
    if (Number.isFinite(prev) && prev > 0 && now - prev < ttlMs) return false
    window.localStorage.setItem(storageKey, String(now))
    return true
  } catch {
    return true
  }
}

function parseKlines(raw: unknown): Candle[] {
  const data = raw as any
  const rows: any[] =
    Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : []

  const candles: Candle[] = []
  for (const r of rows) {
    if (Array.isArray(r)) {
      const openTime = safeNumber(r[0])
      const open = safeNumber(r[1])
      const high = safeNumber(r[2])
      const low = safeNumber(r[3])
      const close = safeNumber(r[4])
      const volume = safeNumber(r[5])
      if (
        openTime !== undefined &&
        open !== undefined &&
        high !== undefined &&
        low !== undefined &&
        close !== undefined &&
        volume !== undefined
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    } else if (r && typeof r === "object") {
      const openTime = safeNumber((r as any).time ?? (r as any).openTime)
      const open = safeNumber((r as any).open)
      const high = safeNumber((r as any).high)
      const low = safeNumber((r as any).low)
      const close = safeNumber((r as any).close)
      const volume = safeNumber((r as any).volume)
      if (
        openTime !== undefined &&
        open !== undefined &&
        high !== undefined &&
        low !== undefined &&
        close !== undefined &&
        volume !== undefined
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    }
  }

  return candles.sort((a, b) => a.openTime - b.openTime)
}

function parseBookTicker(raw: unknown): { bid?: number; ask?: number } {
  const data = raw as any
  const row = data?.data ?? data
  return {
    bid: safeNumber(row?.bidPrice ?? row?.bid),
    ask: safeNumber(row?.askPrice ?? row?.ask)
  }
}

function parseFundingRatePct(raw: unknown): number | undefined {
  const data = raw as any
  const row = data?.data ?? data
  const rate = safeNumber(row?.lastFundingRate ?? row?.fundingRate ?? row?.fundingRatePercent)
  if (rate === undefined) return undefined
  return rate * 100
}

function buildStopLossTp(settings: Settings, side: Trade["side"], entryPrice: number, candles: Candle[]) {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const atrValue = candles.length > 15 ? computeAtrValue(highs, lows, closes) : undefined

  const slDistance =
    settings.risk.slMode === "fixedPct"
      ? (entryPrice * settings.risk.slFixedPct) / 100
      : (atrValue ?? 0) * settings.risk.slAtrMultiplier

  const safeSlDistance = slDistance > 0 ? slDistance : (entryPrice * 0.5) / 100

  const stopLossPrice =
    side === "LONG" ? entryPrice - safeSlDistance : entryPrice + safeSlDistance

  const tpDistance =
    settings.risk.tpMode === "fixedPct"
      ? (entryPrice * settings.risk.tpFixedPct) / 100
      : safeSlDistance * settings.risk.rrRatio

  const takeProfitPrice =
    side === "LONG" ? entryPrice + tpDistance : entryPrice - tpDistance

  const rr = safeSlDistance > 0 ? tpDistance / safeSlDistance : 0
  if (!Number.isFinite(rr) || rr <= 0) return null

  return {
    stopLossPrice: roundPrice(stopLossPrice),
    takeProfitPrice: roundPrice(takeProfitPrice),
    riskPerUnit: safeSlDistance,
    rr
  }
}

function buildRegimeStops(
  settings: Settings,
  side: TradeSide,
  entryPrice: number,
  candles: Candle[],
  regime?: MarketRegimeSnapshot
): { stopLossPrice: number; takeProfitPrice: number; riskPerUnit: number; rr: number } | null {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const atr14 = candles.length > 15 ? computeAtrValue(highs, lows, closes) : 0

  let base: { stopLossPrice: number; takeProfitPrice: number; riskPerUnit: number; rr: number } | null = null

  if (regime?.regime === "TRENDING_BULL" || regime?.regime === "TRENDING_BEAR") {
    const ema20 = emaSeriesLast(closes, 20)
    const tpDistance = 2 * atr14
    const takeProfitPrice = side === "LONG" ? entryPrice + tpDistance : entryPrice - tpDistance

    const slRef = ema20
    const stopLossPrice =
      side === "LONG"
        ? Math.min(slRef, entryPrice - Math.max(atr14, 0.0000001))
        : Math.max(slRef, entryPrice + Math.max(atr14, 0.0000001))

    base = finalizeStops(entryPrice, stopLossPrice, takeProfitPrice, side)
  }

  if (!base && regime?.regime === "RANGING") {
    const bb = bollingerBands(closes, 20, 2)
    const stopDistance = 1 * atr14
    const stopLossPrice = side === "LONG" ? entryPrice - stopDistance : entryPrice + stopDistance
    const takeProfitPrice = bb.middle
    base = finalizeStops(entryPrice, stopLossPrice, takeProfitPrice, side)
  }

  if (!base && regime?.regime === "VOLATILE") {
    const volBase = buildStopLossTp(settings, side, entryPrice, candles)
    if (!volBase) return null
    const minStopDistance = 2 * atr14
    const stopDistance = Math.max(volBase.riskPerUnit, minStopDistance)
    const stopLossPrice = side === "LONG" ? entryPrice - stopDistance : entryPrice + stopDistance
    const takeProfitPrice = side === "LONG" ? entryPrice + 2 * stopDistance : entryPrice - 2 * stopDistance
    base = finalizeStops(entryPrice, stopLossPrice, takeProfitPrice, side)
  }

  if (!base) base = buildStopLossTp(settings, side, entryPrice, candles)
  if (!base) return null

  if (settings.features.adaptiveLevels && candles.length >= 60) {
    const smcData = {
      orderBlocks: detectOrderBlocks(candles, settings.timeframe === "1d" ? "1D" : "4H"),
      fvgs: detectFairValueGaps(candles)
    }

    const slCalc = calculateAdaptiveSL(candles, side, entryPrice, smcData)
    const tpCalc = calculateAdaptiveTP(candles, side, entryPrice, slCalc.price, undefined, smcData)

    if (tpCalc.valid) {
      const next = finalizeStops(entryPrice, slCalc.price, tpCalc.primaryTP, side)
      if (next && next.rr >= 1.5) return next
    }
    const fallback = finalizeStops(entryPrice, slCalc.price, base.takeProfitPrice, side)
    if (fallback) return fallback
  }

  return base
}

function finalizeStops(
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number,
  side: TradeSide
): { stopLossPrice: number; takeProfitPrice: number; riskPerUnit: number; rr: number } | null {
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice)
  const rewardPerUnit = Math.abs(takeProfitPrice - entryPrice)
  const rr = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0
  if (!Number.isFinite(rr) || rr <= 0) return null
  const fixedSl = side === "LONG" ? Math.min(stopLossPrice, entryPrice * 0.999999) : Math.max(stopLossPrice, entryPrice * 1.000001)
  return {
    stopLossPrice: roundPrice(fixedSl),
    takeProfitPrice: roundPrice(takeProfitPrice),
    riskPerUnit,
    rr
  }
}

function emaCrossover(candles: Candle[], type: "BULLISH" | "BEARISH"): boolean {
  const closes = candles.map((c) => c.close)
  if (closes.length < 60) return false
  const prevCloses = closes.slice(0, -1)
  const ema20Prev = emaSeriesLast(prevCloses, 20)
  const ema50Prev = emaSeriesLast(prevCloses, 50)
  const ema20Now = emaSeriesLast(closes, 20)
  const ema50Now = emaSeriesLast(closes, 50)
  return type === "BULLISH"
    ? ema20Prev <= ema50Prev && ema20Now > ema50Now
    : ema20Prev >= ema50Prev && ema20Now < ema50Now
}

function rangingEntryOk(candles: Candle[], side: TradeSide): boolean {
  const closes = candles.map((c) => c.close)
  const lastClose = closes[closes.length - 1] ?? 0
  const bb = bollingerBands(closes, 20, 2)
  const r = rsiLocal(closes, 14)
  return side === "LONG" ? lastClose <= bb.lower && r < 30 : lastClose >= bb.upper && r > 70
}

function bollingerBands(closes: number[], period: number, mult: number): { upper: number; middle: number; lower: number } {
  const slice = closes.slice(-period)
  const m = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length)
  const variance = slice.reduce((acc, v) => acc + (v - m) * (v - m), 0) / Math.max(1, slice.length)
  const sd = Math.sqrt(variance)
  return { middle: m, upper: m + mult * sd, lower: m - mult * sd }
}

function rsiLocal(values: number[], period: number): number {
  if (values.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0)
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function confirmedFilters(snapshot: StrategySnapshot): string[] {
  const map: Partial<Record<keyof StrategySnapshot["scores"], string>> = {
    trendEma: "EMA trend",
    volumeSpike: "Volume spike",
    atrVolatility: "ATR",
    rsi: "RSI",
    macd: "MACD",
    bbSqueeze: "BB squeeze",
    fibGoldenPocket: "Fib",
    stochRsi: "Stoch RSI",
    macdDivergence: "Divergence",
    openInterest: "Open interest",
    liquidity: "Liquidity",
    fundingRate: "Funding",
    session: "Session"
  }
  return (Object.keys(map) as (keyof typeof map)[])
    .filter((k) => (snapshot.scores as any)[k] > 0)
    .map((k) => map[k] as string)
    .slice(0, 8)
}

function missingFilters(settings: Settings, snapshot: StrategySnapshot): string[] {
  const labels: Record<string, string> = {
    trendEma: "EMA trend",
    volumeSpike: "Volume spike",
    atrVolatility: "ATR",
    rsi: "RSI",
    macd: "MACD",
    bbSqueeze: "BB squeeze",
    fibGoldenPocket: "Fib",
    stochRsi: "Stoch RSI",
    macdDivergence: "Divergence",
    openInterest: "Open interest",
    liquidity: "Liquidity",
    fundingRate: "Funding",
    session: "Session"
  }
  const enabled = Object.entries(settings.filters).filter(([, v]) => v)
  const missing: string[] = []
  for (const [k] of enabled) {
    const score = (snapshot.scores as any)[k] ?? 0
    if (score > 0) continue
    if (labels[k]) missing.push(labels[k])
  }
  return missing.slice(0, 8)
}

function computeAtrValue(highs: number[], lows: number[], closes: number[]): number {
  const period = 14
  if (highs.length < period + 1) return 0
  let sum = 0
  for (let i = highs.length - period; i < highs.length; i += 1) {
    const high = highs[i] ?? 0
    const low = lows[i] ?? 0
    const prevClose = closes[i - 1] ?? closes[i] ?? 0
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    sum += tr
  }
  return sum / period
}

function capQuantityByMargin(balanceUsd: number, entryPrice: number, leverage: number, quantity: number): number {
  const notional = quantity * entryPrice
  const marginRequired = notional / Math.max(1, leverage)
  if (marginRequired <= balanceUsd) return quantity
  const maxNotional = balanceUsd * Math.max(1, leverage)
  return maxNotional / entryPrice
}

function isFixedCompounding(settings: Settings): boolean {
  const levels = Math.max(1, Math.floor(settings.compounding.levels))
  const initial = Number(settings.capital.initialCapitalUsd)
  return levels === 30 && Math.abs(initial - 20) < 0.01
}

async function getLivePrice(symbol: string): Promise<number> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Non-JSON response: ${text}`)
    }
    const row = json?.data ?? json
    const price = Number((row as any)?.price ?? (row as any)?.lastPrice ?? (row as any)?.last)
    if (!price || price === 0 || !Number.isFinite(price)) {
      throw new Error(`Invalid price for ${symbol}: ${String((row as any)?.price ?? "")}`)
    }
    return price
  } finally {
    window.clearTimeout(timeout)
  }
}

async function verifySymbol(symbol: string): Promise<boolean> {
  try {
    const res = await fetch("/api/bingx/contracts", { cache: "no-store" })
    const data = await res.json()
    const rows: any[] = Array.isArray((data as any)?.data?.data)
      ? (data as any).data.data
      : Array.isArray((data as any)?.data)
        ? (data as any).data
        : []
    if (!rows.length) return true
    return rows.some((r) => String(r?.symbol ?? "") === symbol)
  } catch {
    return true
  }
}

function calcFixedCompoundingPosition(opts: {
  levelBalanceUsd: number
  levelTargetUsd: number
  levelRiskUsd: number
  entryPrice: number
  side: TradeSide
  leverage: number
}) {
  const margin = Math.max(0, opts.levelBalanceUsd)
  const lev = Math.max(1, Math.floor(opts.leverage))
  const entry = Number(opts.entryPrice)
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("Invalid entry price")

  const positionValue = margin * lev
  if (!Number.isFinite(positionValue) || positionValue <= 0) throw new Error("Invalid position value")

  const profitTargetUsd = Math.max(0, opts.levelTargetUsd - opts.levelBalanceUsd)
  const tpPct = profitTargetUsd / positionValue
  const maxLossUsd = Math.max(0, opts.levelRiskUsd)
  const slPct = maxLossUsd / positionValue

  const tp1Price = opts.side === "LONG" ? entry * (1 + tpPct) : entry * (1 - tpPct)
  const tp2Price = opts.side === "LONG" ? entry * (1 + tpPct * 1.5) : entry * (1 - tpPct * 1.5)
  const slPrice = opts.side === "LONG" ? entry * (1 - slPct) : entry * (1 + slPct)

  if (!Number.isFinite(tp1Price) || tp1Price <= 0) throw new Error("TP is invalid")
  if (!Number.isFinite(slPrice) || slPrice <= 0) throw new Error("SL is invalid")
  if (opts.side === "LONG" && slPrice >= entry) throw new Error("SL above entry")
  if (opts.side === "SHORT" && slPrice <= entry) throw new Error("SL below entry")
  if (opts.side === "LONG" && tp1Price <= entry) throw new Error("TP below entry")
  if (opts.side === "SHORT" && tp1Price >= entry) throw new Error("TP above entry")

  const quantity = positionValue / entry
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity is invalid")

  const rr = maxLossUsd > 0 ? profitTargetUsd / maxLossUsd : 0

  return {
    entryPrice: roundPrice(entry),
    margin: roundUsd(margin),
    leverage: lev,
    positionValue: roundUsd(positionValue),
    quantity,
    tp1Price: roundPrice(tp1Price),
    tp2Price: roundPrice(tp2Price),
    slPrice: roundPrice(slPrice),
    profitTargetUsd: roundUsd(profitTargetUsd),
    maxLossUsd: roundUsd(maxLossUsd),
    rr
  }
}

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

let settingsEnvSyncTimer: number | undefined

function scheduleSettingsEnvSync(settings: Settings) {
  if (typeof window === "undefined") return
  if (settingsEnvSyncTimer) window.clearTimeout(settingsEnvSyncTimer)
  settingsEnvSyncTimer = window.setTimeout(() => {
    fetch("/api/bot/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    }).catch(() => undefined)
  }, 800)
}

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings(),
      completedLevels: [],
      paperTrades: [],
      liveTrades: [],
      equityCurve: [],
      dailyTradeCount: {},
      dailyPnlUsd: {},
      paused: false,
      pausedUntil: undefined,
      lastSkipDay: undefined,
      lastSkipMessage: undefined,
      marketRegime: undefined,
      lastRegime: undefined,
      lastBtcDominance: undefined,
      lastCorrelation: undefined,
      lastPreTradeAlertKey: undefined,
      lockedProfitByLevel: {},
      withdrawnLockedProfitUsd: 0,
      scannerResults: [],
      scannerLastScanAt: undefined,
      scannerLastScanCandleOpenTime: undefined,
      scannerSelectedSymbol: undefined,
      scannerTop: undefined,
      lastScanResult: undefined,
      lastHeatmapDangerCheckAt: undefined,
      lastHeatmapDangerAlertKey: undefined,

      setSettings: (patch) =>
        set((s) => {
          const next = mergeSettings(s.settings, patch)
          scheduleSettingsEnvSync(next)
          return { settings: next }
        }),
      toggleFilter: (key) =>
        set((s) => {
          const next: Settings = {
            ...s.settings,
            filters: { ...s.settings.filters, [key]: !s.settings.filters[key] }
          }
          scheduleSettingsEnvSync(next)
          return { settings: next }
        }),
      setPaused: (paused) =>
        set((s) => {
          const wasPaused = s.paused
          const next = { paused }
          if (wasPaused && !paused) {
            setTimeout(() => void get().runBotCycle(), 250)
            return { ...next, scannerLastScanCandleOpenTime: undefined }
          }
          return next
        }),
      setCompletedLevel: (level, done) =>
        set((s) => {
          const next = new Set(s.completedLevels)
          if (done) next.add(level)
          else next.delete(level)
          return { completedLevels: Array.from(next).sort((a, b) => a - b) }
        }),
      resetProgress: () =>
        set(() => ({
          completedLevels: [],
          paperTrades: [],
          liveTrades: [],
          equityCurve: [],
          dailyTradeCount: {},
          dailyPnlUsd: {},
          haltedUntilDay: undefined,
          maxEquity: undefined,
          pendingSignal: undefined,
          lastOpenInterest: undefined,
          lastFearGreed: undefined,
          lastDailyReportDay: undefined,
          paused: false,
          pausedUntil: undefined,
          lastSkipDay: undefined,
          lastSkipMessage: undefined,
          marketRegime: undefined,
          lastRegime: undefined,
          lastBtcDominance: undefined,
          lastCorrelation: undefined,
          lastPreTradeAlertKey: undefined,
          lockedProfitByLevel: {},
          withdrawnLockedProfitUsd: 0,
          scannerResults: [],
          scannerLastScanAt: undefined,
          scannerLastScanCandleOpenTime: undefined,
          scannerSelectedSymbol: undefined,
          scannerTop: undefined,
          lastHeatmapDangerCheckAt: undefined,
          lastHeatmapDangerAlertKey: undefined
        })),

      withdrawLockedProfits: () =>
        set((s) => {
          const total = Object.values(s.lockedProfitByLevel).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
          const equity = s.equityCurve[0]?.equity
          const nextCurve =
            equity !== undefined ? [{ time: Date.now(), equity: roundUsd(Math.max(0, equity - total)) }, ...s.equityCurve].slice(0, 400) : s.equityCurve
          return {
            lockedProfitByLevel: {},
            withdrawnLockedProfitUsd: roundUsd(s.withdrawnLockedProfitUsd + total),
            equityCurve: nextCurve
          }
        }),

      runBotCycle: async () => {
        const state = get()
        if (state.paused) return
        const now = Date.now()
        if (state.pausedUntil && now < state.pausedUntil) return

        let monitorFlags:
          | { pauseAllUntil?: number; longsBlockedUntil?: number; shortsBlockedUntil?: number; note?: string }
          | undefined
        if (state.settings.features.marketMonitor) {
          const monitor = await fetch("/api/monitor/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
          monitorFlags = monitor?.data?.monitor?.flags as
            | { pauseAllUntil?: number; longsBlockedUntil?: number; shortsBlockedUntil?: number; note?: string }
            | undefined
          if (
            monitorFlags?.pauseAllUntil &&
            typeof monitorFlags.pauseAllUntil === "number" &&
            now < monitorFlags.pauseAllUntil
          ) {
            set({ pausedUntil: monitorFlags.pauseAllUntil })
            if (state.settings.notifications.marketMonitor) {
              const msg = `⏸ Bot PAUSED — ${monitorFlags.note ?? "Market monitor"}`
              const prev = state.lastSkipDay === dayKey(now) && state.lastSkipMessage === msg
              if (!prev) {
                set({ lastSkipDay: dayKey(now), lastSkipMessage: msg })
                void sendTelegramMessage(msg)
              }
            }
            return
          }
        }

        const intervalMs =
          state.settings.timeframe === "15m"
            ? 15 * 60 * 1000
            : state.settings.timeframe === "1h"
              ? 60 * 60 * 1000
              : state.settings.timeframe === "4h"
                ? 4 * 60 * 60 * 1000
                : 24 * 60 * 60 * 1000

        const dayAnchorUtcHour = 9
        const candleOpenTime =
          state.settings.timeframe !== "1d"
            ? Math.floor(now / intervalMs) * intervalMs
            : (() => {
                const d = new Date(now)
                const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
                const anchor = utcMidnight + dayAnchorUtcHour * 60 * 60 * 1000
                return now >= anchor ? anchor : anchor - 24 * 60 * 60 * 1000
              })()
        set({ lastAutomationCandleClose: candleOpenTime })
        const today = dayKey(now)
        if (state.haltedUntilDay === today) return

        const plan = generateCompoundingPlan(state.settings)
        const activeLevel = getActiveLevel(state.settings.compounding.levels, state.completedLevels)
        const active = plan.find((x) => x.level === activeLevel)
        const balanceUsd = active?.balanceUsd ?? state.settings.capital.initialCapitalUsd

        const maxEquity = state.maxEquity ?? balanceUsd
        const drawdownPct = maxEquity > 0 ? ((maxEquity - balanceUsd) / maxEquity) * 100 : 0
        if (drawdownPct >= state.settings.risk.maxDrawdownPct) {
          set({ haltedUntilDay: today })
          const msg = `🔴 <b>BOT STOPPED</b>
━━━━━━━━━━━━━━
Reason: Max drawdown hit
Equity dropped: ${drawdownPct.toFixed(1)}%
Action needed: Manual review
Restart: npm run bot`
          if (state.lastSkipDay !== today || state.lastSkipMessage !== msg) {
            set({ lastSkipDay: today, lastSkipMessage: msg })
            void sendTelegramMessage(msg)
          }
          return
        }

        const dayPnl = state.dailyPnlUsd[today] ?? 0
        if (dayPnl <= -Math.abs(state.settings.risk.dailyLossLimitUsd)) {
          set({ haltedUntilDay: today })
          if (state.lastSkipDay !== today || state.lastSkipMessage !== "⏸ Bot PAUSED — Daily loss limit hit") {
            set({ lastSkipDay: today, lastSkipMessage: "⏸ Bot PAUSED — Daily loss limit hit" })
            void sendTelegramMessage("⏸ Bot PAUSED — Daily loss limit hit")
          }
          return
        }

        const hasOpenPosition = [...(state.paperTrades ?? []), ...(state.liveTrades ?? [])].some((t) => t.status === "OPEN")

        if (state.settings.features.scanner) {
          const alreadyScannedThisCandle = state.scannerLastScanCandleOpenTime === candleOpenTime

          if (!alreadyScannedThisCandle) {
            let cachedCoingecko: { btcDominance?: number; marketCapChange24hPct?: number } | undefined
            let cachedDxy: { candles: { open: number; close: number }[] } | undefined

            const requested = SCAN_SYMBOLS
            const contracts = await fetch("/api/bingx/contracts", { cache: "no-store" })
              .then((r) => r.json())
              .catch(() => null)
            const contractRows: any[] = Array.isArray((contracts as any)?.data?.data)
              ? (contracts as any).data.data
              : Array.isArray((contracts as any)?.data)
                ? (contracts as any).data
                : []
            const activeSymbols = contractRows
              .map((x) => String((x as any)?.symbol ?? ""))
              .filter(Boolean)
              .filter((sym) => {
                const status = Number((contractRows.find((r) => String((r as any)?.symbol ?? "") === sym) as any)?.status ?? 1)
                return !Number.isFinite(status) || status === 1
              })
            const resolvedInfo = resolveScanSymbols({ requested, active: activeSymbols })
            console.log("[scanner] active symbols:", resolvedInfo.resolved)
            if (resolvedInfo.skipped.length) {
              console.log("[scanner] inactive symbols:", resolvedInfo.skipped)
            }
            if (Object.keys(resolvedInfo.aliasMap).length) {
              console.log("[scanner] symbol aliases:", resolvedInfo.aliasMap)
            }

            const scan = await scanAllSymbolsDetailed({
              settings: state.settings,
              symbols: resolvedInfo.resolved,
              aliasMap: resolvedInfo.aliasMap,
              maxConcurrent: 5,
              fetchKlines: async (sym, interval, limit) => {
                const res = await fetch(
                  `/api/bingx/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`,
                  { cache: "no-store" }
                )
                  .then(async (r) => {
                    const text = await r.text()
                    if (!r.ok || !text) return null
                    try {
                      return JSON.parse(text) as unknown
                    } catch {
                      return null
                    }
                  })
                  .catch(() => null)
                return parseKlines(res)
              },
              fetchFundingRatePct: async (sym) => {
                const res = await fetch(`/api/bingx/premiumIndex?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" })
                  .then(async (r) => {
                    const text = await r.text()
                    if (!r.ok || !text) return null
                    try {
                      return JSON.parse(text) as unknown
                    } catch {
                      return null
                    }
                  })
                  .catch(() => null)
                return parseFundingRatePct(res)
              },
              fetchCoingeckoGlobal: async () => {
                if (cachedCoingecko) return cachedCoingecko
                const res = await fetch("/api/market/coingecko", { cache: "no-store" }).then((r) => r.json())
                cachedCoingecko = {
                  btcDominance: res?.data?.btcDominance,
                  marketCapChange24hPct: res?.data?.marketCapChange24hPct
                }
                return cachedCoingecko
              },
              fetchDxyDaily: async () => {
                if (cachedDxy) return cachedDxy
                const res = await fetch("/api/market/dxy", { cache: "no-store" }).then((r) => r.json())
                cachedDxy = { candles: Array.isArray(res?.data?.candles) ? res.data.candles : [] }
                return cachedDxy
              },
              previousBtcDominance: state.lastBtcDominance
            })

            const results = scan.results
            const top = results[0]
            const aliasMap = resolvedInfo.aliasMap
            const actualToRequested = aliasMap
            const requestedToActual: Record<string, string> = {}
            for (const sym of resolvedInfo.resolved) {
              const req = actualToRequested[sym] ?? sym
              requestedToActual[req] = sym
            }

            const bySymbol = new Map(results.map((r) => [r.symbol.toUpperCase(), r] as const))
            const rows: ScannerRow[] = requested.map((req) => {
              const actual = requestedToActual[req] ?? null
              if (!actual) {
                return { symbol: req, displaySymbol: req, status: "INACTIVE" }
              }
              const scored = bySymbol.get(actual.toUpperCase())
              if (!scored) {
                return { symbol: actual, displaySymbol: req, status: "SKIPPED" }
              }
              const placeableTop = !hasOpenPosition && !state.pendingSignal && top && top.totalScore >= state.settings.minSetupScore
              const status =
                top && scored.symbol === top.symbol && placeableTop
                  ? "TRADE"
                  : scored.totalScore >= state.settings.minSetupScore
                    ? "WATCH"
                    : "BELOW"
              return {
                symbol: scored.symbol,
                displaySymbol: req,
                direction: scored.direction,
                totalScore: scored.totalScore,
                entryPrice: scored.entryPrice,
                suggestedSL: scored.suggestedSL,
                suggestedTP: scored.suggestedTP,
                rr: scored.rr,
                regime: scored.regime,
                topReason: scored.topReason,
                rank: scored.rank,
                scanTime: scored.scanTime,
                status
              }
            })
            rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))

            const selected = top
            const lastScanResult =
              selected && selected.snapshot
                ? {
                    symbol: selected.requestedSymbol ?? selected.symbol,
                    score: typeof selected.totalScore === "number" ? selected.totalScore : 0,
                    direction: selected.direction,
                    debug: {
                      volumeRatio:
                        typeof selected.snapshot.indicators?.volumeRatio === "number" && Number.isFinite(selected.snapshot.indicators.volumeRatio)
                          ? selected.snapshot.indicators.volumeRatio
                          : undefined,
                      rsiValue:
                        typeof selected.snapshot.indicators?.rsi14 === "number" && Number.isFinite(selected.snapshot.indicators.rsi14)
                          ? selected.snapshot.indicators.rsi14
                          : undefined,
                      histValue:
                        typeof selected.snapshot.indicators?.macdHist === "number" && Number.isFinite(selected.snapshot.indicators.macdHist)
                          ? selected.snapshot.indicators.macdHist
                          : undefined,
                      sessionActive: (selected.snapshot.scores?.session ?? 0) >= 5,
                      utcHour: new Date().getUTCHours()
                    }
                  }
                : {
                    symbol: state.settings.symbol,
                    score: 0,
                    direction: "LONG" as TradeSide,
                    debug: { utcHour: new Date().getUTCHours() }
                  }
            set({
              scannerResults: rows,
              scannerLastScanAt: Date.now(),
              scannerLastScanCandleOpenTime: candleOpenTime,
              scannerSelectedSymbol: selected?.symbol,
              lastScanResult,
              scannerTop: selected
                ? {
                    symbol: selected.symbol,
                    requestedSymbol: selected.requestedSymbol,
                    direction: selected.direction,
                    totalScore: selected.totalScore,
                    snapshot: selected.snapshot
                  }
                : undefined
            })

            if (state.settings.notifications.scanner) {
              const placeable = !hasOpenPosition && !state.pendingSignal && top && top.totalScore >= state.settings.minSetupScore
              const scannedRows = rows.filter((r) => r.status !== "INACTIVE" && r.status !== "SKIPPED")
              const scanned = scannedRows.length
              const below = scannedRows.filter((r) => r.status === "BELOW").length
              const lines: string[] = []
              const tfLabel = state.settings.timeframe.toUpperCase()
              lines.push(`📡 <b>SCANNER — ${tfLabel} RESULTS</b>`)
              lines.push(`━━━━━━━━━━━━━━`)
              lines.push(`Timeframe: ${tfLabel}`)
              lines.push(`Scanned: ${scanned} symbols`)
              lines.push(``)

              const medals = ["🥇", "🥈", "🥉"]
              for (let i = 0; i < Math.min(3, scannedRows.length); i += 1) {
                const r = scannedRows[i]!
                const badge = medals[i] ?? `${i + 1}.`
                const display = r.displaySymbol ?? r.symbol
                const dir = r.direction ?? ("N/A" as any)
                const score = typeof r.totalScore === "number" ? r.totalScore : 0
                const label = i === 0 ? (placeable ? " ← TRADING" : " ← SELECTED") : ""
                lines.push(`${badge} ${display} ${dir} ${score}/100${label}`)
              }

              if (below > 0) lines.push(`❌ ${below} symbols below threshold`)
              if (placeable && top) lines.push(`\n✅ Trade placed: ${top.requestedSymbol ?? top.symbol}`)
              void sendTelegramMessage(lines.join("\n"))
            }
          }

          const snapshotState = alreadyScannedThisCandle ? state : get()
          const top = snapshotState.scannerTop
          const lastScanResult = snapshotState.lastScanResult

          if (!hasOpenPosition && !state.pendingSignal) {
            if (!top || top.totalScore < state.settings.minSetupScore) {
              if (state.settings.notifications.scanner) {
                const best = top?.totalScore ?? lastScanResult?.score ?? 0
                const bestSymRaw = top?.requestedSymbol ?? top?.symbol ?? lastScanResult?.symbol ?? state.settings.symbol
                const bestSym = bestSymRaw.replace("-", "/")
                const dir = top?.direction ?? lastScanResult?.direction ?? "LONG"
                const gap = Math.max(0, state.settings.minSetupScore - best)
                const indicators = top?.snapshot?.indicators
                const scores = top?.snapshot?.scores
                const volumeRatio =
                  typeof indicators?.volumeRatio === "number" && Number.isFinite(indicators.volumeRatio)
                    ? indicators.volumeRatio
                    : typeof lastScanResult?.debug?.volumeRatio === "number"
                      ? lastScanResult.debug.volumeRatio
                      : undefined
                const rsiValue =
                  typeof indicators?.rsi14 === "number" && Number.isFinite(indicators.rsi14)
                    ? indicators.rsi14
                    : typeof lastScanResult?.debug?.rsiValue === "number"
                      ? lastScanResult.debug.rsiValue
                      : undefined
                const histValue =
                  typeof indicators?.macdHist === "number" && Number.isFinite(indicators.macdHist)
                    ? indicators.macdHist
                    : typeof lastScanResult?.debug?.histValue === "number"
                      ? lastScanResult.debug.histValue
                      : undefined
                const utcHour = new Date().getUTCHours()
                const sessionActive = (scores?.session ?? 0) >= 5

                const missing: string[] = []
                if ((scores?.volumeSpike ?? 0) === 0) missing.push(`• Volume too low${volumeRatio !== undefined ? ` (${volumeRatio.toFixed(2)}x)` : ""}`)
                if ((scores?.macd ?? 0) === 0) missing.push(`• MACD bearish${histValue !== undefined ? ` (hist: ${histValue.toFixed(0)})` : ""}`)
                if ((scores?.rsi ?? 0) === 0) missing.push(`• RSI out of range`)
                if ((scores?.session ?? 0) < 5) missing.push(`• Outside active session`)
                const missingText = missing.length ? missing.join("\n") : `• Score below threshold`

                const tfLabel = state.settings.timeframe.toUpperCase()
                const msg = `⏭ <b>NO SETUP TODAY</b>
━━━━━━━━━━━━━━
Best score: ${bestSym} ${dir} ${best}/100
Required: ${state.settings.minSetupScore}/100
Gap: ${gap} points needed

Missing filters:
${missingText}

Market conditions:
Volume: ${volumeRatio !== undefined ? `${volumeRatio.toFixed(2)}x avg` : "N/A"}
RSI: ${rsiValue !== undefined ? rsiValue.toFixed(1) : "N/A"}
MACD hist: ${histValue !== undefined ? histValue.toFixed(1) : "N/A"}
Session: ${sessionActive ? "Active" : "Inactive"}
UTC Hour: ${utcHour}:00

Next scan: ${tfLabel} candle close`
                void sendTelegramMessage(msg)
              }
              set({
                strategySnapshot: {
                  totalScore: top?.totalScore ?? 0,
                  scores: state.strategySnapshot?.scores ?? ({} as any),
                  reasons: [top ? "Scanner: top result below min score" : "Scanner: no qualified setups"],
                  blocked: true,
                  blocks: [top ? `Top score ${top.totalScore}/100 < min ${state.settings.minSetupScore}` : "No qualified setups"],
                  indicators: {},
                  asOf: now
                }
              })
              return
            }

            if (top.symbol && state.settings.symbol !== top.symbol) {
              set((s) => {
                const next: Settings = { ...s.settings, symbol: top.symbol }
                scheduleSettingsEnvSync(next)
                return { settings: next }
              })
            }
          }
        }

        const tradesToday = state.dailyTradeCount[today] ?? 0
        if (tradesToday >= state.settings.maxTradesPerDay) return

        const liveState = get()
        const symbol = liveState.settings.symbol
        const interval = liveState.settings.timeframe
        const klinesRes = await fetch(
          `/api/bingx/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=400`,
          { cache: "no-store" }
        )
          .then(async (r) => {
            const text = await r.text()
            if (!r.ok || !text) return null
            try {
              return JSON.parse(text) as unknown
            } catch {
              return null
            }
          })
          .catch(() => null)
        if (!klinesRes) {
          set({
            strategySnapshot: {
              totalScore: 0,
              scores: state.strategySnapshot?.scores ?? ({} as any),
              reasons: ["Failed to load klines"],
              blocked: true,
              blocks: ["Failed to load klines (check BingX keys / server response)"],
              indicators: {},
              asOf: now
            }
          })
          return
        }
        const candles = parseKlines(klinesRes)
        const closedCandles = candles.filter((c) => c.openTime < candleOpenTime)
        if (closedCandles.length < 210) {
          set({
            strategySnapshot: {
              totalScore: 0,
              scores: state.strategySnapshot?.scores ?? ({} as any),
              reasons: ["Not enough candles"],
              blocked: false,
              blocks: [],
              indicators: {},
              asOf: now
            }
          })
          return
        }
        const lastClosed = closedCandles[closedCandles.length - 1]
        const prevClosed = closedCandles[closedCandles.length - 2]
        const lastCandleUp = lastClosed && prevClosed ? lastClosed.close > prevClosed.close : undefined

        const regimeSnap = state.settings.features.marketRegime ? detectMarketRegime(closedCandles) : undefined
        if (regimeSnap) {
          set({ marketRegime: regimeSnap })
          if (state.lastRegime !== regimeSnap.regime) {
            set({ lastRegime: regimeSnap.regime })
            if (state.settings.notifications.regime && state.lastRegime) {
              const strategy =
                regimeSnap.regime === "RANGING"
                  ? "Mean reversion"
                  : regimeSnap.regime === "TRENDING_BULL" || regimeSnap.regime === "TRENDING_BEAR"
                    ? "EMA trend following"
                    : "Volatility control"
              const current =
                regimeSnap.regime === "TRENDING_BULL" || regimeSnap.regime === "TRENDING_BEAR"
                  ? `${regimeSnap.regime} ✅`
                  : regimeSnap.regime
              const msg = `🔄 <b>REGIME CHANGED</b>
━━━━━━━━━━━━━━
${state.settings.symbol.replace("-", "/")}
Previous: ${state.lastRegime}
Current: ${current}
Strategy: ${strategy}
ADX: ${regimeSnap.adx14.toFixed(1)}`
              void sendTelegramMessage(msg)
            }
          }
        }

        if (regimeSnap && (regimeSnap.regime === "TRENDING_BULL" || regimeSnap.regime === "TRENDING_BEAR")) {
          const closes = closedCandles.map((c) => c.close)
          const ema20 = emaSeriesLast(closes, 20)
          let changed = false
          const nextTrades = state.paperTrades.map((t) => {
            if (t.status !== "OPEN") return t
            if (t.regime !== "TRENDING_BULL" && t.regime !== "TRENDING_BEAR") return t
            if (t.side === "LONG") {
              const nextSl = roundUsd(Math.max(t.stopLossPrice, Math.min(ema20, t.takeProfitPrice)))
              if (nextSl > t.stopLossPrice) {
                changed = true
                return { ...t, stopLossPrice: nextSl }
              }
              return t
            }
            const nextSl = roundUsd(Math.min(t.stopLossPrice, Math.max(ema20, t.takeProfitPrice)))
            if (nextSl < t.stopLossPrice) {
              changed = true
              return { ...t, stopLossPrice: nextSl }
            }
            return t
          })
          if (changed) set({ paperTrades: nextTrades })
        }

        const bookTickerRes = await fetch(`/api/bingx/bookTicker?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store"
        }).then((r) => r.json())
        const { bid, ask } = parseBookTicker(bookTickerRes)
        const spreadPct =
          bid !== undefined && ask !== undefined && bid > 0 && ask > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 100 : undefined

        const depthRes = await fetch(`/api/bingx/depth?symbol=${encodeURIComponent(symbol)}&limit=20`, {
          cache: "no-store"
        }).then((r) => r.json())
        const depthData = (depthRes as any)?.data ?? depthRes
        const bids = Array.isArray(depthData?.bids) ? depthData.bids : []
        const asks = Array.isArray(depthData?.asks) ? depthData.asks : []
        const orderBookDepthOk = bids.length >= 5 && asks.length >= 5

        const premiumRes = await fetch(`/api/bingx/premiumIndex?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store"
        }).then((r) => r.json())
        const fundingRatePct = parseFundingRatePct(premiumRes)

        const oi = await fetch(`/api/bingx/openInterest?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((x) => parseOpenInterest(x))
          .catch(() => undefined)
        const lastOi = state.lastOpenInterest
        const openInterestChangePct = oi !== undefined && lastOi !== undefined && lastOi > 0 ? ((oi - lastOi) / lastOi) * 100 : undefined
        if (oi !== undefined) set({ lastOpenInterest: oi })

        const fearGreed = await fetch("/api/sentiment/fng", { cache: "no-store" })
          .then((r) => r.json())
          .then((x) => parseFearGreed(x))
          .catch(() => undefined)
        if (fearGreed !== undefined) set({ lastFearGreed: fearGreed })

        const dailyBias =
          state.settings.filters.htfDailyBias && state.settings.timeframe === "4h"
            ? await fetch(
                `/api/bingx/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=260`,
                { cache: "no-store" }
              )
                .then(async (r) => {
                  const text = await r.text()
                  if (!r.ok || !text) return null
                  try {
                    return JSON.parse(text) as unknown
                  } catch {
                    return null
                  }
                })
                .then((x) => computeDailyBias(parseKlines(x), now))
                .catch(() => undefined)
            : undefined

        const inNewsBlackout =
          state.settings.features.newsFilter && state.settings.filters.newsBlackout
            ? await fetch(
                `/api/news/status?blackoutMinutes=${encodeURIComponent(
                  state.settings.thresholds.newsBlackoutMinutes
                )}&currencies=USD`,
                { cache: "no-store" }
              )
                .then((r) => r.json())
                .then((x) => x?.data?.state === "ACTIVE")
                .catch(() => false)
            : false

        const ctx = {
          spreadPct,
          fundingRatePct,
          orderBookDepthOk,
          openInterest: oi,
          openInterestChangePct,
          fearGreed,
          dailyBias,
          inNewsBlackout,
          lastCandleUp,
          now
        }

        if (state.pendingSignal) {
          const ps = state.pendingSignal
          if (
            ps.symbol === symbol &&
            ps.timeframe === state.settings.timeframe &&
            candleOpenTime >= ps.enterAtCandleOpenTime
          ) {
            if (hasOpenPosition) {
              set({ pendingSignal: undefined })
              return
            }
            const entryCandle = candles.find((c) => c.openTime === candleOpenTime)
            const entryPrice = entryCandle?.open ?? lastClosed?.close ?? 0
            await placeTradeFromSignal({
              symbol,
              side: ps.side,
              snapshot: ps.snapshot,
              entryPrice,
              candles: closedCandles,
              ctx,
              regime: ps.regime,
              sizeMultiplier: ps.sizeMultiplier,
              chartImageBase64: ps.chartImageBase64
            })
            set({ pendingSignal: undefined })
          }
          return
        }

        let sizeMultiplier = 1
        if (regimeSnap?.regime === "VOLATILE") {
          if (regimeSnap.volatileMode === "SKIP") {
            if (state.settings.notifications.marketMonitor) {
              void sendTelegramMessage("🚨 FLASH MOVE DETECTED\n━━━━━━━━━━━━━━\n⛔ All trades PAUSED\nReason: Extreme volatility\nResume: After 2 stable candles")
            }
            set({ pausedUntil: candleOpenTime + 2 * intervalMs })
            return
          }
          if (regimeSnap.volatileMode === "REDUCE_50") sizeMultiplier = 0.5
        }

        let chosenSide: TradeSide | null = null
        let snapshot: StrategySnapshot | null = null

        if (state.settings.features.marketRegime && regimeSnap) {
          if (regimeSnap.regime === "TRENDING_BULL") {
            chosenSide = "LONG"
            snapshot = scoreSetup(closedCandles, "LONG", state.settings, ctx)
            if (!emaCrossover(closedCandles, "BULLISH")) {
              snapshot = { ...snapshot, blocked: true, blocks: ["EMA 20/50 crossover not present (trending entry rule)"] }
            }
          } else if (regimeSnap.regime === "TRENDING_BEAR") {
            chosenSide = "SHORT"
            snapshot = scoreSetup(closedCandles, "SHORT", state.settings, ctx)
            if (!emaCrossover(closedCandles, "BEARISH")) {
              snapshot = { ...snapshot, blocked: true, blocks: ["EMA 20/50 crossover not present (trending entry rule)"] }
            }
          } else if (regimeSnap.regime === "RANGING") {
            const longOk = rangingEntryOk(closedCandles, "LONG")
            const shortOk = rangingEntryOk(closedCandles, "SHORT")
            if (longOk) {
              chosenSide = "LONG"
              snapshot = scoreSetup(closedCandles, "LONG", state.settings, ctx)
            } else if (shortOk) {
              chosenSide = "SHORT"
              snapshot = scoreSetup(closedCandles, "SHORT", state.settings, ctx)
            } else {
              chosenSide = null
              snapshot = scoreSetup(closedCandles, "LONG", state.settings, ctx)
              snapshot = { ...snapshot, blocked: true, blocks: ["Ranging rule: wait for BB touch + RSI extreme"] }
            }
          } else {
            const evalRes = evaluateSetup(closedCandles, state.settings, ctx)
            chosenSide = evalRes.side
            snapshot = evalRes.snapshot
          }
        } else {
          const evalRes = evaluateSetup(closedCandles, state.settings, ctx)
          chosenSide = evalRes.side
          snapshot = evalRes.snapshot
        }

        if (state.settings.features.scanner) {
          const top = get().scannerTop
          if (top && top.symbol === symbol && top.totalScore >= state.settings.minSetupScore) {
            chosenSide = top.direction
            snapshot = top.snapshot
          }
        }

        if (!snapshot || !chosenSide) return

        if (monitorFlags) {
          if (monitorFlags.longsBlockedUntil && now < monitorFlags.longsBlockedUntil && chosenSide === "LONG") {
            const reason = monitorFlags.note ? `${monitorFlags.note} — longs blocked` : "Market monitor — longs blocked"
            if (state.settings.notifications.marketMonitor) void sendTelegramMessage(`🚫 ${reason}`)
            set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [reason] } })
            return
          }
          if (monitorFlags.shortsBlockedUntil && now < monitorFlags.shortsBlockedUntil && chosenSide === "SHORT") {
            const reason = monitorFlags.note ? `${monitorFlags.note} — shorts blocked` : "Market monitor — shorts blocked"
            if (state.settings.notifications.marketMonitor) void sendTelegramMessage(`🚫 ${reason}`)
            set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [reason] } })
            return
          }
        }

        if (state.settings.features.correlationFilter) {
          const decision = await evaluateCorrelation({
            symbol,
            side: chosenSide,
            fetchKlines: async (sym, interval, limit) => {
              const res = await fetch(
                `/api/bingx/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`,
                { cache: "no-store" }
              )
                .then(async (r) => {
                  const text = await r.text()
                  if (!r.ok || !text) return null
                  try {
                    return JSON.parse(text) as unknown
                  } catch {
                    return null
                  }
                })
                .catch(() => null)
              return parseKlines(res)
            },
            fetchCoingeckoGlobal: async () => {
              const res = await fetch("/api/market/coingecko", { cache: "no-store" }).then((r) => r.json())
              return { btcDominance: res?.data?.btcDominance, marketCapChange24hPct: res?.data?.marketCapChange24hPct }
            },
            fetchDxyDaily: async () => {
              const res = await fetch("/api/market/dxy", { cache: "no-store" }).then((r) => r.json())
              return { candles: Array.isArray(res?.data?.candles) ? res.data.candles : [] }
            },
            previousBtcDominance: state.lastBtcDominance
          })

          set({ lastCorrelation: decision })
          if (decision.details.btcDominance !== undefined) set({ lastBtcDominance: decision.details.btcDominance })

          if (decision.blocked) {
            const msg = `🚫 TRADE BLOCKED — CORRELATION
━━━━━━━━━━━━━━
Wanted: ${symbol.replace("-", "/")} ${chosenSide}
Blocked by: BTC correlation
Reason: ${decision.blockReason ?? "Correlation rule"}
Action: Waiting for BTC stabilization
Next check: 4H candle close`
            if (state.settings.notifications.correlation) void sendTelegramMessage(msg)
            set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [decision.blockReason ?? "Correlation block"] } })
            return
          }

          const adjusted = Math.max(0, Math.min(100, snapshot.totalScore + decision.scoreDelta))
          if (decision.details.btcAligned === false && adjusted < state.settings.minSetupScore) {
            const reason = "BTC trend gate opposing direction (BTC 4H below/above EMA20)"
            const msg = `🚫 TRADE BLOCKED — CORRELATION
━━━━━━━━━━━━━━
Wanted: ${symbol.replace("-", "/")} ${chosenSide}
Blocked by: BTC correlation
Reason: ${reason}
Action: Waiting for BTC stabilization
Next check: 4H candle close`
            if (state.settings.notifications.correlation) void sendTelegramMessage(msg)
            set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [reason] } })
            return
          }
          snapshot = {
            ...snapshot,
            totalScore: adjusted,
            reasons: [
              ...snapshot.reasons,
              ...(decision.warnings.length ? decision.warnings : []),
              ...(decision.scoreDelta !== 0 ? [`Correlation score delta: ${decision.scoreDelta > 0 ? "+" : ""}${decision.scoreDelta}`] : [])
            ]
          }
        }

        if (state.settings.features.smc) {
          const smc = scoreSmc(closedCandles, chosenSide, state.settings.timeframe === "1d" ? "1D" : "4H")
          if (state.settings.notifications.smc) void sendTelegramMessage(smc.summary)
          if (smc.blocked) {
            set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [smc.blockReason ?? "SMC block"] } })
            return
          }
          if (smc.scoreDelta !== 0) {
            snapshot = {
              ...snapshot,
              totalScore: Math.max(0, Math.min(100, snapshot.totalScore + smc.scoreDelta)),
              reasons: [...snapshot.reasons, `SMC score delta: ${smc.scoreDelta > 0 ? "+" : ""}${smc.scoreDelta}`]
            }
          }
        }

        if (state.settings.features.onChain && snapshot.totalScore >= 60) {
          const base = symbol.split("-")[0] ?? "BTC"
          const res = await fetch(`/api/onchain/score?symbol=${encodeURIComponent(base)}`, { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null)
          const total = Number(res?.data?.totalScore ?? 0)
          const summary = String(res?.data?.summary ?? "")
          if (Number.isFinite(total) && total !== 0) {
            snapshot = {
              ...snapshot,
              totalScore: Math.max(0, Math.min(100, snapshot.totalScore + total)),
              reasons: [...snapshot.reasons, `On-chain score delta: ${total > 0 ? "+" : ""}${total}`, ...(summary ? [summary] : [])]
            }
            if (state.settings.notifications.onChain) {
              const signals = Array.isArray(res?.data?.signals) ? res.data.signals : []
              const net = signals.find((s: any) => String(s?.description ?? "").toLowerCase().includes("netflow"))
              const fg = signals.find((s: any) => String(s?.description ?? "").toLowerCase().includes("fear"))
              const mk = signals.find((s: any) => String(s?.description ?? "").toLowerCase().includes("market cap"))
              const liqUp = res?.data?.liqMagnets?.nearestShortMagnet
              const liqDown = res?.data?.liqMagnets?.nearestLongMagnet
              const msg = `🔗 ON-CHAIN INTELLIGENCE
━━━━━━━━━━━━━━
${net?.description ?? "Exchange netflow: —"}
${fg?.description ?? "Fear & Greed: —"}
${mk?.description ?? "Market cap 24h: —"}

📊 On-Chain Score: ${total > 0 ? "+" : ""}${total} pts
💡 Summary: ${summary || "—"}
🎯 Liq magnet above: ${liqUp ? `$${Number(liqUp).toFixed(0)}` : "—"}
🎯 Liq magnet below: ${liqDown ? `$${Number(liqDown).toFixed(0)}` : "—"}`
              void sendTelegramMessage(msg)
            }
          }
        }

        if (state.settings.features.sentiment && snapshot.totalScore >= 60) {
          const res = await fetch("/api/sentiment/combined", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
          const add = Number(res?.data?.setupScoreAddition ?? 0)
          if (Number.isFinite(add) && add !== 0) {
            snapshot = {
              ...snapshot,
              totalScore: Math.max(0, Math.min(100, snapshot.totalScore + add)),
              reasons: [...snapshot.reasons, `Sentiment score delta: ${add > 0 ? "+" : ""}${add}`]
            }
          }
        }

        let chartImageBase64: string | undefined
        set({ strategySnapshot: snapshot })

        if (snapshot.blocked) {
          const msg = snapshot.blocks[0]
          if (msg) {
            const prev = state.lastSkipDay === today && state.lastSkipMessage === msg
            if (!prev) {
              set({ lastSkipDay: today, lastSkipMessage: msg })
              void sendTelegramMessage(`⚠️ ${msg}`)
            }
          }
          return
        }

        if (state.settings.features.preTradeAlerts && snapshot.totalScore >= 60 && snapshot.totalScore < state.settings.minSetupScore) {
          const key = `${today}-${candleOpenTime}-${symbol}-${chosenSide}-forming`
          if (state.lastPreTradeAlertKey !== key && state.settings.notifications.preTrade && acquireAlertLock(key, 6 * 60_000)) {
            set({ lastPreTradeAlertKey: key })
            const confirmed = confirmedFilters(snapshot)
            const missing = missingFilters(state.settings, snapshot)
            const nextClose = new Date(candleOpenTime + intervalMs).toUTCString()
            const primaryMissing = missing[0] ?? "primary filter"
            const msg = `⚡ SETUP FORMING — WATCH THIS
━━━━━━━━━━━━━━
📊 ${symbol.replace("-", "/")} ${chosenSide}
📈 Current Score: ${snapshot.totalScore}/100
⚠️ Need ${state.settings.minSetupScore - snapshot.totalScore} more points to trigger

✅ Confirmed filters:
${confirmed.map((f) => `• ${f}`).join("\n")}

❌ Missing filters:
${missing.map((m) => `• ${m} — not confirmed`).join("\n")}

🕐 Next candle close: ${nextClose}
📋 Regime: ${regimeSnap?.regime ?? "—"}
💡 Watch for: ${primaryMissing} confirmation`
            void sendTelegramMessage(msg)
          }
          return
        }

        if (snapshot.totalScore < state.settings.minSetupScore) {
          const msg = `⚠️ No setup found today — score too low (${snapshot.totalScore}/100)`
          const prev = state.lastSkipDay === today && state.lastSkipMessage === msg
          if (!prev) {
            set({ lastSkipDay: today, lastSkipMessage: msg })
            void sendTelegramMessage(msg)
          }
          return
        }

        if (state.settings.features.patternRecognition) {
          const pr = await fetch("/api/ai/pattern", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol, timeframe: state.settings.timeframe, direction: chosenSide })
          })
            .then((r) => r.json())
            .catch(() => null)
          if (pr?.ok && pr?.data) {
            chartImageBase64 = typeof pr.data.imageBase64 === "string" ? pr.data.imageBase64 : undefined
            const hb = pr.data.hardBlock as { blocked: boolean; reason?: string } | undefined
            if (state.settings.notifications.patternRecognition && pr.data.message) {
              void sendTelegramMessage(String(pr.data.message), chartImageBase64)
            }
            if (hb?.blocked) {
              const reason = hb.reason ?? "AI pattern hard block"
              set({ strategySnapshot: { ...snapshot, blocked: true, blocks: [reason] } })
              return
            }
            const delta = Number(pr.data.scoreDelta ?? 0)
            if (Number.isFinite(delta) && delta !== 0) {
              snapshot = {
                ...snapshot,
                totalScore: Math.max(0, Math.min(100, snapshot.totalScore + delta)),
                reasons: [...snapshot.reasons, `Pattern score delta: ${delta > 0 ? "+" : ""}${delta}`]
              }
              set({ strategySnapshot: snapshot })
              if (snapshot.totalScore < state.settings.minSetupScore) return
            }
          }
        }

        const fireKey = `${today}-${candleOpenTime}-${symbol}-${chosenSide}-fire`
        if (
          !hasOpenPosition &&
          state.settings.features.preTradeAlerts &&
          state.settings.notifications.preTrade &&
          state.lastPreTradeAlertKey !== fireKey &&
          acquireAlertLock(fireKey, 6 * 60_000)
        ) {
          set({ lastPreTradeAlertKey: fireKey })
          const fixed = isFixedCompounding(state.settings)
          const entryEstimate = await getLivePrice(symbol).catch(() => lastClosed?.close ?? 0)

          const lockedTotal = Object.values(state.lockedProfitByLevel).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
          const equityNow = state.equityCurve[0]?.equity ?? balanceUsd
          const availableEquity =
            state.settings.features.partialProfitLock ? Math.max(0, equityNow - lockedTotal) : equityNow

          const plan = generateCompoundingPlan(state.settings)
          const activeLevel = getActiveLevel(state.settings.compounding.levels, state.completedLevels)
          const active = plan.find((x) => x.level === activeLevel)

          const msg = fixed && active && entryEstimate > 0
            ? (() => {
                const position = calcFixedCompoundingPosition({
                  levelBalanceUsd: active.balanceUsd,
                  levelTargetUsd: active.endingBalanceUsd,
                  levelRiskUsd: active.riskUsd,
                  entryPrice: entryEstimate,
                  side: chosenSide,
                  leverage: state.settings.risk.leverage
                })

                return `🎯 TRADE ABOUT TO FIRE
━━━━━━━━━━━━━━
📊 ${symbol.replace("-", "/")} ${chosenSide}
✅ Score: ${snapshot.totalScore}/100 — ALL FILTERS MET
━━━━━━━━━━━━━━
💰 Level ${activeLevel} — Full Balance
Margin: $${position.margin.toFixed(2)} (100%)
Position: $${position.positionValue.toFixed(2)} (${position.leverage}x)
Quantity: ${position.quantity.toFixed(6)}
━━━━━━━━━━━━━━
💵 Entry: $${formatUsdPrice(position.entryPrice)}
🎯 TP1: $${formatUsdPrice(position.tp1Price)} (+$${position.profitTargetUsd.toFixed(2)})
🎯 TP2: $${formatUsdPrice(position.tp2Price)}
🛑 SL: $${formatUsdPrice(position.slPrice)} (-$${position.maxLossUsd.toFixed(2)})
📊 RR: 1:${position.rr.toFixed(2)}
━━━━━━━━━━━━━━
🎯 Goal: $${active.balanceUsd.toFixed(2)} → $${active.endingBalanceUsd.toFixed(2)}
⏳ Placing in 30 seconds...
[CANCEL THIS TRADE /skip]`
              })()
            : (() => {
                const baseRiskUsd = (availableEquity * state.settings.compounding.riskPctOfBalance) / 100
                const riskUsd = Math.max(0, baseRiskUsd * Math.max(0.01, sizeMultiplier))
                const calc = entryEstimate ? buildRegimeStops(state.settings, chosenSide, entryEstimate, closedCandles, regimeSnap) : null
                const tp = calc?.takeProfitPrice
                const sl = calc?.stopLossPrice
                return `🎯 TRADE ABOUT TO FIRE
━━━━━━━━━━━━━━
📊 ${symbol.replace("-", "/")} ${chosenSide}
✅ Score: ${snapshot.totalScore}/100 — ALL FILTERS MET
⏳ Placing order in 30 seconds...
💰 Size: $${Math.round(riskUsd)} | Lev: ${state.settings.risk.leverage}x
🎯 TP: ${tp ? `$${formatUsdPrice(tp)}` : "—"} | 🛑 SL: ${sl ? `$${formatUsdPrice(sl)}` : "—"}
[CANCEL THIS TRADE /skip]
📋 Regime: ${regimeSnap?.regime ?? "—"}
💡 Entry (est): ${entryEstimate ? `$${formatUsdPrice(entryEstimate)}` : "—"}`
              })()
          void sendTelegramMessage(msg)
        }

        window.setTimeout(async () => {
          const cur = useBotStore.getState()
          const openNow = [...(cur.paperTrades ?? []), ...(cur.liveTrades ?? [])].some((t) => t.status === "OPEN")
          const cmd = await fetch("/api/bot/command", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
          if (cmd?.data?.skipOnce === true) {
            await fetch("/api/bot/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ skipOnce: false })
            }).catch(() => undefined)
            void sendTelegramMessage("⚠️ Trade skipped by user command")
            return
          }

          if (!openNow) {
            const entryPrice = await getLivePrice(symbol).catch(() => lastClosed?.close ?? 0)
            await placeTradeFromSignal({
              symbol,
              side: chosenSide as TradeSide,
              snapshot: snapshot as StrategySnapshot,
              entryPrice,
              candles: closedCandles,
              ctx,
              regime: regimeSnap,
              sizeMultiplier,
              chartImageBase64
            })
          } else if (acquireAlertLock(`${fireKey}-blocked`, 2 * 60_000)) {
            void sendTelegramMessage(`⚠️ Trade not placed — existing OPEN position detected in app`)
          }
        }, 30_000)
      },

      checkLiquidationDangerNow: async () => {
        const s = get()
        const now = Date.now()
        if (!s.settings.features.liquidationHeatmap) return
        if (!s.settings.notifications.liquidationHeatmap) return
        if (s.lastHeatmapDangerCheckAt && now - s.lastHeatmapDangerCheckAt < 25_000) return
        set({ lastHeatmapDangerCheckAt: now })

        const open = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])].find((t) => t.status === "OPEN")
        if (!open) return

        const heatmap = await getLiquidationHeatmap({
          symbol: open.symbol,
          exchange: s.settings.thresholds.liquidationExchange,
          range: s.settings.thresholds.liquidationRange
        }).catch(() => null)
        if (!heatmap || heatmap.levels.length === 0 || heatmap.currentPrice <= 0) return

        const slLevel = findLevelNearPrice({
          heatmap,
          price: open.stopLossPrice,
          withinPct: 0.005
        })

        if (slLevel && slLevel.totalLiquidation > 10_000_000) {
          const key = `sl-${open.symbol}-${Math.round(slLevel.price)}-${Math.round(slLevel.totalLiquidation / 1_000_000)}`
          if (s.lastHeatmapDangerAlertKey !== key) {
            set({ lastHeatmapDangerAlertKey: key })
            const msg = `⚠️ LIQUIDATION DANGER NEAR SL
━━━━━━━━━━━━━━
${open.symbol.replace("-", "/")} ${open.side}
SL at: $${open.stopLossPrice.toFixed(2)}
Liquidation cluster: $${(slLevel.totalLiquidation / 1_000_000).toFixed(1)}M
Risk: Slippage possible on SL hit
Suggestion: Move SL beyond cluster`
            void sendTelegramMessage(msg)
          }
        }

        const danger = findDangerLevels({
          heatmap,
          direction: open.side,
          minUsd: 20_000_000
        })[0]

        if (danger) {
          const distancePercent = (Math.abs(danger.price - heatmap.currentPrice) / heatmap.currentPrice) * 100
          if (distancePercent < 1.5) {
            const key = `wall-${open.symbol}-${Math.round(danger.price)}-${Math.round(danger.totalLiquidation / 1_000_000)}`
            if (s.lastHeatmapDangerAlertKey !== key) {
              set({ lastHeatmapDangerAlertKey: key })
              const msg = `🚨 LARGE LIQUIDATION WALL APPROACHING
━━━━━━━━━━━━━━
${open.symbol.replace("-", "/")} ${open.side}
Danger level: $${danger.price.toFixed(2)}
Distance: ${distancePercent.toFixed(2)}% away
Liquidation: $${(danger.totalLiquidation / 1_000_000).toFixed(1)}M
Advice: Consider early exit or tighten SL`
              void sendTelegramMessage(msg)
            }
          }
        }
      },

      onPriceTick: (price) => {
        const s = get()
        const now = Date.now()

        const partials: { next: Trade; pnlUsd: number; message: string }[] = []
        const updated: Trade[] = []
        const closed: Trade[] = []

        for (const t of s.paperTrades) {
          if (t.status !== "OPEN") {
            updated.push(t)
            continue
          }
          let trade = t
          if (s.settings.risk.trailingStopEnabled && s.settings.features.adaptiveLevels) {
            const atr =
              typeof trade.indicators?.atr14 === "number" && Number.isFinite(trade.indicators.atr14)
                ? trade.indicators.atr14
                : Math.max(
                    Math.abs(trade.entryPrice - trade.stopLossPrice) / Math.max(1, s.settings.risk.slAtrMultiplier),
                    (trade.entryPrice * 0.2) / 100
                  )

            const peak =
              typeof trade.peakPrice === "number" && Number.isFinite(trade.peakPrice) ? trade.peakPrice : trade.entryPrice
            const trail = updateTrailingStop({
              direction: trade.side,
              entryPrice: trade.entryPrice,
              takeProfitPrice: trade.takeProfitPrice,
              currentStopLoss: trade.stopLossPrice,
              currentPrice: price,
              peakPrice: peak,
              atr
            })

            const moved = Math.abs(trail.currentStopPrice - trade.stopLossPrice) > atr * 0.1
            const okToAlert = !trade.lastTrailingUpdateAt || now - trade.lastTrailingUpdateAt > 60_000

            if (trail.active && moved) {
              const next: Trade = {
                ...trade,
                stopLossPrice: Math.max(0, trail.currentStopPrice),
                peakPrice: trail.peakPrice,
                trailingActive: true,
                lastTrailingUpdateAt: moved && okToAlert ? now : trade.lastTrailingUpdateAt
              }
              trade = next

              if (moved && okToAlert && s.settings.notifications.marketMonitor) {
                const profitPct =
                  trade.entryPrice > 0
                    ? ((trade.side === "LONG" ? price - trade.entryPrice : trade.entryPrice - price) / trade.entryPrice) * 100
                    : undefined
                const lockedPct =
                  trade.entryPrice > 0
                    ? ((trade.side === "LONG" ? trade.stopLossPrice - trade.entryPrice : trade.entryPrice - trade.stopLossPrice) /
                        trade.entryPrice) *
                      100
                    : undefined
                const msg = `📈 <b>TRAILING STOP MOVED</b>
━━━━━━━━━━━━━━
${trade.symbol.replace("-", "/")} ${trade.side}
Profit: ${profitPct !== undefined ? `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%` : "—"}
Old SL: $${formatUsdPrice(t.stopLossPrice)}
New SL: $${formatUsdPrice(trade.stopLossPrice)} ✅
Peak: $${formatUsdPrice(trail.peakPrice)}
Locked: ${lockedPct !== undefined ? `${lockedPct >= 0 ? "+" : ""}${lockedPct.toFixed(2)}% profit` : "—"}`
                void sendTelegramMessage(msg)
              }
            } else {
              trade = { ...trade, peakPrice: trail.peakPrice, trailingActive: trade.trailingActive || trail.active }
            }
          }

          const stage = trade.tpStage ?? 1
          const tp1Hit =
            stage === 1 && (trade.side === "LONG" ? price >= trade.takeProfitPrice : price <= trade.takeProfitPrice)
          if (tp1Hit && trade.tp2Price) {
            const closeQty = trade.quantity * 0.5
            const remainQty = Math.max(0, trade.quantity - closeQty)
            const pnlUsd =
              trade.side === "LONG"
                ? (trade.takeProfitPrice - trade.entryPrice) * closeQty
                : (trade.entryPrice - trade.takeProfitPrice) * closeQty
            const next: Trade = {
              ...trade,
              quantity: remainQty,
              realizedPnlUsd: roundUsd((trade.realizedPnlUsd ?? 0) + pnlUsd),
              stopLossPrice: roundPrice(trade.entryPrice),
              takeProfitPrice: roundPrice(trade.tp2Price),
              tpStage: 2,
              trailingActive: true
            }
            const msg = `🎯 <b>TP1 HIT — PARTIAL CLOSE</b>
━━━━━━━━━━━━━━
${trade.symbol.replace("-", "/")} ${trade.side}
Closed: 50% at $${formatUsdPrice(trade.takeProfitPrice)}
Profit locked: $${roundUsd(pnlUsd).toFixed(2)}
Remaining: 50% still open
New SL: Break even ✅
Next target: TP2 $${formatUsdPrice(trade.tp2Price)}
Risk now: ZERO 🔥`
            partials.push({ next, pnlUsd: roundUsd(pnlUsd), message: msg })
            updated.push(next)
            continue
          }

          const hitTp = trade.side === "LONG" ? price >= trade.takeProfitPrice : price <= trade.takeProfitPrice
          const hitSl = trade.side === "LONG" ? price <= trade.stopLossPrice : price >= trade.stopLossPrice
          if (!hitTp && !hitSl) {
            updated.push(trade)
            continue
          }

          const exitPrice = hitTp ? trade.takeProfitPrice : trade.stopLossPrice
          const pnlUsd =
            trade.side === "LONG"
              ? (exitPrice - trade.entryPrice) * trade.quantity
              : (trade.entryPrice - exitPrice) * trade.quantity
          const totalPnlUsd = roundUsd((trade.realizedPnlUsd ?? 0) + pnlUsd)
          const pnlPct = trade.entryPrice > 0 ? (pnlUsd / (trade.entryPrice * trade.quantity)) * 100 : 0

          const closedTrade: Trade = {
            ...trade,
            status: "CLOSED",
            closedAt: now,
            exitPrice: roundPrice(exitPrice),
            pnlUsd: totalPnlUsd,
            pnlPct: roundUsd(pnlPct),
            exitReason:
              hitTp
                ? "TP hit"
                : trade.initialStopLossPrice !== undefined && trade.stopLossPrice !== trade.initialStopLossPrice
                  ? "Trailing"
                  : "SL hit"
          }
          closed.push(closedTrade)
        }

        if (closed.length === 0 && partials.length === 0) {
          set({ paperTrades: updated })
          return
        }

        const day = dayKey(now)
        const dayPnlUsd = closed.reduce((a, b) => a + roundUsd((b.pnlUsd ?? 0) - (b.realizedPnlUsd ?? 0)), 0)
        const partialPnlUsd = partials.reduce((a, p) => a + p.pnlUsd, 0)
        const nextDaily = {
          ...s.dailyPnlUsd,
          [day]: roundUsd((s.dailyPnlUsd[day] ?? 0) + dayPnlUsd + partialPnlUsd)
        }

        const lastEquity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
        const nextEquity = roundUsd(lastEquity + dayPnlUsd + partialPnlUsd)
        const nextCurve: EquityPoint[] = [{ time: now, equity: nextEquity }, ...s.equityCurve].slice(0, 400)
        const nextMaxEquity = s.maxEquity === undefined ? nextEquity : Math.max(s.maxEquity, nextEquity)

        const target = generateCompoundingPlan(s.settings)
        const activeLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
        const active = target.find((x) => x.level === activeLevel)
        const reached = active ? nextEquity >= active.endingBalanceUsd : false
        const prevCompleted = new Set(s.completedLevels)
        const completed = reached ? Array.from(new Set([...s.completedLevels, activeLevel])) : s.completedLevels
        const newLevelCompleted = reached && !prevCompleted.has(activeLevel)

        let nextLockedProfitByLevel = s.lockedProfitByLevel
        if (s.settings.features.partialProfitLock && active && !newLevelCompleted) {
          const key = String(activeLevel)
          const already = s.lockedProfitByLevel[key]
          const profitSoFar = nextEquity - active.balanceUsd
          const trigger = (active.profitTargetUsd * s.settings.partialProfitLock.triggerPctOfLevelTarget) / 100
          if (!already && profitSoFar >= trigger && active.profitTargetUsd > 0) {
            const lock = roundUsd((profitSoFar * s.settings.partialProfitLock.lockPctOfProfitSoFar) / 100)
            nextLockedProfitByLevel = { ...s.lockedProfitByLevel, [key]: lock }
            if (s.settings.notifications.partialProfitLock) {
              const continueWith = roundUsd(Math.max(0, profitSoFar - lock))
              const msg = `💰 <b>PARTIAL PROFIT LOCKED</b>
━━━━━━━━━━━━━━
Level ${activeLevel} — ${s.settings.partialProfitLock.triggerPctOfLevelTarget}% target reached
Locked: $${lock.toFixed(2)} (safe)
Continue with: $${continueWith.toFixed(2)}
Worst case: Break even`
              void sendTelegramMessage(msg)
            }
          }
        }

        const nextHalted = closed.some((t) => t.exitReason === "SL hit") ? day : s.haltedUntilDay

        set({
          paperTrades: [...closed, ...updated],
          dailyPnlUsd: nextDaily,
          equityCurve: nextCurve,
          maxEquity: nextMaxEquity,
          completedLevels: completed,
          haltedUntilDay: nextHalted,
          lockedProfitByLevel: nextLockedProfitByLevel
        })

        for (const p of partials) {
          if (s.settings.notifications.marketMonitor) void sendTelegramMessage(p.message)
        }

        for (const t of closed) {
          void onTradeClose(t)
        }

        if (newLevelCompleted && active) {
          void onLevelComplete(activeLevel, active.balanceUsd, active.endingBalanceUsd, s.settings, completed.length)
        }
      }
    }),
    {
      name: "abxk-bot-store",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as any
        return {
          ...(current as any),
          ...p,
          settings: mergeSettings((current as any).settings, p.settings ?? {})
        }
      },
      partialize: (s) => ({
        settings: s.settings,
        completedLevels: s.completedLevels,
        paperTrades: s.paperTrades,
        liveTrades: s.liveTrades,
        equityCurve: s.equityCurve,
        dailyTradeCount: s.dailyTradeCount,
        dailyPnlUsd: s.dailyPnlUsd,
        haltedUntilDay: s.haltedUntilDay,
        maxEquity: s.maxEquity,
        lastAutomationCandleClose: s.lastAutomationCandleClose,
        pendingSignal: s.pendingSignal,
        lastOpenInterest: s.lastOpenInterest,
        lastFearGreed: s.lastFearGreed,
        lastDailyReportDay: s.lastDailyReportDay,
        paused: s.paused,
        pausedUntil: s.pausedUntil,
        lastSkipDay: s.lastSkipDay,
        lastSkipMessage: s.lastSkipMessage,
        marketRegime: s.marketRegime,
        lastRegime: s.lastRegime,
        lastBtcDominance: s.lastBtcDominance,
        lastCorrelation: s.lastCorrelation,
        lastPreTradeAlertKey: s.lastPreTradeAlertKey,
        lockedProfitByLevel: s.lockedProfitByLevel,
        withdrawnLockedProfitUsd: s.withdrawnLockedProfitUsd,
        scannerResults: s.scannerResults,
        scannerLastScanAt: s.scannerLastScanAt,
        scannerLastScanCandleOpenTime: s.scannerLastScanCandleOpenTime,
        scannerSelectedSymbol: s.scannerSelectedSymbol,
        lastHeatmapDangerCheckAt: s.lastHeatmapDangerCheckAt,
        lastHeatmapDangerAlertKey: s.lastHeatmapDangerAlertKey
      })
    }
  )
)

const botSettingsHydrateGlobal = globalThis as unknown as { __abxkBotSettingsHydrated?: boolean }
if (typeof window !== "undefined" && !botSettingsHydrateGlobal.__abxkBotSettingsHydrated) {
  botSettingsHydrateGlobal.__abxkBotSettingsHydrated = true
  window.setTimeout(() => {
    const hasLocal = Boolean(window.localStorage.getItem("abxk-bot-store"))
    if (hasLocal) {
      scheduleSettingsEnvSync(useBotStore.getState().settings)
      return
    }
    fetch("/api/bot/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const data = (json as any)?.data
        if (!data || typeof data !== "object") return
        useBotStore.setState((s) => ({ settings: mergeSettings(s.settings, data as Partial<Settings>) }))
        scheduleSettingsEnvSync(useBotStore.getState().settings)
      })
      .catch(() => undefined)
  }, 400)
}

async function placeTradeFromSignal(opts: {
  symbol: string
  side: TradeSide
  snapshot: StrategySnapshot
  entryPrice: number
  candles: Candle[]
  ctx: {
    openInterest?: number
    openInterestChangePct?: number
    fundingRatePct?: number
    fearGreed?: number
    spreadPct?: number
    dailyBias?: TradeSide
    inNewsBlackout?: boolean
  }
  regime?: MarketRegimeSnapshot
  sizeMultiplier: number
  chartImageBase64?: string
}) {
  const state = useBotStore.getState()
  const now = Date.now()
  const today = dayKey(now)
  const plan = generateCompoundingPlan(state.settings)
  const activeLevel = getActiveLevel(state.settings.compounding.levels, state.completedLevels)
  const active = plan.find((x) => x.level === activeLevel)
  const balanceUsd = active?.balanceUsd ?? state.settings.capital.initialCapitalUsd

  const fixed = isFixedCompounding(state.settings)
  const entryPrice = fixed ? await getLivePrice(opts.symbol).catch(() => opts.entryPrice) : opts.entryPrice
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    void sendTelegramMessage(`🚨 TRADE CANCELLED\nCannot fetch live price for ${opts.symbol}`)
    return
  }

  const lockedTotal = Object.values(state.lockedProfitByLevel).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const equityNow = state.equityCurve[0]?.equity ?? balanceUsd
  const availableEquity = state.settings.features.partialProfitLock ? Math.max(0, equityNow - lockedTotal) : equityNow

  let stopLossPrice: number
  let finalTp: number
  let tp2Price: number | undefined
  let tp3Price: number | undefined
  let tpStage: 1 | 2 | 3 = 1
  let quantity: number
  let riskUsd: number

  if (fixed && active) {
    const symbolOk = await verifySymbol(opts.symbol)
    if (!symbolOk) {
      void sendTelegramMessage(`🚨 TRADE CANCELLED\n${opts.symbol} not found on BingX contracts list`)
      return
    }

    const position = calcFixedCompoundingPosition({
      levelBalanceUsd: active.balanceUsd,
      levelTargetUsd: active.endingBalanceUsd,
      levelRiskUsd: active.riskUsd,
      entryPrice,
      side: opts.side,
      leverage: state.settings.risk.leverage
    })

    if (availableEquity < position.margin) {
      void sendTelegramMessage(
        `🚨 TRADE CANCELLED — Insufficient Balance\nRequired: $${position.margin.toFixed(2)}\nAvailable: $${availableEquity.toFixed(2)}`
      )
      return
    }

    stopLossPrice = position.slPrice
    finalTp = position.tp1Price
    tp2Price = position.tp2Price
    tp3Price = undefined
    tpStage = 1
    quantity = position.quantity
    riskUsd = position.maxLossUsd
  } else {
    const calc = buildRegimeStops(state.settings, opts.side, entryPrice, opts.candles, opts.regime)
    if (!calc) return
    const { stopLossPrice: sl, takeProfitPrice, riskPerUnit, rr } = calc
    if (rr < 2) {
      void sendTelegramMessage("⚠️ Require minimum 1:2 RR, else skip trade")
      return
    }

    stopLossPrice = sl
    finalTp = takeProfitPrice
    tp2Price = undefined
    tp3Price = undefined
    tpStage = 1

    if (state.settings.features.adaptiveLevels) {
      const smcData = {
        orderBlocks: detectOrderBlocks(opts.candles, state.settings.timeframe === "1d" ? "1D" : "4H"),
        fvgs: detectFairValueGaps(opts.candles)
      }
      const tp = calculateAdaptiveTP(opts.candles, opts.side, entryPrice, stopLossPrice, undefined, smcData)
      if (tp.valid) {
        finalTp = tp.tp1.price
        tp2Price = tp.tp2.price
        tp3Price = tp.tp3.price
        tpStage = 1
      }
    }

    const rrAfterTpOverride = riskPerUnit > 0 ? Math.abs(finalTp - entryPrice) / riskPerUnit : rr
    if (rrAfterTpOverride < 2) {
      void sendTelegramMessage("⚠️ Require minimum 1:2 RR, else skip trade")
      return
    }

    if (state.settings.filters.liquidationTp) {
      const liq = await fetch(
        `/api/coinglass/heatmap?exchange=${encodeURIComponent(state.settings.thresholds.liquidationExchange)}&symbol=${encodeURIComponent(
          state.settings.thresholds.liquidationSymbol
        )}&range=${encodeURIComponent(state.settings.thresholds.liquidationRange)}`,
        { cache: "no-store" }
      )
        .then((r) => r.json())
        .then((x) => pickLiquidationTp(x, opts.side, entryPrice, state.settings.thresholds.liquidationTpOffsetPct))
        .catch(() => undefined)
      if (liq) finalTp = roundUsd(liq)
    }

    if (state.settings.features.liquidationHeatmap) {
      const prevTp = finalTp
      const heatmap = await getLiquidationHeatmap({
        symbol: opts.symbol,
        exchange: state.settings.thresholds.liquidationExchange,
        range: state.settings.thresholds.liquidationRange
      }).catch(() => null)

      if (heatmap && heatmap.levels.length > 0 && heatmap.currentPrice > 0) {
        const optimized = await optimizeTPWithHeatmap({
          direction: opts.side,
          entryPrice,
          basicTP: finalTp,
          symbol: opts.symbol,
          exchange: state.settings.thresholds.liquidationExchange,
          range: state.settings.thresholds.liquidationRange,
          heatmap
        }).catch(() => null)

        if (optimized && Number.isFinite(optimized.price) && optimized.price > 0) {
          finalTp = roundUsd(optimized.price)
        }

        const magnets = findLiquidationMagnets(heatmap, opts.side)
        if (magnets.length) {
          const tuned = optimizeTPLevelsFromMagnets({
            direction: opts.side,
            entryPrice,
            tp1: finalTp,
            tp2: tp2Price,
            tp3: tp3Price,
            magnets
          })
          finalTp = roundUsd(tuned.tp1)
          if (tuned.tp2 !== undefined) tp2Price = roundUsd(tuned.tp2)
          if (tuned.tp3 !== undefined) tp3Price = roundUsd(tuned.tp3)
        }

        const rrAfterHeatmap = riskPerUnit > 0 ? Math.abs(finalTp - entryPrice) / riskPerUnit : rr
        if (rrAfterHeatmap < 2) finalTp = prevTp
      }
    }

    riskUsd = (availableEquity * state.settings.compounding.riskPctOfBalance) / 100
    quantity = riskPerUnit > 0 ? (riskUsd / riskPerUnit) * Math.max(0.01, opts.sizeMultiplier) : 0
    quantity = capQuantityByMargin(availableEquity, entryPrice, state.settings.risk.leverage, quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return
  }

  const baseTrade: Trade = {
    id: uuid(),
    mode: "paper",
    symbol: opts.symbol,
    timeframe: state.settings.timeframe,
    side: opts.side,
    orderType: "MARKET",
    quantity,
    leverage: state.settings.risk.leverage,
    entryPrice: roundPrice(entryPrice),
    initialStopLossPrice: stopLossPrice,
    stopLossPrice,
    takeProfitPrice: finalTp,
    tp2Price,
    tp3Price,
    tpStage,
    realizedPnlUsd: 0,
    peakPrice: roundPrice(entryPrice),
    trailingActive: false,
    lastTrailingUpdateAt: undefined,
    openedAt: now,
    status: "OPEN",
    setupScore: opts.snapshot.totalScore,
    regime: opts.regime?.regime,
    indicators: {
      ...opts.snapshot.indicators,
      openInterest: opts.ctx.openInterest,
      openInterestChangePct: opts.ctx.openInterestChangePct,
      fundingRatePct: opts.ctx.fundingRatePct,
      fearGreed: opts.ctx.fearGreed,
      spreadPct: opts.ctx.spreadPct,
      dailyBias: opts.ctx.dailyBias,
      inNewsBlackout: opts.ctx.inNewsBlackout
    }
  }

  const shouldPaper = state.settings.mode === "paper" || state.settings.mode === "mirror"
  const shouldLive = state.settings.mode === "live" || state.settings.mode === "mirror"

  const appendDailyCount = () => {
    useBotStore.setState((s) => ({
      dailyTradeCount: { ...s.dailyTradeCount, [today]: (s.dailyTradeCount[today] ?? 0) + 1 }
    }))
  }

  const parseMaybeJson = (raw: string): any => {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const placeLiveOrder = async (payload: any): Promise<{ ok: boolean; error?: string; data?: any }> => {
    const res = await fetch("/api/bingx/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => null)
    if (!res) return { ok: false, error: "Network error" }
    const text = await res.text()
    const json = parseMaybeJson(text)
    const routeError = json && typeof json === "object" && (json as any).ok === false
    if (!res.ok || routeError) {
      const err = routeError ? String((json as any).error ?? "Order failed") : text || `HTTP ${res.status}`
      return { ok: false, error: err }
    }
    return { ok: true, data: json ?? text }
  }

  const writeJournalOpen = (trade: Trade) => {
    if (!state.settings.features.journal) return
    const equityBefore = state.equityCurve[0]?.equity ?? state.settings.capital.initialCapitalUsd
    upsertJournalFromTrade(trade, {
      phase: "OPEN",
      level: activeLevel,
      equityBefore,
      equityAfter: equityBefore,
      setupScore: opts.snapshot.totalScore,
      corr: state.lastCorrelation,
      regime: opts.regime?.regime ?? "—",
      chartImageBase64: opts.chartImageBase64
    })
  }

  let paperOpened = false
  let liveOpened = false

  if (shouldPaper) {
    paperOpened = true
    appendDailyCount()
    useBotStore.setState((s) => ({ paperTrades: [baseTrade, ...s.paperTrades] }))
    writeJournalOpen(baseTrade)
    void onTradeOpen(baseTrade, riskUsd, activeLevel, state.settings.mode)
  }

  if (shouldLive) {
    const openRes = await placeLiveOrder({
      symbol: opts.symbol,
      tradeSide: opts.side,
      intent: "OPEN",
      orderType: "MARKET",
      quantity,
      leverage: state.settings.risk.leverage
    })

    if (!openRes.ok) {
      const msg = `🚨 <b>LIVE ORDER FAILED</b>\n━━━━━━━━━━━━━━\n${opts.symbol.replace("-", "/")} ${opts.side}\nError: ${escapeHtml(
        openRes.error ?? "Order failed"
      )}${paperOpened ? "\n\nPaper trade still opened (MIRROR mode)." : ""}`
      void sendTelegramMessage(msg)
    } else {
      liveOpened = true
      if (!paperOpened) appendDailyCount()

      const liveTrade: Trade = { ...baseTrade, mode: "live", id: uuid() }
      useBotStore.setState((s) => ({ liveTrades: [liveTrade, ...s.liveTrades] }))
      if (!paperOpened) writeJournalOpen(liveTrade)
      void onTradeOpen(liveTrade, riskUsd, activeLevel, state.settings.mode)

      const slRes = await placeLiveOrder({
        symbol: opts.symbol,
        tradeSide: opts.side,
        intent: "CLOSE",
        orderType: "STOP_MARKET",
        quantity,
        stopPrice: stopLossPrice,
        reduceOnly: true,
        workingType: "MARK_PRICE"
      })
      if (!slRes.ok) {
        void sendTelegramMessage(`⚠️ <b>LIVE SL PLACEMENT FAILED</b>\n${opts.symbol.replace("-", "/")} ${opts.side}\n${escapeHtml(slRes.error ?? "")}`)
      }

      const tpRes = await placeLiveOrder({
        symbol: opts.symbol,
        tradeSide: opts.side,
        intent: "CLOSE",
        orderType: "TAKE_PROFIT_MARKET",
        quantity,
        stopPrice: finalTp,
        reduceOnly: true,
        workingType: "MARK_PRICE"
      })
      if (!tpRes.ok) {
        void sendTelegramMessage(`⚠️ <b>LIVE TP PLACEMENT FAILED</b>\n${opts.symbol.replace("-", "/")} ${opts.side}\n${escapeHtml(tpRes.error ?? "")}`)
      }
    }
  }

  if (!paperOpened && !liveOpened) return
}

function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    filters: { ...base.filters, ...(patch.filters ?? {}) },
    thresholds: { ...base.thresholds, ...(patch.thresholds ?? {}) },
    features: { ...base.features, ...(patch.features ?? {}) },
    notifications: { ...base.notifications, ...(patch.notifications ?? {}) },
    capital: { ...base.capital, ...(patch.capital ?? {}) },
    compounding: { ...base.compounding, ...(patch.compounding ?? {}) },
    partialProfitLock: { ...base.partialProfitLock, ...(patch.partialProfitLock ?? {}) },
    risk: { ...base.risk, ...(patch.risk ?? {}) }
  }
}

function parseOpenInterest(raw: unknown): number | undefined {
  const data = raw as any
  const row = data?.data ?? data
  const v =
    safeNumber(row?.openInterest) ??
    safeNumber(row?.openInterestValue) ??
    safeNumber(row?.oi) ??
    safeNumber(Array.isArray(row) ? row[0] : undefined)
  return v
}

function parseFearGreed(raw: unknown): number | undefined {
  const data = raw as any
  const value = data?.data?.data?.[0]?.value ?? data?.data?.[0]?.value ?? data?.data?.value ?? data?.value
  const n = safeNumber(value)
  if (n === undefined) return undefined
  return Math.max(0, Math.min(100, n))
}

function computeDailyBias(candles: Candle[], now: number): TradeSide | undefined {
  const dayOpen = Math.floor(now / (24 * 60 * 60 * 1000)) * 24 * 60 * 60 * 1000
  const closed = candles.filter((c) => c.openTime < dayOpen)
  if (closed.length < 60) return undefined
  const closes = closed.map((c) => c.close)
  const ema20 = emaSeriesLast(closes, 20)
  const ema50 = emaSeriesLast(closes, 50)
  return ema20 >= ema50 ? "LONG" : "SHORT"
}

function emaSeriesLast(values: number[], period: number): number {
  const k = 2 / (period + 1)
  let result = values[0] ?? 0
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i] ?? result
    result = v * k + result * (1 - k)
  }
  return result
}

function isInNewsBlackout(raw: unknown, now: number, windowMinutes: number): boolean {
  const mins = Math.max(0, Math.floor(windowMinutes))
  if (mins === 0) return false
  const events = normalizeFfEvents(raw)
  const windowMs = mins * 60_000
  for (const e of events) {
    if (e.timeMs === undefined) continue
    if (Math.abs(e.timeMs - now) <= windowMs) return true
  }
  return false
}

function normalizeFfEvents(raw: unknown): { timeMs?: number; impact?: string }[] {
  const data = raw as any
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : []
  const out: { timeMs?: number; impact?: string }[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const impact = String((item as any).impact ?? (item as any).impactTitle ?? (item as any).impact_desc ?? "")
    const timeMs = parseEventTimeMs(item)
    if (!isHighImpact(impact, item)) continue
    out.push({ timeMs, impact })
  }
  return out
}

function isHighImpact(impact: string, item: any): boolean {
  const s = impact.toLowerCase()
  if (s.includes("high")) return true
  if (s.includes("medium")) return true
  const i = String(item?.importance ?? item?.impact ?? "")
  if (i === "3" || i === "2") return true
  return false
}

function parseEventTimeMs(item: any): number | undefined {
  const ts = safeNumber(item?.timestamp ?? item?.ts)
  if (ts !== undefined) {
    return ts < 2_000_000_000 ? ts * 1000 : ts
  }
  const date = item?.date ?? item?.datetime ?? item?.time
  if (typeof date === "string") {
    const d = new Date(date)
    const t = d.getTime()
    if (Number.isFinite(t)) return t
  }
  const y = safeNumber(item?.year)
  const m = safeNumber(item?.month)
  const day = safeNumber(item?.day)
  const hour = safeNumber(item?.hour)
  const minute = safeNumber(item?.minute)
  if ([y, m, day, hour, minute].every((x) => x !== undefined)) {
    return Date.UTC(y as number, (m as number) - 1, day as number, hour as number, minute as number)
  }
  return undefined
}

function pickLiquidationTp(
  raw: unknown,
  side: TradeSide,
  entryPrice: number,
  offsetPct: number
): number | undefined {
  const data = raw as any
  const payload = data?.data?.data ?? data?.data ?? data
  const yAxis: number[] = Array.isArray(payload?.y_axis) ? payload.y_axis.map((x: any) => Number(x)).filter(Number.isFinite) : []
  const points: any[] = Array.isArray(payload?.liquidation_leverage_data) ? payload.liquidation_leverage_data : []
  if (yAxis.length === 0 || points.length === 0) return undefined

  const agg = new Map<number, number>()
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 3) continue
    const yIndex = Number(p[1])
    const value = Number(p[2])
    if (!Number.isFinite(yIndex) || !Number.isFinite(value)) continue
    agg.set(yIndex, (agg.get(yIndex) ?? 0) + value)
  }

  const candidates: { price: number; weight: number }[] = []
  for (const [yIndex, weight] of agg) {
    const price = yAxis[yIndex]
    if (!Number.isFinite(price)) continue
    const ok = side === "LONG" ? price > entryPrice : price < entryPrice
    if (!ok) continue
    candidates.push({ price, weight })
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.weight - a.weight)
  const target = candidates[0]?.price
  if (target === undefined) return undefined
  const offset = Math.max(0, offsetPct) / 100
  return side === "LONG" ? target * (1 - offset) : target * (1 + offset)
}

async function sendTelegramMessage(message: string, imageBase64?: string) {
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, imageBase64 })
  }).catch(() => undefined)
}

async function onTradeOpen(trade: Trade, riskUsd: number, level: number, mode: Settings["mode"]) {
  const modeLabel = mode === "mirror" ? "MIRROR" : mode === "live" ? "LIVE" : "PAPER"
  const execLabel = trade.mode === "live" ? "LIVE" : "PAPER"
  const symbol = trade.symbol.replace("-", "/")
  const tp1Pct = trade.entryPrice > 0 ? ((trade.takeProfitPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0
  const tp2Pct = trade.entryPrice > 0 && trade.tp2Price ? ((trade.tp2Price - trade.entryPrice) / trade.entryPrice) * 100 : undefined
  const slPct = trade.entryPrice > 0 ? ((trade.stopLossPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0
  const positionValue = trade.entryPrice > 0 ? trade.entryPrice * trade.quantity : 0
  const margin = positionValue / Math.max(1, trade.leverage)
  const tp1ProfitUsd =
    trade.side === "LONG" ? (trade.takeProfitPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - trade.takeProfitPrice) * trade.quantity
  const rr = riskUsd > 0 ? tp1ProfitUsd / riskUsd : 0

  const filters = formatFilters(trade)
  const regime = trade.regime ?? "—"

  const msg = `🟢 <b>TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 Symbol: ${symbol}
📈 Direction: ${trade.side}
💰 Level: ${level}
Margin: $${margin.toFixed(2)} | Position: $${positionValue.toFixed(2)}
Quantity: ${trade.quantity.toFixed(6)}
💵 Entry: $${formatUsdPrice(trade.entryPrice)}
🎯 TP1: $${formatUsdPrice(trade.takeProfitPrice)} (${tp1Pct >= 0 ? "+" : ""}${tp1Pct.toFixed(2)}% | +$${roundUsd(tp1ProfitUsd).toFixed(2)})
${trade.tp2Price ? `🎯 TP2: $${formatUsdPrice(trade.tp2Price)} (${(tp2Pct ?? 0) >= 0 ? "+" : ""}${(tp2Pct ?? 0).toFixed(2)}%)\n` : ""}🛑 SL: $${formatUsdPrice(trade.stopLossPrice)} (${slPct >= 0 ? "+" : ""}${slPct.toFixed(2)}% | -$${riskUsd.toFixed(2)})
📊 RR: 1:${rr.toFixed(2)}
⚡ Leverage: ${trade.leverage}x
📋 Score: ${trade.setupScore ?? 0}/100
🔁 Mode: ${modeLabel} | Exec: ${execLabel}
🧠 Regime: ${regime}
Filters: ${filters}`

  await sendTelegramMessage(msg)

  const s = useBotStore.getState()
  if (!s.settings.features.liquidationHeatmap) return
  if (!s.settings.notifications.liquidationHeatmap) return

  const heatmap = await getLiquidationHeatmap({
    symbol: trade.symbol,
    exchange: s.settings.thresholds.liquidationExchange,
    range: s.settings.thresholds.liquidationRange
  }).catch(() => null)
  if (!heatmap || heatmap.levels.length === 0 || heatmap.currentPrice <= 0) return

  const magnets = findLiquidationMagnets(heatmap, trade.side)
  const dangers = findDangerLevels({ heatmap, direction: trade.side, minUsd: 10_000_000 })
  const text = formatHeatmapTelegram({
    symbol: trade.symbol,
    direction: trade.side,
    currentPrice: heatmap.currentPrice,
    magnetsForMove: magnets,
    dangerLevels: dangers,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLossPrice,
    tp1: trade.takeProfitPrice,
    tp2: trade.tp2Price,
    tp3: trade.tp3Price
  })

  await sendTelegramMessage(text)
}

async function onTradeClose(trade: Trade) {
  const win = (trade.pnlUsd ?? 0) >= 0
  const title = win ? "✅ <b>TRADE CLOSED — WIN</b>" : "❌ <b>TRADE CLOSED — LOSS</b>"
  const symbol = trade.symbol.replace("-", "/")
  const pnlUsd = trade.pnlUsd ?? 0
  const pnlPct = trade.pnlPct ?? 0
  const durationMs = trade.closedAt && trade.openedAt ? trade.closedAt - trade.openedAt : 0
  const duration = `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`

  const analysis = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade })
  })
    .then((r) => r.json())
    .catch(() => null)

  const provider = analysis?.provider as ("Gemini" | "Groq" | undefined)
  const text = typeof analysis?.text === "string" ? analysis.text : undefined

  if (provider && text) {
    useBotStore.setState((s) => ({
      paperTrades: s.paperTrades.map((t) =>
        t.id === trade.id ? { ...t, aiProvider: provider, aiAnalysis: text } : t
      )
    }))
  }

  const shortAi =
    provider && text
      ? escapeHtml(text.split("\n").join(" ").split(".").slice(0, 2).join(".").trim()).slice(0, 180)
      : ""

  const s = useBotStore.getState()
  const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
  const prevEquity = equity - pnlUsd

  if (s.settings.features.journal) {
    upsertJournalFromTrade(
      provider && text ? { ...trade, aiProvider: provider, aiAnalysis: text } : trade,
      {
        phase: "CLOSE",
        level: getActiveLevel(s.settings.compounding.levels, s.completedLevels),
        equityBefore: prevEquity,
        equityAfter: equity,
        setupScore: trade.setupScore ?? 0,
        corr: s.lastCorrelation,
        regime: trade.regime ?? "—"
      }
    )
  }
  const plan = generateCompoundingPlan(s.settings)
  const level = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
  const active = plan.find((x) => x.level === level)
  const levelPct =
    active && active.endingBalanceUsd > active.balanceUsd
      ? Math.max(0, Math.min(100, ((equity - active.balanceUsd) / (active.endingBalanceUsd - active.balanceUsd)) * 100))
      : 0

  const exit =
    trade.exitReason === "TP hit"
      ? "TP hit ✅"
      : trade.exitReason === "SL hit"
        ? "SL hit ❌"
        : trade.exitReason
          ? trade.exitReason
          : "—"

  const msg = `${title}
━━━━━━━━━━━━━━
📊 ${symbol} ${trade.side}
💵 PnL: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)
⏱ Duration: ${duration}
Exit: ${exit}
Level ${level} progress: ${Math.round(levelPct)}%
Equity: $${prevEquity.toFixed(2)} → $${equity.toFixed(2)}${!win && trade.exitReason === "SL hit" ? "\n⚠️ No more trades today" : ""}${shortAi ? `\n🤖 AI: ${shortAi}` : ""}`

  await sendTelegramMessage(msg)
}

async function onLevelComplete(
  level: number,
  fromBalance: number,
  toBalance: number,
  settings: Settings,
  doneLevels: number
) {
  const plan = generateCompoundingPlan(settings)
  const next = plan.find((x) => x.level === level + 1)
  const nextTarget = next ? next.profitTargetUsd : 0
  const projectedFinal = plan[plan.length - 1]?.endingBalanceUsd ?? toBalance
  const s = useBotStore.getState()
  const closed = s.paperTrades.filter((t) => t.status === "CLOSED" && typeof t.pnlUsd === "number")
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const winRate = closed.length ? (wins / closed.length) * 100 : 0
  const firstTradeAt = s.paperTrades.reduce((min, t) => Math.min(min, t.openedAt), Date.now())
  const daysTaken = Math.max(1, Math.ceil((Date.now() - firstTradeAt) / (24 * 60 * 60_000)))
  const avgDaysPerLevel = doneLevels > 0 ? daysTaken / doneLevels : daysTaken
  const remainingLevels = Math.max(0, settings.compounding.levels - doneLevels)
  const projectedFinishDays = Math.max(1, Math.round(remainingLevels * avgDaysPerLevel))

  const startCapital = settings.capital.initialCapitalUsd
  const totalPct = startCapital > 0 ? ((toBalance - startCapital) / startCapital) * 100 : 0
  const multiple = startCapital > 0 ? toBalance / startCapital : 0

  const msg =
    level === settings.compounding.levels
      ? `🎊🎊🎊 <b>GOAL ACHIEVED!</b> 🎊🎊🎊
━━━━━━━━━━━━━━
YOU DID IT! ALL ${settings.compounding.levels} LEVELS COMPLETE!
💰 $${formatNum0(startCapital)} → $${formatNum0(toBalance)}
📈 ${multiple.toFixed(1)}x return!
⏱ Total time: ${daysTaken} days
📊 Total trades: ${closed.length}
✅ Win rate: ${winRate.toFixed(1)}%`
      : `🎉 <b>LEVEL COMPLETE!</b>
━━━━━━━━━━━━━━
✅ Level ${level} → Level ${level + 1} unlocked!
Balance: $${formatNum0(fromBalance)} → $${formatNum0(toBalance)}
Next target: +$${formatNum0(nextTarget)} (${settings.compounding.profitTargetPct}%)
Progress: ${doneLevels}/${settings.compounding.levels} levels
Projected finish: ~${projectedFinishDays} days`

  await sendTelegramMessage(msg)
}

function formatFilters(trade: Trade): string {
  const scores = trade.indicators
  const parts: string[] = []
  if (scores?.ema20 !== undefined) parts.push("EMA✅")
  if (scores?.volumeRatio !== undefined) parts.push("Vol✅")
  if (scores?.rsi14 !== undefined) parts.push("RSI✅")
  if (scores?.atr14 !== undefined) parts.push("ATR✅")
  if (scores?.fibInGoldenPocket) parts.push("Fib✅")
  if (scores?.bbBandwidthPct !== undefined) parts.push("BB✅")
  if (scores?.stochRsiK !== undefined) parts.push("StochRSI✅")
  if (scores?.macdDivergence && scores.macdDivergence !== "NONE") parts.push("Div✅")
  if (scores?.openInterestChangePct !== undefined) parts.push("OI✅")
  return parts.length ? parts.join(" ") : "—"
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function formatNum0(v: number): string {
  if (!Number.isFinite(v)) return "0"
  return Math.round(v).toLocaleString()
}

function formatUsdPrice(v: number): string {
  if (!Number.isFinite(v)) return "0"
  const a = Math.abs(v)
  const decimals = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : a >= 0.0001 ? 8 : 10
  return v.toFixed(decimals)
}

function roundPrice(v: number): number {
  if (!Number.isFinite(v)) return 0
  const a = Math.abs(v)
  const decimals = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : a >= 0.0001 ? 8 : 10
  const factor = 10 ** decimals
  return Math.round(v * factor) / factor
}

function upsertJournalFromTrade(
  trade: Trade,
  ctx: {
    phase: "OPEN" | "CLOSE"
    level: number
    equityBefore: number
    equityAfter: number
    setupScore: number
    corr?: CorrelationDecision
    regime: string
    chartImageBase64?: string
  }
) {
  try {
    const key = "trade_journal"
    const raw = localStorage.getItem(key)
    const current: TradeJournalEntry[] = raw ? (JSON.parse(raw) as TradeJournalEntry[]) : []
    const list = Array.isArray(current) ? current : []
    const existing = list.find((e) => e.id === trade.id)

    const now = Date.now()
    const base: TradeJournalEntry = existing ?? {
      id: trade.id,
      timestamp: trade.openedAt,
      symbol: trade.symbol,
      direction: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: 0,
      stopLoss: trade.stopLossPrice,
      takeProfit: trade.takeProfitPrice,
      result: "OPEN",
      pnl: 0,
      pnlPercent: 0,
      duration: "—",
      setupScore: ctx.setupScore,
      compoundLevel: ctx.level,
      equityBefore: ctx.equityBefore,
      equityAfter: ctx.equityAfter,
      timeframe: trade.timeframe,
      regime: ctx.regime,
      exitReason: "MANUAL",
      filters: {
        emaTrend: "—",
        rsi: 0,
        volumeRatio: 0,
        atr: 0,
        macd: "—",
        fundingRate: 0,
        oiChange: 0,
        fearGreed: 0,
        fibLevel: "—",
        session: "—",
        dailyBias: "—",
        regime: ctx.regime,
        btcCorrelation: "—",
        dxy: "—"
      },
      aiAnalysis: "",
      notes: ""
    }

    const merged: TradeJournalEntry = {
      ...base,
      symbol: trade.symbol,
      direction: trade.side,
      chartImageBase64: ctx.chartImageBase64 ?? base.chartImageBase64,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLossPrice,
      takeProfit: trade.takeProfitPrice,
      setupScore: ctx.setupScore,
      compoundLevel: ctx.level,
      equityBefore: ctx.equityBefore,
      equityAfter: ctx.equityAfter,
      timeframe: trade.timeframe,
      regime: ctx.regime,
      filters: buildJournalFilters(trade, ctx.corr, ctx.regime, base.filters),
      aiAnalysis: typeof trade.aiAnalysis === "string" ? trade.aiAnalysis : base.aiAnalysis
    }

    const next =
      ctx.phase === "OPEN"
        ? {
            ...merged,
            result: "OPEN",
            exitPrice: 0,
            pnl: 0,
            pnlPercent: 0,
            duration: "—",
            exitReason: "MANUAL"
          }
        : finalizeJournalClose(merged, trade, now)

    const updated = existing ? list.map((e) => (e.id === trade.id ? next : e)) : [next, ...list]
    localStorage.setItem(key, JSON.stringify(updated.slice(0, 2000)))
  } catch {
    return
  }
}

function finalizeJournalClose(base: TradeJournalEntry, trade: Trade, now: number): TradeJournalEntry {
  const pnl = trade.pnlUsd ?? 0
  const pnlPct = trade.pnlPct ?? 0
  const win = pnl >= 0
  const durationMs = trade.closedAt && trade.openedAt ? trade.closedAt - trade.openedAt : 0
  const duration = `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`
  const exitReason =
    trade.exitReason === "TP hit"
      ? "TP_HIT"
      : trade.exitReason === "SL hit"
        ? "SL_HIT"
        : trade.exitReason === "Trailing"
          ? "TRAILING"
        : trade.exitReason === "Manual"
          ? "MANUAL"
          : "MANUAL"

  return {
    ...base,
    exitPrice: trade.exitPrice ?? base.exitPrice,
    pnl,
    pnlPercent: pnlPct,
    result: win ? "WIN" : "LOSS",
    duration,
    equityAfter: base.equityAfter,
    exitReason,
    aiAnalysis: typeof trade.aiAnalysis === "string" ? trade.aiAnalysis : base.aiAnalysis
  }
}

function buildJournalFilters(
  trade: Trade,
  corr: CorrelationDecision | undefined,
  regime: string,
  prev: TradeJournalEntry["filters"]
): TradeJournalEntry["filters"] {
  const ind = trade.indicators ?? {}
  const emaTrend = emaTrendLabel(ind.ema20, ind.ema50, ind.ema200)
  const macd =
    typeof ind.macdLine === "number" && typeof ind.macdSignal === "number"
      ? ind.macdLine > ind.macdSignal
        ? "Bullish"
        : ind.macdLine < ind.macdSignal
          ? "Bearish"
          : "Neutral"
      : prev.macd

  const session = sessionLabel(new Date(trade.openedAt).getUTCHours(), useBotStore.getState().settings.thresholds)
  const btcCorrelation =
    corr?.blocked && corr.blockReason
      ? `BLOCKED: ${corr.blockReason}`
      : corr?.details?.btcAligned === true
        ? "BTC aligned"
        : corr?.details?.btcAligned === false
          ? "BTC opposing"
          : prev.btcCorrelation

  const dxy = corr?.details?.dxyRising ? "Rising" : corr?.details?.dxyFalling ? "Falling" : prev.dxy

  return {
    ...prev,
    emaTrend,
    rsi: typeof ind.rsi14 === "number" ? ind.rsi14 : prev.rsi,
    volumeRatio: typeof ind.volumeRatio === "number" ? ind.volumeRatio : prev.volumeRatio,
    atr: typeof ind.atr14 === "number" ? ind.atr14 : prev.atr,
    macd,
    fundingRate: typeof ind.fundingRatePct === "number" ? ind.fundingRatePct : prev.fundingRate,
    oiChange: typeof ind.openInterestChangePct === "number" ? ind.openInterestChangePct : prev.oiChange,
    fearGreed: typeof ind.fearGreed === "number" ? ind.fearGreed : prev.fearGreed,
    fibLevel: typeof ind.fibLevel === "number" ? ind.fibLevel.toFixed(2) : prev.fibLevel,
    session,
    dailyBias: ind.dailyBias ? ind.dailyBias : prev.dailyBias,
    regime,
    btcCorrelation,
    dxy
  }
}

function emaTrendLabel(ema20?: number, ema50?: number, ema200?: number): string {
  if (ema20 === undefined || ema50 === undefined || ema200 === undefined) return "—"
  if (ema20 > ema50 && ema50 > ema200) return "EMA20 > EMA50 > EMA200"
  if (ema20 < ema50 && ema50 < ema200) return "EMA20 < EMA50 < EMA200"
  return "Mixed"
}

function sessionLabel(utcHour: number, thresholds: Settings["thresholds"]): string {
  const start = Math.floor(thresholds.londonNyOverlapStartUtcHour)
  const end = Math.floor(thresholds.londonNyOverlapEndUtcHour)
  if (utcHour >= start && utcHour <= end) return "London/NY overlap"
  return "Off-session"
}
