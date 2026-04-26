import type { Candle } from "@/types/bot"
import { detectAllPatterns, type CandlePattern, type PatternResult } from "@/lib/candlePatterns"

export type ScalpTimeframe = "1m" | "3m" | "5m" | "15m" | "30m"
export type ScalpMode = "paper" | "live" | "mirror"
export type ScalpPatternMinStrength = "ANY" | "MODERATE" | "STRONG"

export type ScalpFilterCategory =
  | "TREND"
  | "MOMENTUM"
  | "VOLUME"
  | "PATTERN"
  | "VOLATILITY"
  | "MTF"
  | "PROTECTION"
  | "ORDERFLOW"
  | "RISK"

export const SCALP_FILTER_DEFS = [
  { id: "ema_ribbon", name: "EMA Ribbon (8/13/21/34/55)", category: "TREND", weight: 25, defaultOn: true },
  { id: "vwap_position", name: "VWAP Position", category: "TREND", weight: 20, defaultOn: true },
  { id: "rsi_momentum", name: "RSI Momentum", category: "MOMENTUM", weight: 20, defaultOn: true },
  { id: "volume_surge", name: "Volume Surge (2x+)", category: "VOLUME", weight: 20, defaultOn: true },
  { id: "candle_pattern", name: "Candle Pattern", category: "PATTERN", weight: 15, defaultOn: true },
  { id: "macd_confirm", name: "MACD Confirmation", category: "MOMENTUM", weight: 10, defaultOn: true },
  { id: "bb_squeeze", name: "Bollinger Squeeze", category: "VOLATILITY", weight: 10, defaultOn: false },
  { id: "stoch_rsi", name: "Stoch RSI Cross", category: "MOMENTUM", weight: 10, defaultOn: false },
  { id: "mtf_5m", name: "MTF 5M Confirmation", category: "MTF", weight: 20, defaultOn: true },
  { id: "mtf_15m", name: "MTF 15M Trend", category: "MTF", weight: 15, defaultOn: true },
  { id: "htf_ema_align", name: "HTF EMA Alignment", category: "MTF", weight: 15, defaultOn: true },
  { id: "wick_ratio", name: "Wick/Body Ratio Filter", category: "PROTECTION", weight: 10, defaultOn: true },
  { id: "candle_confirm", name: "Candle Close Confirm", category: "PROTECTION", weight: 10, defaultOn: true },
  { id: "breakout_retest", name: "Breakout Retest Wait", category: "PROTECTION", weight: 10, defaultOn: false },
  { id: "min_breakout", name: "Min Breakout Distance", category: "PROTECTION", weight: 5, defaultOn: true },
  { id: "spread_check", name: "Spread Check (<0.05%)", category: "PROTECTION", weight: 5, defaultOn: true },
  { id: "bid_ask_imbalance", name: "Bid/Ask Imbalance", category: "ORDERFLOW", weight: 15, defaultOn: false },
  { id: "ob_wall", name: "Orderbook Wall Detection", category: "ORDERFLOW", weight: 10, defaultOn: false },
  { id: "cvd", name: "CVD (Vol Delta)", category: "ORDERFLOW", weight: 15, defaultOn: false },
  { id: "liq_cluster", name: "Liquidation Clusters", category: "ORDERFLOW", weight: 10, defaultOn: false },
  { id: "session_filter", name: "Session Filter (NY/London)", category: "RISK", weight: 5, defaultOn: true },
  { id: "news_blackout", name: "News Blackout (±15min)", category: "RISK", weight: 0, defaultOn: true },
  { id: "daily_loss_lock", name: "Daily Loss Lock", category: "RISK", weight: 0, defaultOn: true },
  { id: "blacklist_check", name: "Auto Blacklist Check", category: "RISK", weight: 0, defaultOn: true }
] as const

export type ScalpFilterId = (typeof SCALP_FILTER_DEFS)[number]["id"]
export type ScalpFilterState = Record<ScalpFilterId, boolean>

export const DEFAULT_SCALP_FILTERS: ScalpFilterState = SCALP_FILTER_DEFS.reduce((acc, f) => {
  ;(acc as any)[f.id] = f.defaultOn
  return acc
}, {} as ScalpFilterState)

export const BINGX_FEES = {
  maker: 0.0002,
  taker: 0.0005,
  funding: 0
} as const

export type ScalpFees = {
  openFee: number
  closeFee: number
  fundingFee: number
  totalFee: number
}

