import type { Candle, FilterKey, FilterScores, Settings, TradeSide } from "@/types/bot"
import { evaluateSetup } from "@/lib/strategy"

export type FilterWeights = Partial<Record<FilterKey, number>>

export type BacktestConfig = {
  symbol: string
  startTimeMs: number
  endTimeMs: number
  timeframe: "4h" | "1d"
  initialBalance: number
  filterWeights?: FilterWeights
  riskPercent: number
  leverage: number
  targetScoreThreshold: number
  settings: Settings
  fetchHistoricalKlines: (opts: {
    symbol: string
    interval: "4h" | "1d"
    startTimeMs: number
    endTimeMs: number
  }) => Promise<Candle[]>
}

export type BacktestTrade = {
  symbol: string
  direction: TradeSide
  entryPrice: number
  stopLoss: number
  takeProfit: number
  openTime: number
  closeTime: number | null
  closePrice: number | null
  exitReason: "TP" | "SL" | "BOTH_HIT_SL_FIRST" | "FORCED_CLOSE" | null
  notionalUsd: number
  setupScore: number
  filterBreakdown: FilterScores
  pnlUsd: number | null
  equityAfter: number | null
}

export type MonthlyResult = {
  month: string
  trades: number
  pnlUsd: number
}

export type FilterPerformance = {
  filter: FilterKey
  winRateWith: number
  winRateWithout: number
  impact: number
  sampleSize: number
  recommendation: "INCREASE_WEIGHT" | "DECREASE_WEIGHT" | "KEEP"
}

export type BacktestResult = {
  totalTrades: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  sharpeRatio: number
  expectancy: number
  finalBalance: number
  returnPercent: number
  bestTrade: BacktestTrade | null
  worstTrade: BacktestTrade | null
  monthlyBreakdown: MonthlyResult[]
  filterPerformance: FilterPerformance[]
  equityCurve: { time: number; equity: number }[]
  trades: BacktestTrade[]
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const candles = await config.fetchHistoricalKlines({
    symbol: config.symbol,
    interval: config.timeframe,
    startTimeMs: config.startTimeMs,
    endTimeMs: config.endTimeMs
  })

  const minLookback = 220
  if (candles.length < minLookback + 5) {
    return emptyResult(config.initialBalance)
  }

  const trades: BacktestTrade[] = []
  const equityCurve: { time: number; equity: number }[] = [{ time: candles[0]!.openTime, equity: config.initialBalance }]
  let balance = config.initialBalance
  let peakBalance = config.initialBalance
  let maxDrawdown = 0

  for (let i = minLookback; i < candles.length - 1; i += 1) {
    const historicalCandles = candles.slice(0, i)
    const currentCandle = candles[i]!

    const openTrade = trades.find((t) => t.closeTime === null)
    if (openTrade) {
      const close = checkTradeClose(openTrade, currentCandle)
      if (close.closed) {
        openTrade.closeTime = currentCandle.openTime
        openTrade.closePrice = close.closePrice
        openTrade.exitReason = close.reason
        openTrade.pnlUsd = round2(calculatePnlUsd(openTrade, close.closePrice))
        balance = round2(balance + openTrade.pnlUsd)
        openTrade.equityAfter = balance

        equityCurve.push({ time: currentCandle.openTime, equity: balance })

        if (balance > peakBalance) peakBalance = balance
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0
        if (dd > maxDrawdown) maxDrawdown = dd
      }
      continue
    }

    const evalRes = evaluateSetup(historicalCandles, config.settings, {
      now: currentCandle.openTime,
      inNewsBlackout: false
    })
    const direction = evalRes.side

    const weighted = applyWeights(evalRes.snapshot.scores, config.filterWeights)
    const setupScore = clamp0_100(sumScores(weighted))
    if (evalRes.snapshot.blocked) continue
    if (setupScore < config.targetScoreThreshold) continue

    const entryPrice = candles[i + 1]!.open
    const sl = computeAtrBasedStops(historicalCandles, direction, entryPrice)
    const tp = computeSimpleTp(direction, entryPrice, sl, 2)
    if (!sl.valid || !tp.valid) continue

    const riskUsd = (balance * Math.max(0, config.riskPercent)) / 100
    const notionalUsd = Math.max(0, riskUsd) * Math.max(1, config.leverage)
    if (notionalUsd <= 0) continue

    trades.push({
      symbol: config.symbol,
      direction,
      entryPrice,
      stopLoss: sl.price,
      takeProfit: tp.price,
      openTime: candles[i + 1]!.openTime,
      closeTime: null,
      closePrice: null,
      exitReason: null,
      notionalUsd,
      setupScore,
      filterBreakdown: weighted,
      pnlUsd: null,
      equityAfter: null
    })
  }

  const last = candles[candles.length - 1]!
  const stillOpen = trades.find((t) => t.closeTime === null)
  if (stillOpen) {
    stillOpen.closeTime = last.openTime
    stillOpen.closePrice = last.close
    stillOpen.exitReason = "FORCED_CLOSE"
    stillOpen.pnlUsd = round2(calculatePnlUsd(stillOpen, last.close))
    balance = round2(balance + stillOpen.pnlUsd)
    stillOpen.equityAfter = balance
    equityCurve.push({ time: last.openTime, equity: balance })
  }

  const closedTrades = trades.filter((t) => t.closeTime !== null && typeof t.pnlUsd === "number")
  if (!closedTrades.length) {
    return emptyResult(config.initialBalance)
  }

  const wins = closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0)
  const losses = closedTrades.filter((t) => (t.pnlUsd ?? 0) <= 0)
  const winRate = wins.length / closedTrades.length
  const avgWin = wins.length ? wins.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) / losses.length) : 0
  const grossWin = wins.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlUsd ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss
  const sharpeRatio = computeSharpeRatio(closedTrades)

  const bestTrade = [...closedTrades].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0] ?? null
  const worstTrade = [...closedTrades].sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0] ?? null

  return {
    totalTrades: closedTrades.length,
    winRate: round4(winRate),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    profitFactor: round2(profitFactor),
    maxDrawdown: round2(maxDrawdown),
    sharpeRatio: round2(sharpeRatio),
    expectancy: round2(expectancy),
    finalBalance: round2(balance),
    returnPercent: round2(((balance - config.initialBalance) / config.initialBalance) * 100),
    bestTrade,
    worstTrade,
    monthlyBreakdown: buildMonthlyBreakdown(closedTrades),
    filterPerformance: analyzeFilterPerformance(closedTrades),
    equityCurve,
    trades
  }
}