export type ScalpSettings = {
  enabled: boolean
  paused: boolean
  mode: ScalpMode
  patternRequired: boolean
  patternMinStrength: ScalpPatternMinStrength
  patternBlockOpposing: boolean
  filters: ScalpFilterState
  paperBalanceUsd: number
  maxDailyLossUsd: number
  tp1Amount: number
  tp2Amount: number
  slAmount: number
  trailingEnabled: boolean
  lockAtTp1: number
  trailDistance: number
  leverage: number
  marginPerTrade: number
  maxConcurrent: number
  maxPerDay: number
  timeframe: ScalpTimeframe
  minScore: number
  enabledCoins: string[]
}

export type ScalpSignal = {
  symbol: string
  direction: "LONG" | "SHORT"
  score: number
  vwap: number
  vwapOk: boolean
  rsi: number
  rsiPrev: number
  rsiOk: boolean
  volRatio: number
  patternAllowed: boolean
  patternResult: PatternResult | null
  topFilters: string[]
}

export type ScalpTrailingState = {
  active: boolean
  tp1Amount: number
  tp2Amount: number
  slAmount: number
  lockedPnl: number
  trailDistance: number
  highWaterMark: number
  phase: "INITIAL" | "TRAILING" | "CLOSED"
}

export type ScalpTrade = {
  id: string
  orderId?: string
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  quantity: number
  margin: number
  positionValue: number
  score: number
  topFilters: string[]
  openedAt: number
  closedAt?: number
  status: "OPEN" | "CLOSED"
  closeReason?: "SL_HIT" | "TP2_HIT" | "TRAIL_STOP" | "MANUAL"
  pnlUsd?: number
  trailing: ScalpTrailingState
  lastUpdateAt?: number
  lastTelegramAt?: number
}

export const SCALP_COINS = [
  "BTC-USDT",
  "ETH-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "ADA-USDT",
  "DOT-USDT",
  "MATIC-USDT",
  "LTC-USDT",
  "LINK-USDT",
  "XLM-USDT",
  "SOL-USDT",
  "SUI-USDT",
  "UNI-USDT",
  "BCH-USDT",
  "ETHFI-USDT",
  "INJ-USDT",
  "ETC-USDT",
  "COMP-USDT",
  "ONDO-USDT",
  "DYDX-USDT",
  "TAO-USDT"
] as const