export function analyzeFilterPerformance(trades: BacktestTrade[]): FilterPerformance[] {
  const filters: FilterKey[] = [
    "trendEma",
    "volumeSpike",
    "atrVolatility",
    "rsi",
    "macd",
    "bbSqueeze",
    "fibGoldenPocket",
    "stochRsi",
    "macdDivergence",
    "openInterest",
    "liquidity",
    "fundingRate",
    "fundingHardBlock",
    "session",
    "htfDailyBias",
    "newsBlackout",
    "oiDivergence",
    "fearGreed",
    "liquidationTp"
  ]

  return filters.map((filter) => {
    const withFilter = trades.filter((t) => (t.filterBreakdown[filter] ?? 0) > 0)
    const withoutFilter = trades.filter((t) => (t.filterBreakdown[filter] ?? 0) === 0)

    const wrWith = withFilter.length ? withFilter.filter((t) => (t.pnlUsd ?? 0) > 0).length / withFilter.length : 0
    const wrWithout = withoutFilter.length ? withoutFilter.filter((t) => (t.pnlUsd ?? 0) > 0).length / withoutFilter.length : 0
    const impact = wrWith - wrWithout

    return {
      filter,
      winRateWith: round4(wrWith),
      winRateWithout: round4(wrWithout),
      impact: round4(impact),
      sampleSize: withFilter.length,
      recommendation: impact > 0.1 ? "INCREASE_WEIGHT" : impact < -0.1 ? "DECREASE_WEIGHT" : "KEEP"
    }
  })
}