export const DEFAULT_SCALP_SETTINGS: ScalpSettings = {
  enabled: false,
  paused: false,
  mode: "paper",
  patternRequired: true,
  patternMinStrength: "MODERATE",
  patternBlockOpposing: true,
  filters: DEFAULT_SCALP_FILTERS,
  paperBalanceUsd: 250,
  maxDailyLossUsd: 0,
  tp1Amount: 3,
  tp2Amount: 5,
  slAmount: 5,
  trailingEnabled: true,
  lockAtTp1: 3,
  trailDistance: 1,
  leverage: 20,
  marginPerTrade: 10,
  maxConcurrent: 3,
  maxPerDay: 10,
  timeframe: "5m",
  minScore: 70,
  enabledCoins: [...SCALP_COINS]
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): ScalpSettings {
  const timeframe = String(env.SCALPING_TIMEFRAME ?? DEFAULT_SCALP_SETTINGS.timeframe).toLowerCase()
  const tf: ScalpTimeframe = isScalpTimeframe(timeframe) ? timeframe : DEFAULT_SCALP_SETTINGS.timeframe
  const mode = normalizeMode(env.SCALPING_MODE ?? DEFAULT_SCALP_SETTINGS.mode)
  const patternRequired = toBool(env.SCALPING_PATTERN_REQUIRED, DEFAULT_SCALP_SETTINGS.patternRequired)
  const patternMinStrength = normalizePatternMinStrength(env.SCALPING_PATTERN_MIN_STRENGTH ?? DEFAULT_SCALP_SETTINGS.patternMinStrength)
  const patternBlockOpposing = toBool(env.SCALPING_PATTERN_BLOCK_OPPOSING, DEFAULT_SCALP_SETTINGS.patternBlockOpposing)
  const filters = filtersFromEnv(env)
  const coins = String(env.SCALPING_ENABLED_COINS ?? "").trim()
  const allowed = new Set<string>(SCALP_COINS as unknown as string[])
  const parsedCoins = coins ? coins.split(",").map((s) => s.trim()).filter(Boolean) : []
  const filteredCoins = parsedCoins.filter((c) => allowed.has(c))
  const enabledCoins = filteredCoins.length ? filteredCoins : [...DEFAULT_SCALP_SETTINGS.enabledCoins]
  return {
    enabled: toBool(env.SCALPING_ENABLED, DEFAULT_SCALP_SETTINGS.enabled),
    paused: toBool(env.SCALPING_PAUSED, DEFAULT_SCALP_SETTINGS.paused),
    mode,
    patternRequired,
    patternMinStrength,
    patternBlockOpposing,
    filters,
    paperBalanceUsd: toNum(env.SCALPING_PAPER_BALANCE, DEFAULT_SCALP_SETTINGS.paperBalanceUsd),
    maxDailyLossUsd: toNum(env.SCALPING_MAX_DAILY_LOSS_USD, DEFAULT_SCALP_SETTINGS.maxDailyLossUsd),
    tp1Amount: toNum(env.SCALPING_TP1_AMOUNT, DEFAULT_SCALP_SETTINGS.tp1Amount),
    tp2Amount: toNum(env.SCALPING_TP2_AMOUNT, DEFAULT_SCALP_SETTINGS.tp2Amount),
    slAmount: toNum(env.SCALPING_SL_AMOUNT, DEFAULT_SCALP_SETTINGS.slAmount),
    trailingEnabled: toBool(env.SCALPING_TRAILING_ENABLED, DEFAULT_SCALP_SETTINGS.trailingEnabled),
    lockAtTp1: toNum(env.SCALPING_LOCK_AT_TP1, DEFAULT_SCALP_SETTINGS.lockAtTp1),
    trailDistance: toNum(env.SCALPING_TRAIL_DISTANCE, DEFAULT_SCALP_SETTINGS.trailDistance),
    leverage: clampInt(env.SCALPING_LEVERAGE, DEFAULT_SCALP_SETTINGS.leverage, 1, 50),
    marginPerTrade: toNum(env.SCALPING_MARGIN_PER_TRADE, DEFAULT_SCALP_SETTINGS.marginPerTrade),
    maxConcurrent: clampInt(env.SCALPING_MAX_CONCURRENT, DEFAULT_SCALP_SETTINGS.maxConcurrent, 1, 20),
    maxPerDay: clampInt(env.SCALPING_MAX_PER_DAY, DEFAULT_SCALP_SETTINGS.maxPerDay, 1, 100),
    timeframe: tf,
    minScore: clampInt(env.SCALPING_MIN_SCORE, DEFAULT_SCALP_SETTINGS.minScore, 0, 100),
    enabledCoins
  }
}

export function computePnlUsd(trade: Pick<ScalpTrade, "direction" | "entryPrice" | "quantity">, currentPrice: number): number {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0
  const move = trade.direction === "LONG" ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice
  return round2(move * trade.quantity)
}

export function calculateFees(positionValue: number, holdingHours: number = 0): ScalpFees {
  const pv = Math.max(0, positionValue)
  const openFee = pv * BINGX_FEES.taker
  const closeFee = pv * BINGX_FEES.taker
  const fundingPeriods = Math.floor(Math.max(0, holdingHours) / 8)
  const fundingFee = pv * 0.0001 * Math.max(0, fundingPeriods)
  const totalFee = openFee + closeFee + fundingFee
  return { openFee: round4(openFee), closeFee: round4(closeFee), fundingFee: round4(fundingFee), totalFee: round4(totalFee) }
}

export function calculateVWAP(candles: Candle[]): number {
  let sumPV = 0
  let sumV = 0
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3
    sumPV += typical * c.volume
    sumV += c.volume
  }
  return sumV > 0 ? sumPV / sumV : candles[candles.length - 1]?.close ?? 0
}

export function scoreScalpSymbol(
  candles: Candle[],
  settings: Pick<ScalpSettings, "patternRequired" | "patternMinStrength" | "patternBlockOpposing" | "filters">,
  ctx: { nowMs?: number } = {}
): { direction?: "LONG" | "SHORT"; score: number; signal?: Omit<ScalpSignal, "symbol"> } {
  if (candles.length < 80) return { score: 0 }
  const closes = candles.map((c) => c.close)
  const last = candles[candles.length - 1]
  if (!last) return { score: 0 }

  const nowMs = ctx.nowMs ?? Date.now()
  if (settings.filters.session_filter && !isActiveSession(nowMs)) return { score: 0 }

  const ema8 = emaLast(closes, 8)
  const ema13 = emaLast(closes, 13)
  const ema21 = emaLast(closes, 21)
  const ema34 = emaLast(closes, 34)
  const ema55 = emaLast(closes, 55)

  const ribbonBull = ema8 > ema13 && ema13 > ema21 && ema21 > ema34 && ema34 > ema55
  const ribbonBear = ema8 < ema13 && ema13 < ema21 && ema21 < ema34 && ema34 < ema55
  const direction = ribbonBull ? "LONG" : ribbonBear ? "SHORT" : undefined
  const emaRibbonScore = settings.filters.ema_ribbon && direction ? 25 : 0

  const vwap = calculateVWAP(candles.slice(-60))
  const close = last.close
  const directionUsed: "LONG" | "SHORT" = direction ?? (close >= vwap ? "LONG" : "SHORT")
  const vwapOk = directionUsed === "LONG" ? close > vwap : close < vwap
  const vwapScore = settings.filters.vwap_position && vwapOk ? 20 : 0

  if (settings.filters.candle_confirm) {
    const ok = directionUsed === "LONG" ? last.close > last.open : last.close < last.open
    if (!ok) return { score: 0 }
  }

  if (settings.filters.wick_ratio) {
    const body = Math.abs(last.close - last.open)
    const range = Math.max(1e-12, last.high - last.low)
    const bodyRatio = body / range
    if (bodyRatio < 0.4) return { score: 0 }
  }

  if (settings.filters.min_breakout) {
    const distPct = vwap > 0 ? (Math.abs(close - vwap) / vwap) * 100 : 0
    if (distPct < 0.15) return { score: 0 }
  }

  if (settings.filters.breakout_retest) {
    if (candles.length < 35) return { score: 0 }
    const lookback = 20
    const pre = candles.slice(-(lookback + 2), -2)
    const breakoutCandle = candles[candles.length - 2]
    if (!breakoutCandle || pre.length < lookback) return { score: 0 }
    const levelHigh = Math.max(...pre.map((c) => c.high))
    const levelLow = Math.min(...pre.map((c) => c.low))
    const avgVol = average(pre.map((c) => c.volume))
    const breakoutVolRatio = avgVol > 0 ? breakoutCandle.volume / avgVol : 0
    if (breakoutVolRatio < 1.5) return { score: 0 }
    if (directionUsed === "LONG") {
      const broke = breakoutCandle.close > levelHigh
      const retested = last.low <= levelHigh && last.close >= levelHigh
      if (!broke || !retested) return { score: 0 }
    } else {
      const broke = breakoutCandle.close < levelLow
      const retested = last.high >= levelLow && last.close <= levelLow
      if (!broke || !retested) return { score: 0 }
    }
  }

  const rsi = rsiLast(closes, 14)
  const rsiPrev = rsiLast(closes.slice(0, -1), 14)
  const rsiMomentumBull = directionUsed === "LONG" && rsi > 50 && rsi < 70 && rsi > rsiPrev
  const rsiMomentumBear = directionUsed === "SHORT" && rsi < 50 && rsi > 30 && rsi < rsiPrev
  const rsiOk = rsiMomentumBull || rsiMomentumBear
  const rsiScore = settings.filters.rsi_momentum && rsiOk ? 20 : 0

  const vol20 = candles.slice(-21, -1).map((c) => c.volume)
  const volAvg = average(vol20)
  const volRatio = volAvg > 0 ? last.volume / volAvg : 0
  const volumeScore = settings.filters.volume_surge ? (volRatio >= 3.0 ? 20 : volRatio >= 2.0 ? 15 : volRatio >= 1.5 ? 8 : 0) : 0

  const patternResult = settings.filters.candle_pattern ? detectAllPatterns(candles.slice(-60), directionUsed) : null
  const patternAllowed = settings.filters.candle_pattern ? canUsePattern(patternResult as PatternResult, directionUsed, settings) : true
  const candleScoreRaw = settings.filters.candle_pattern && patternAllowed ? Math.max(0, patternResult?.score ?? 0) : 0
  const candleScore = clampNum(candleScoreRaw, 0, 15)

  const macdOk = settings.filters.macd_confirm ? macdConfirm(closes, directionUsed) : true
  const macdScore = settings.filters.macd_confirm && macdOk ? 10 : 0

  const bbOk = settings.filters.bb_squeeze ? bollingerSqueeze(closes) : true
  const bbScore = settings.filters.bb_squeeze && bbOk ? 10 : 0

  const stochOk = settings.filters.stoch_rsi ? stochRsiCross(closes, directionUsed) : true
  const stochScore = settings.filters.stoch_rsi && stochOk ? 10 : 0

  const baseScore = emaRibbonScore + vwapScore + rsiScore + volumeScore + macdScore + bbScore + stochScore
  const score = patternAllowed ? clampNum(baseScore + candleScore, 0, 100) : 0
  const top: { k: string; v: number }[] = [
    { k: "EMA Ribbon", v: emaRibbonScore },
    { k: "VWAP", v: vwapScore },
    { k: "RSI", v: rsiScore },
    { k: "Volume", v: volumeScore },
    { k: "MACD", v: macdScore },
    { k: "BB Squeeze", v: bbScore },
    { k: "Stoch RSI", v: stochScore },
    { k: "Pattern", v: candleScore }
  ]
  top.sort((a, b) => b.v - a.v)
  const topFilters = top.filter((x) => x.v > 0).slice(0, 3).map((x) => x.k)

  return {
    direction,
    score,
    signal: {
      direction: directionUsed,
      score,
      vwap,
      vwapOk,
      rsi,
      rsiPrev,
      rsiOk,
      volRatio,
      patternAllowed,
      patternResult,
      topFilters
    }
  }
}