function emptyResult(initialBalance: number): BacktestResult {
  return {
    totalTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    expectancy: 0,
    finalBalance: initialBalance,
    returnPercent: 0,
    bestTrade: null,
    worstTrade: null,
    monthlyBreakdown: [],
    filterPerformance: [],
    equityCurve: [{ time: Date.now(), equity: initialBalance }],
    trades: []
  }
}

function applyWeights(base: FilterScores, weights?: FilterWeights): FilterScores {
  if (!weights) return base
  const out: FilterScores = { ...base }
  for (const [k, w] of Object.entries(weights)) {
    const key = k as FilterKey
    const m = Number(w)
    if (!Number.isFinite(m)) continue
    out[key] = round2((out[key] ?? 0) * m)
  }
  return out
}

function sumScores(scores: FilterScores): number {
  return Object.values(scores).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
}

function clamp0_100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function computeAtrBasedStops(candles: Candle[], side: TradeSide, entryPrice: number): { valid: boolean; price: number } {
  const atr = calcAtr14(candles)
  if (!Number.isFinite(atr) || atr <= 0 || entryPrice <= 0) return { valid: false, price: 0 }
  const distance = atr * 1.5
  const price = side === "LONG" ? entryPrice - distance : entryPrice + distance
  if (side === "LONG" && price >= entryPrice) return { valid: false, price: 0 }
  if (side === "SHORT" && price <= entryPrice) return { valid: false, price: 0 }
  return { valid: true, price: round2(price) }
}

function computeSimpleTp(side: TradeSide, entryPrice: number, sl: { valid: boolean; price: number }, rr: number): { valid: boolean; price: number } {
  if (!sl.valid) return { valid: false, price: 0 }
  const risk = Math.abs(entryPrice - sl.price)
  if (!Number.isFinite(risk) || risk <= 0) return { valid: false, price: 0 }
  const price = side === "LONG" ? entryPrice + risk * rr : entryPrice - risk * rr
  return { valid: true, price: round2(price) }
}

function checkTradeClose(trade: BacktestTrade, candle: Candle): { closed: boolean; closePrice: number; reason: BacktestTrade["exitReason"] } {
  const tpHit = trade.direction === "LONG" ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit
  const slHit = trade.direction === "LONG" ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss

  if (tpHit && slHit) {
    return { closed: true, closePrice: trade.stopLoss, reason: "BOTH_HIT_SL_FIRST" }
  }
  if (tpHit) return { closed: true, closePrice: trade.takeProfit, reason: "TP" }
  if (slHit) return { closed: true, closePrice: trade.stopLoss, reason: "SL" }
  return { closed: false, closePrice: candle.close, reason: null }
}

function calculatePnlUsd(trade: BacktestTrade, closePrice: number): number {
  if (trade.entryPrice <= 0) return 0
  const movePct =
    trade.direction === "LONG" ? (closePrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - closePrice) / trade.entryPrice
  return trade.notionalUsd * movePct
}

function buildMonthlyBreakdown(trades: BacktestTrade[]): MonthlyResult[] {
  const map = new Map<string, { trades: number; pnlUsd: number }>()
  for (const t of trades) {
    const ts = t.closeTime ?? t.openTime
    const d = new Date(ts)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    const cur = map.get(key) ?? { trades: 0, pnlUsd: 0 }
    map.set(key, { trades: cur.trades + 1, pnlUsd: round2(cur.pnlUsd + (t.pnlUsd ?? 0)) })
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, trades: v.trades, pnlUsd: v.pnlUsd }))
}

function computeSharpeRatio(trades: BacktestTrade[]): number {
  const rets = trades
    .map((t) => {
      const pnl = t.pnlUsd ?? 0
      const denom = t.notionalUsd > 0 ? t.notionalUsd : 0
      return denom > 0 ? pnl / denom : 0
    })
    .filter((x) => Number.isFinite(x))
  if (rets.length < 2) return 0
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const variance = rets.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (rets.length - 1)
  const sd = Math.sqrt(Math.max(0, variance))
  if (sd === 0) return 0
  return mean / sd
}

function calcAtr14(candles: Candle[]): number {
  const period = 14
  if (candles.length < period + 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]!.close
    const high = candles[i]!.high
    const low = candles[i]!.low
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }
  const slice = trs.slice(-period)
  if (!slice.length) return 0
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