export async function scanScalpLeaderboard(opts: {
  settings: ScalpSettings
  fetchKlines: (symbol: string, interval: ScalpTimeframe, limit: number) => Promise<Candle[]>
  fetchOrderbook?: (symbol: string) => Promise<{ bids: Array<[string, string]>; asks: Array<[string, string]> }>
}): Promise<ScalpSignal[]> {
  const symbols = opts.settings.enabledCoins.length ? opts.settings.enabledCoins : [...SCALP_COINS]
  const nowMs = Date.now()
  const settled = await Promise.allSettled(symbols.map((sym) => opts.fetchKlines(sym, opts.settings.timeframe, 120)))
  const base: Array<{ symbol: string; candles: Candle[]; signal: ScalpSignal } > = []

  for (let i = 0; i < settled.length; i += 1) {
    const s = settled[i]
    const symbol = symbols[i] ?? ""
    if (s.status !== "fulfilled") continue
    const candles = s.value
    const scored = scoreScalpSymbol(candles, opts.settings, { nowMs })
    if (!scored.signal) continue
    const direction = scored.direction ?? scored.signal.direction
    base.push({ symbol, candles, signal: { symbol, ...scored.signal, direction } })
  }

  base.sort((a, b) => b.signal.score - a.signal.score)

  const needsMtf = Boolean(opts.settings.filters.mtf_5m || opts.settings.filters.mtf_15m || opts.settings.filters.htf_ema_align)
  const needsOb = Boolean(opts.settings.filters.spread_check || opts.settings.filters.bid_ask_imbalance || opts.settings.filters.ob_wall)
  const needsCvd = Boolean(opts.settings.filters.cvd)
  const needsLiq = Boolean(opts.settings.filters.liq_cluster)
  const enrichTop = Math.min(8, base.length)

  if (enrichTop > 0 && (needsMtf || needsCvd || needsLiq || (needsOb && opts.fetchOrderbook))) {
    await Promise.all(
      base.slice(0, enrichTop).map(async (row) => {
        let score = row.signal.score
        const topFilters = new Set(row.signal.topFilters)

        if (needsMtf) {
          const { tf1, tf2 } = mtfTimeframes(opts.settings.timeframe)
          const [c1, c2] = await Promise.all([
            tf1 ? opts.fetchKlines(row.symbol, tf1, 80).catch(() => []) : Promise.resolve([]),
            tf2 ? opts.fetchKlines(row.symbol, tf2, 80).catch(() => []) : Promise.resolve([])
          ])
          const mtf = mtfConfirmation({ entryCandles: row.candles, tf1Candles: c1, tf2Candles: c2, direction: row.signal.direction })
          if ((opts.settings.filters.mtf_5m || opts.settings.filters.mtf_15m || opts.settings.filters.htf_ema_align) && mtf.score > 0) {
            score = clampNum(score + mtf.score, 0, 100)
            topFilters.add("MTF")
          }
        }

        if (needsOb && opts.fetchOrderbook) {
          const depth = await opts.fetchOrderbook(row.symbol).catch(() => null)
          if (depth) {
            const ob = analyzeOrderbook(depth)
            if (opts.settings.filters.spread_check && !ob.spreadSafe) {
              row.signal.score = 0
              row.signal.topFilters = ["Spread"]
              return
            }
            if (opts.settings.filters.bid_ask_imbalance) {
              const ok = row.signal.direction === "LONG" ? ob.imbalance > 0.2 : ob.imbalance < -0.2
              if (ok && Math.abs(ob.imbalance) > 0.4) {
                score = clampNum(score + 15, 0, 100)
                topFilters.add("Imbalance")
              } else if (!ok && Math.abs(ob.imbalance) > 0.5) {
                row.signal.score = 0
                row.signal.topFilters = ["Imbalance"]
                return
              }
            }
            if (opts.settings.filters.ob_wall) {
              const wallOk = row.signal.direction === "LONG" ? ob.bidWall !== null : ob.askWall !== null
              if (wallOk) {
                score = clampNum(score + 10, 0, 100)
                topFilters.add("OB Wall")
              }
            }
          }
        }

        if (needsCvd) {
          const slice = row.candles.slice(-30)
          const cvd = slice.reduce((sum, c) => {
            const dir = c.close >= c.open ? 1 : -1
            return sum + dir * Math.max(0, c.volume)
          }, 0)
          const ok = row.signal.direction === "LONG" ? cvd > 0 : cvd < 0
          if (ok) {
            score = clampNum(score + 15, 0, 100)
            topFilters.add("CVD")
          } else {
            row.signal.score = 0
            row.signal.topFilters = ["CVD"]
            return
          }
        }

        if (needsLiq) {
          const liq = detectLiqCluster(row.candles, row.signal.direction)
          if (liq) {
            score = clampNum(score + 10, 0, 100)
            topFilters.add("Liq")
          }
        }

        row.signal.score = score
        row.signal.topFilters = Array.from(topFilters).slice(0, 3)
      })
    )
  }

  const out = base.map((x) => x.signal)
  out.sort((a, b) => b.score - a.score)
  return out
}

export function manageScalpTrade(trade: ScalpTrade, currentPrice: number, settings: ScalpSettings): { next: ScalpTrade; close?: ScalpTrade } {
  if (trade.status !== "OPEN") return { next: trade }
  const pnl = computePnlUsd(trade, currentPrice)
  const trailing = { ...trade.trailing }
  trailing.tp1Amount = settings.tp1Amount
  trailing.tp2Amount = settings.tp2Amount
  trailing.slAmount = settings.slAmount
  trailing.trailDistance = settings.trailDistance
  trailing.active = settings.trailingEnabled

  if (trailing.phase === "INITIAL") {
    if (pnl <= -settings.slAmount) {
      const closed: ScalpTrade = {
        ...trade,
        status: "CLOSED",
        closeReason: "SL_HIT",
        closedAt: Date.now(),
        pnlUsd: -Math.abs(settings.slAmount),
        trailing: { ...trailing, phase: "CLOSED" }
      }
      return { next: closed, close: closed }
    }

    if (pnl >= settings.tp1Amount && settings.trailingEnabled) {
      trailing.phase = "TRAILING"
      trailing.lockedPnl = settings.lockAtTp1
      trailing.highWaterMark = Math.max(trailing.highWaterMark, pnl)
    }
  }

  if (trailing.phase === "TRAILING") {
    if (pnl > trailing.highWaterMark) trailing.highWaterMark = pnl
    const trailStop = trailing.highWaterMark - settings.trailDistance
    if (pnl <= trailStop) {
      const closed: ScalpTrade = {
        ...trade,
        status: "CLOSED",
        closeReason: "TRAIL_STOP",
        closedAt: Date.now(),
        pnlUsd: round2(pnl),
        trailing: { ...trailing, phase: "CLOSED" }
      }
      return { next: closed, close: closed }
    }
    if (pnl >= settings.tp2Amount) {
      const closed: ScalpTrade = {
        ...trade,
        status: "CLOSED",
        closeReason: "TP2_HIT",
        closedAt: Date.now(),
        pnlUsd: round2(settings.tp2Amount),
        trailing: { ...trailing, phase: "CLOSED" }
      }
      return { next: closed, close: closed }
    }
  }

  const next: ScalpTrade = { ...trade, pnlUsd: round2(pnl), trailing, lastUpdateAt: Date.now() }
  return { next }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000
}

function average(values: number[]): number {
  const nums = values.filter((x) => Number.isFinite(x))
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function emaLast(values: number[], period: number): number {
  const k = 2 / (period + 1)
  let result = values[0] ?? 0
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i] ?? result
    result = v * k + result * (1 - k)
  }
  return result
}

function rsiLast(values: number[], period: number): number {
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

function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let result = values[0] ?? 0
  out.push(result)
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i] ?? result
    result = v * k + result * (1 - k)
    out.push(result)
  }
  return out
}

function macdConfirm(values: number[], direction: "LONG" | "SHORT"): boolean {
  if (values.length < 40) return false
  const fast = emaSeries(values, 12)
  const slow = emaSeries(values, 26)
  const macdLine = fast.map((v, i) => v - (slow[i] ?? v))
  const signalLine = emaSeries(macdLine, 9)
  const lastMacd = macdLine[macdLine.length - 1] ?? 0
  const lastSig = signalLine[signalLine.length - 1] ?? 0
  const hist = lastMacd - lastSig
  return direction === "LONG" ? lastMacd > lastSig && hist > 0 : lastMacd < lastSig && hist < 0
}

function stdDev(values: number[]): number {
  if (!values.length) return 0
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - avg) * (v - avg), 0) / values.length
  return Math.sqrt(variance)
}

function bollingerSqueeze(values: number[]): boolean {
  const lookback = 20
  if (values.length < lookback) return false
  const slice = values.slice(-lookback)
  const mid = slice.reduce((s, v) => s + v, 0) / slice.length
  const sd = stdDev(slice)
  const upper = mid + 2 * sd
  const lower = mid - 2 * sd
  const widthPct = mid > 0 ? ((upper - lower) / mid) * 100 : 0
  return widthPct > 0 && widthPct < 1.0
}

function rsiSeries(values: number[], period: number): number[] {
  const out: number[] = []
  if (values.length < period + 1) return values.map(() => 50)
  for (let i = 0; i < values.length; i += 1) {
    const slice = values.slice(0, i + 1)
    out.push(rsiLast(slice, period))
  }
  return out
}

function stochRsiCross(values: number[], direction: "LONG" | "SHORT"): boolean {
  if (values.length < 60) return false
  const rsi = rsiSeries(values, 14)
  const lookback = 14
  if (rsi.length < lookback + 2) return false
  const calc = (idx: number) => {
    const window = rsi.slice(idx - lookback + 1, idx + 1)
    const min = Math.min(...window)
    const max = Math.max(...window)
    const cur = rsi[idx] ?? 50
    const k = max > min ? ((cur - min) / (max - min)) * 100 : 50
    return k
  }
  const kPrev = calc(rsi.length - 2)
  const kNow = calc(rsi.length - 1)
  return direction === "LONG" ? kPrev < 20 && kNow >= 20 : kPrev > 80 && kNow <= 80
}

function isActiveSession(nowMs: number): boolean {
  const d = new Date(nowMs)
  const h = d.getUTCHours()
  return h >= 7 && h <= 22
}

function mtfTimeframes(entry: ScalpTimeframe): { tf1: ScalpTimeframe | null; tf2: ScalpTimeframe | null } {
  if (entry === "1m") return { tf1: "5m", tf2: "15m" }
  if (entry === "3m") return { tf1: "15m", tf2: "30m" }
  if (entry === "5m") return { tf1: "15m", tf2: "30m" }
  if (entry === "15m") return { tf1: "30m", tf2: null }
  return { tf1: "30m", tf2: null }
}

function mtfConfirmation(opts: {
  entryCandles: Candle[]
  tf1Candles: Candle[]
  tf2Candles: Candle[]
  direction: "LONG" | "SHORT"
}): { score: number } {
  const tf1Ok = mtfConfirmTf(opts.tf1Candles, opts.direction)
  const tf2Ok = opts.tf2Candles.length ? mtfConfirmTf(opts.tf2Candles, opts.direction) : false
  const confirmed = opts.tf2Candles.length ? tf1Ok && tf2Ok : tf1Ok
  const partial = opts.tf2Candles.length ? tf1Ok || tf2Ok : tf1Ok
  return { score: confirmed ? 20 : partial ? 10 : 0 }
}

function mtfConfirmTf(candles: Candle[], direction: "LONG" | "SHORT"): boolean {
  if (candles.length < 55) return false
  const closes = candles.map((c) => c.close)
  const last = candles[candles.length - 1]
  if (!last) return false
  const ema20 = emaLast(closes, 20)
  const ema50 = emaLast(closes, 50)
  const vwap = calculateVWAP(candles.slice(-60))
  if (direction === "LONG") return ema20 > ema50 && last.close > vwap
  return ema20 < ema50 && last.close < vwap
}

function analyzeOrderbook(depth: { bids: Array<[string, string]>; asks: Array<[string, string]> }): {
  bidVol: number
  askVol: number
  imbalance: number
  bidWall: number | null
  askWall: number | null
  spreadPct: number
  spreadSafe: boolean
} {
  const bids = Array.isArray(depth.bids) ? depth.bids : []
  const asks = Array.isArray(depth.asks) ? depth.asks : []
  const bidVol = bids.slice(0, 10).reduce((s, b) => s + Number(b[1] ?? 0), 0)
  const askVol = asks.slice(0, 10).reduce((s, a) => s + Number(a[1] ?? 0), 0)
  const total = bidVol + askVol
  const imbalance = total > 0 ? (bidVol - askVol) / total : 0
  const avgBid = bids.length ? bidVol / Math.min(10, bids.length) : 0
  const avgAsk = asks.length ? askVol / Math.min(10, asks.length) : 0
  const bidWallLevel = bids.find((b) => Number(b[1] ?? 0) > avgBid * 5)
  const askWallLevel = asks.find((a) => Number(a[1] ?? 0) > avgAsk * 5)
  const bestBid = Number(bids[0]?.[0] ?? 0)
  const bestAsk = Number(asks[0]?.[0] ?? 0)
  const spreadPct = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 999
  return {
    bidVol,
    askVol,
    imbalance,
    bidWall: bidWallLevel ? Number(bidWallLevel[0]) : null,
    askWall: askWallLevel ? Number(askWallLevel[0]) : null,
    spreadPct,
    spreadSafe: spreadPct < 0.05
  }
}

function detectLiqCluster(candles: Candle[], direction: "LONG" | "SHORT"): boolean {
  if (candles.length < 30) return false
  const recent = candles.slice(-12, -1)
  if (recent.length < 6) return false
  const vols = recent.slice(0, -1).map((c) => c.volume)
  const vAvg = average(vols)
  if (vAvg <= 0) return false
  for (const c of recent) {
    const body = Math.abs(c.close - c.open)
    const range = Math.max(1e-12, c.high - c.low)
    const upperWick = c.high - Math.max(c.open, c.close)
    const lowerWick = Math.min(c.open, c.close) - c.low
    const wick = direction === "LONG" ? lowerWick : upperWick
    const wickRatio = range > 0 ? wick / range : 0
    const bodyRatio = range > 0 ? body / range : 0
    const volSpike = c.volume / vAvg
    const sweep = wickRatio >= 0.45 && bodyRatio <= 0.45 && volSpike >= 2.0
    if (sweep) return true
  }
  return false
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  const s = String(v ?? "").toLowerCase().trim()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const m = Number.isFinite(n) ? Math.floor(n) : fallback
  return Math.max(min, Math.min(max, m))
}

function isScalpTimeframe(v: string): v is ScalpTimeframe {
  return v === "1m" || v === "3m" || v === "5m" || v === "15m" || v === "30m"
}

function normalizeMode(v: unknown): ScalpMode {
  const s = String(v ?? "paper").toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  return "paper"
}

function normalizePatternMinStrength(v: unknown): ScalpPatternMinStrength {
  const s = String(v ?? "MODERATE").toUpperCase()
  if (s === "ANY") return "ANY"
  if (s === "STRONG") return "STRONG"
  return "MODERATE"
}

function filtersFromEnv(env: NodeJS.ProcessEnv): ScalpFilterState {
  const raw = String(env.SCALPING_ENABLED_FILTERS ?? "").trim()
  if (!raw) return DEFAULT_SCALP_FILTERS
  const allow = new Set<string>(SCALP_FILTER_DEFS.map((d) => d.id))
  const enabled = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && allow.has(s))
  const out = { ...DEFAULT_SCALP_FILTERS }
  for (const k of Object.keys(out) as ScalpFilterId[]) out[k] = false
  for (const id of enabled as ScalpFilterId[]) out[id] = true
  return out
}

function canUsePattern(
  result: PatternResult,
  direction: "LONG" | "SHORT",
  settings: Pick<ScalpSettings, "patternRequired" | "patternMinStrength" | "patternBlockOpposing">
): boolean {
  if (!settings.patternRequired) return true
  if (!result || !result.found || !result.pattern) return false
  const target = direction === "LONG" ? "BULLISH" : "BEARISH"
  if (result.direction !== target) return false

  const strength = result.pattern.strength
  const matchingCount = result.allPatternNames ? result.allPatternNames.split(" + ").filter(Boolean).length : 1
  if (settings.patternMinStrength === "STRONG" && strength !== "STRONG") return false
  if (settings.patternMinStrength === "MODERATE" && strength === "WEAK" && matchingCount <= 1) return false

  if (settings.patternBlockOpposing) {
    const all = result.allPatterns ?? []
    const hasStrongOpposing = all.some((p: CandlePattern) => p.strength === "STRONG" && p.type !== target)
    if (hasStrongOpposing) return false
  }
  return true
}
