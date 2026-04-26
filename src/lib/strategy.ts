import type {
  Candle,
  FilterKey,
  FilterScores,
  Settings,
  StrategyIndicators,
  StrategySnapshot,
  TradeSide
} from "@/types/bot"

export type MarketContext = {
  spreadPct?: number
  fundingRatePct?: number
  orderBookDepthOk?: boolean
  openInterest?: number
  openInterestChangePct?: number
  fearGreed?: number
  dailyBias?: TradeSide
  inNewsBlackout?: boolean
  lastCandleUp?: boolean
  now?: number
}

export type SetupEvaluation = {
  side: TradeSide
  snapshot: StrategySnapshot
}

const filterPoints: Record<FilterKey, number> = {
  trendEma: 20,
  volumeSpike: 15,
  atrVolatility: 15,
  rsi: 15,
  macd: 10,
  bbSqueeze: 10,
  fibGoldenPocket: 10,
  stochRsi: 10,
  macdDivergence: 10,
  openInterest: 10,
  liquidity: 10,
  fundingRate: 10,
  fundingHardBlock: 0,
  session: 5,
  htfDailyBias: 0,
  newsBlackout: 0,
  oiDivergence: 0,
  fearGreed: 0,
  liquidationTp: 0
}

export function evaluateSetup(
  candles: Candle[],
  settings: Settings,
  ctx: MarketContext = {}
): SetupEvaluation {
  const longSnap = scoreSetup(candles, "LONG", settings, ctx)
  const shortSnap = scoreSetup(candles, "SHORT", settings, ctx)

  const longOk = !longSnap.blocked
  const shortOk = !shortSnap.blocked

  if (longOk && !shortOk) return { side: "LONG", snapshot: longSnap }
  if (!longOk && shortOk) return { side: "SHORT", snapshot: shortSnap }

  if (longSnap.totalScore >= shortSnap.totalScore) return { side: "LONG", snapshot: longSnap }
  return { side: "SHORT", snapshot: shortSnap }
}

export function scoreSetup(
  candles: Candle[],
  side: TradeSide,
  settings: Settings,
  ctx: MarketContext = {}
): StrategySnapshot {
  const now = ctx.now ?? Date.now()
  const scores: FilterScores = {
    trendEma: 0,
    volumeSpike: 0,
    atrVolatility: 0,
    rsi: 0,
    macd: 0,
    bbSqueeze: 0,
    fibGoldenPocket: 0,
    stochRsi: 0,
    macdDivergence: 0,
    openInterest: 0,
    liquidity: 0,
    fundingRate: 0,
    fundingHardBlock: 0,
    session: 0,
    htfDailyBias: 0,
    newsBlackout: 0,
    oiDivergence: 0,
    fearGreed: 0,
    liquidationTp: 0
  }

  const reasons: string[] = []
  const blocks: string[] = []
  const indicators: StrategyIndicators = {
    spreadPct: ctx.spreadPct,
    fundingRatePct: ctx.fundingRatePct,
    openInterest: ctx.openInterest,
    openInterestChangePct: ctx.openInterestChangePct,
    fearGreed: ctx.fearGreed,
    dailyBias: ctx.dailyBias,
    inNewsBlackout: ctx.inNewsBlackout
  }

  if (candles.length < 210) {
    reasons.push("Not enough candles for indicators")
    return { totalScore: 0, scores, reasons, blocked: false, blocks: [], indicators, asOf: now }
  }

  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const volumes = candles.map((c) => c.volume)

  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)
  const rsi14 = rsiWilder(closes, 14)
  const atr14 = atr(highs, lows, closes, 14)
  const macdRes = macd(closes, 12, 26, 9)
  const bb = bollingerBandwidthPct(closes, 20, 2)
  const bbAvg20 = sma(bollingerBandwidthSeriesPct(closes, 20, 2).slice(-20), 20)
  const stoch = stochRsi(closes, 14, 14, 3, 3)
  const fib = fibGoldenPocket(closes, highs, lows, settings.thresholds.fibLookbackCandles)
  const div = macdDivergence(closes, highs, lows, 12, 26, 9, 60)

  indicators.ema20 = ema20
  indicators.ema50 = ema50
  indicators.ema200 = ema200
  indicators.rsi14 = rsi14
  indicators.atr14 = atr14
  indicators.macdLine = macdRes.macd
  indicators.macdSignal = macdRes.signal
  indicators.macdHist = macdRes.histogram
  indicators.bbBandwidthPct = bb
  indicators.bbBandwidthPctAvg20 = bbAvg20
  indicators.stochRsiK = stoch.k
  indicators.stochRsiD = stoch.d
  indicators.fibInGoldenPocket = fib.inGoldenPocket
  indicators.fibLevel = fib.level
  indicators.macdDivergence = div

  if (settings.filters.trendEma) {
    const ok =
      side === "LONG"
        ? ema20 > ema50 && ema50 > ema200
        : ema20 < ema50 && ema50 < ema200
    if (ok) scores.trendEma = filterPoints.trendEma
    else reasons.push("EMA alignment not confirmed")
  }

  if (settings.filters.volumeSpike) {
    const lastClose = closes[closes.length - 1] ?? 0
    const lastVolContracts = volumes[volumes.length - 1] ?? 0
    const lastVolumeUsdt = Number.isFinite(lastClose) && Number.isFinite(lastVolContracts) ? lastVolContracts * lastClose : 0

    const recent = candles.slice(-20)
    const avgVolumeUsdt =
      recent.length > 0
        ? recent.reduce((sum, c) => sum + (Number.isFinite(c.volume) && Number.isFinite(c.close) ? c.volume * c.close : 0), 0) /
          recent.length
        : 0

    const ratio = avgVolumeUsdt > 0 ? lastVolumeUsdt / avgVolumeUsdt : 0
    indicators.volumeRatio = ratio

    const volumeScore =
      ratio >= 2.0 ? 15 : ratio >= 1.5 ? 12 : ratio >= 1.0 ? 6 : ratio >= 0.7 ? 3 : 0

    if (volumeScore > 0) scores.volumeSpike = volumeScore
    else reasons.push("No volume spike")
  }

  if (settings.filters.atrVolatility) {
    const min = settings.thresholds.atrMin
    const max = settings.thresholds.atrMax
    if (atr14 >= min && atr14 <= max) {
      scores.atrVolatility = filterPoints.atrVolatility
    } else {
      reasons.push("ATR outside thresholds")
    }
  }

  if (settings.filters.rsi) {
    const ok = rsi14 > 45 && rsi14 < 65
    if (ok) scores.rsi = filterPoints.rsi
    else reasons.push("RSI filter not satisfied")
  }

  if (settings.filters.macd) {
    const prev = macd(closes.slice(0, -1), 12, 26, 9)
    const sign = side === "LONG" ? 1 : -1
    const hist = (macdRes.histogram ?? 0) * sign
    const histPrev = (prev.histogram ?? 0) * sign
    const macdAboveSignal = ((macdRes.macd ?? 0) - (macdRes.signal ?? 0)) * sign > 0
    const histImproving = hist > histPrev

    const macdScore =
      macdAboveSignal && hist > 0 ? 10 : hist > 0 && histImproving ? 7 : macdAboveSignal ? 5 : histImproving && histPrev < 0 ? 3 : 0

    if (macdScore > 0) scores.macd = macdScore
    else reasons.push("No MACD confirmation")
  }

  if (settings.filters.bbSqueeze) {
    if (bbAvg20 > 0 && bb < bbAvg20 * settings.thresholds.bbSqueezePctOfAvg) {
      scores.bbSqueeze = filterPoints.bbSqueeze
    } else {
      reasons.push("No Bollinger squeeze")
    }
  }

  if (settings.filters.fibGoldenPocket) {
    if (fib.inGoldenPocket) scores.fibGoldenPocket = filterPoints.fibGoldenPocket
    else reasons.push("Not in Fibonacci golden pocket")
  }

  if (settings.filters.stochRsi) {
    const ok =
      side === "LONG"
        ? stoch.cross === "BULLISH" && Math.max(stoch.k, stoch.d) < 20
        : stoch.cross === "BEARISH" && Math.min(stoch.k, stoch.d) > 80
    if (ok) scores.stochRsi = filterPoints.stochRsi
    else reasons.push("Stoch RSI entry signal not present")
  }

  if (settings.filters.macdDivergence) {
    const ok =
      side === "LONG"
        ? div === "REGULAR_BULLISH" || div === "HIDDEN_BULLISH"
        : div === "REGULAR_BEARISH" || div === "HIDDEN_BEARISH"
    if (ok) scores.macdDivergence = filterPoints.macdDivergence
    else reasons.push("No MACD divergence")
  }

  if (settings.filters.openInterest) {
    const oiChange = ctx.openInterestChangePct
    if (oiChange === undefined) {
      reasons.push("Open interest unavailable")
    } else if (Math.abs(oiChange) >= 0.5) {
      scores.openInterest = filterPoints.openInterest
    } else {
      reasons.push("OI change too small")
    }
  }

  if (settings.filters.liquidity) {
    const spread = ctx.spreadPct
    const depthOk = ctx.orderBookDepthOk
    const spreadOk = spread === undefined ? false : spread < settings.thresholds.maxSpreadPct
    if (spreadOk && depthOk) scores.liquidity = filterPoints.liquidity
    else reasons.push("Liquidity check failed")
  }

  if (settings.filters.fundingRate) {
    const funding = ctx.fundingRatePct
    if (funding === undefined) {
      reasons.push("Funding rate unavailable")
    } else {
      const rate = funding / 100
      const abs = Math.abs(rate)
      const score = abs < 0.0001 ? filterPoints.fundingRate : abs < 0.0003 ? Math.round(filterPoints.fundingRate / 2) : 0
      if (score > 0) scores.fundingRate = score
      else reasons.push("Funding rate not favorable")
    }
  }

  if (settings.filters.session) {
    const hour = new Date(now).getUTCHours()
    const londonOpen = hour >= 8 && hour < 16
    const nyOpen = hour >= 13 && hour < 21
    const active = londonOpen || nyOpen
    scores.session = active ? filterPoints.session : 3
  }

  if (settings.filters.fundingHardBlock) {
    const funding = ctx.fundingRatePct
    if (side === "LONG" && funding !== undefined && funding > settings.thresholds.fundingHardBlockPct) {
      blocks.push("High funding rate detected — trade skipped")
    }
  }

  if (settings.filters.htfDailyBias) {
    const daily = ctx.dailyBias
    if (daily && daily !== side) {
      blocks.push("HTF daily bias opposes setup")
    }
  }

  if (settings.filters.newsBlackout) {
    if (ctx.inNewsBlackout) {
      blocks.push("News blackout window — trade skipped")
    }
  }

  if (settings.filters.oiDivergence) {
    const lastUp = ctx.lastCandleUp
    const oiCh = ctx.openInterestChangePct
    if (lastUp === true && oiCh !== undefined && oiCh < 0) {
      blocks.push("OI divergence block: price up + OI down = skip trade")
    }
  }

  if (settings.filters.fearGreed) {
    const fg = ctx.fearGreed
    if (fg !== undefined) {
      if (fg < settings.thresholds.fearGreedLongOnlyBelow && side === "SHORT") {
        blocks.push("Fear & Greed extremely low — only longs allowed")
      }
      if (fg > settings.thresholds.fearGreedShortOnlyAbove && side === "LONG") {
        blocks.push("Fear & Greed extremely high — only shorts allowed")
      }
    } else {
      reasons.push("Fear & Greed unavailable")
    }
  }

  const rawScore = Object.values(scores).reduce((a, b) => a + b, 0)
  const totalScore = Math.min(100, rawScore)
  const blocked = blocks.length > 0

  return { totalScore, scores, reasons, blocked, blocks, indicators, asOf: now }
}

export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0
  const slice = values.slice(-period)
  const sum = slice.reduce((a, b) => a + b, 0)
  return sum / slice.length
}

export function ema(values: number[], period: number): number {
  const k = 2 / (period + 1)
  let result = values[0] ?? 0
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i] ?? result
    result = v * k + result * (1 - k)
  }
  return result
}

export function rsi(values: number[], period: number): number {
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

function rsiWilder(values: number[], period: number): number {
  if (values.length < period + 1) return 50
  let gains = 0
  let losses = 0

  for (let i = 1; i <= period; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0)
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0)
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function atr(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return 0
  const trs: number[] = []
  for (let i = highs.length - period; i < highs.length; i += 1) {
    const high = highs[i] ?? 0
    const low = lows[i] ?? 0
    const prevClose = closes[i - 1] ?? closes[i] ?? 0
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trs.push(tr)
  }
  return sma(trs, trs.length)
}

export function macd(
  closes: number[],
  fast: number,
  slow: number,
  signal: number
): { macd: number; signal: number; histogram: number; crossover: "BULLISH" | "BEARISH" | "NONE" } {
  const macdSeries = buildMacdSeries(closes, fast, slow)
  const macdLine = macdSeries[macdSeries.length - 1] ?? 0
  const signalLine = ema(macdSeries, signal)
  const hist = macdLine - signalLine

  const prevMacd = macdSeries[macdSeries.length - 2] ?? macdLine
  const prevSignal = ema(macdSeries.slice(0, -1), signal)

  let crossover: "BULLISH" | "BEARISH" | "NONE" = "NONE"
  if (prevMacd <= prevSignal && macdLine > signalLine) crossover = "BULLISH"
  if (prevMacd >= prevSignal && macdLine < signalLine) crossover = "BEARISH"

  return { macd: macdLine, signal: signalLine, histogram: hist, crossover }
}

export function bollingerBandwidthPct(closes: number[], period: number, mult: number): number {
  if (closes.length < period) return 0
  const slice = closes.slice(-period)
  const m = sma(slice, period)
  const variance = slice.reduce((acc, v) => acc + (v - m) * (v - m), 0) / slice.length
  const sd = Math.sqrt(variance)
  const upper = m + mult * sd
  const lower = m - mult * sd
  if (m === 0) return 0
  return ((upper - lower) / m) * 100
}

export function bollingerBandwidthSeriesPct(closes: number[], period: number, mult: number): number[] {
  const out: number[] = []
  for (let i = 0; i < closes.length; i += 1) {
    const window = closes.slice(Math.max(0, i - period + 1), i + 1)
    if (window.length < period) continue
    out.push(bollingerBandwidthPct(window, period, mult))
  }
  return out
}

export function stochRsi(
  closes: number[],
  rsiLen: number,
  stochLen: number,
  kSmooth: number,
  dSmooth: number
): { k: number; d: number; cross: "BULLISH" | "BEARISH" | "NONE" } {
  const rsiSeries = buildRsiSeries(closes, rsiLen)
  if (rsiSeries.length < stochLen + dSmooth) return { k: 50, d: 50, cross: "NONE" }

  const stochSeries: number[] = []
  for (let i = 0; i < rsiSeries.length; i += 1) {
    const window = rsiSeries.slice(Math.max(0, i - stochLen + 1), i + 1)
    if (window.length < stochLen) continue
    const min = Math.min(...window)
    const max = Math.max(...window)
    const v = rsiSeries[i] ?? 50
    const stoch = max === min ? 0 : ((v - min) / (max - min)) * 100
    stochSeries.push(stoch)
  }

  const kSeries = smoothSmaSeries(stochSeries, kSmooth)
  const dSeries = smoothSmaSeries(kSeries, dSmooth)
  const k = kSeries[kSeries.length - 1] ?? 50
  const d = dSeries[dSeries.length - 1] ?? 50
  const prevK = kSeries[kSeries.length - 2] ?? k
  const prevD = dSeries[dSeries.length - 2] ?? d

  let cross: "BULLISH" | "BEARISH" | "NONE" = "NONE"
  if (prevK <= prevD && k > d) cross = "BULLISH"
  if (prevK >= prevD && k < d) cross = "BEARISH"

  return { k, d, cross }
}

function buildRsiSeries(closes: number[], period: number): number[] {
  if (closes.length < period + 1) return []
  const out: number[] = []
  for (let i = period; i < closes.length; i += 1) {
    const window = closes.slice(i - period, i + 1)
    out.push(rsi(window, period))
  }
  return out
}

function smoothSmaSeries(values: number[], period: number): number[] {
  if (period <= 1) return values
  const out: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const window = values.slice(Math.max(0, i - period + 1), i + 1)
    out.push(sma(window, window.length))
  }
  return out
}

export function fibGoldenPocket(
  closes: number[],
  highs: number[],
  lows: number[],
  lookbackCandles: number
): { inGoldenPocket: boolean; level: number } {
  const lookback = Math.max(20, Math.min(500, Math.floor(lookbackCandles)))
  const start = Math.max(0, closes.length - lookback)
  const h = Math.max(...highs.slice(start))
  const l = Math.min(...lows.slice(start))
  const last = closes[closes.length - 1] ?? 0
  const range = h - l
  if (range <= 0) return { inGoldenPocket: false, level: 0 }
  const fromHigh = (h - last) / range
  const fromLow = (last - l) / range
  const retr = fromHigh
  const inPocket = retr >= 0.5 && retr <= 0.618
  const level = fromLow
  return { inGoldenPocket: inPocket, level }
}

export function macdDivergence(
  closes: number[],
  highs: number[],
  lows: number[],
  fast: number,
  slow: number,
  signal: number,
  lookback: number
): StrategyIndicators["macdDivergence"] {
  const lb = Math.max(30, Math.min(300, Math.floor(lookback)))
  const start = Math.max(0, closes.length - lb)
  const price = closes.slice(start)
  const macdSeries = buildMacdSeries(closes, fast, slow)
  const histSeries = macdSeries.map((m, i) => m - ema(macdSeries.slice(0, i + 1), signal))
  const hist = histSeries.slice(start)

  const lowsIdx = lastTwoLocalExtrema(price, "LOW")
  const highsIdx = lastTwoLocalExtrema(price, "HIGH")

  if (lowsIdx) {
    const [i1, i2] = lowsIdx
    const p1 = price[i1] ?? 0
    const p2 = price[i2] ?? 0
    const m1 = hist[i1] ?? 0
    const m2 = hist[i2] ?? 0
    if (p2 < p1 && m2 > m1) return "REGULAR_BULLISH"
    if (p2 > p1 && m2 < m1) return "HIDDEN_BULLISH"
  }

  if (highsIdx) {
    const [i1, i2] = highsIdx
    const p1 = price[i1] ?? 0
    const p2 = price[i2] ?? 0
    const m1 = hist[i1] ?? 0
    const m2 = hist[i2] ?? 0
    if (p2 > p1 && m2 < m1) return "REGULAR_BEARISH"
    if (p2 < p1 && m2 > m1) return "HIDDEN_BEARISH"
  }

  void highs
  void lows
  return "NONE"
}

function lastTwoLocalExtrema(values: number[], kind: "LOW" | "HIGH"): [number, number] | null {
  const idxs: number[] = []
  for (let i = 2; i < values.length - 2; i += 1) {
    const v = values[i] ?? 0
    const left = Math.min(values[i - 1] ?? v, values[i - 2] ?? v)
    const right = Math.min(values[i + 1] ?? v, values[i + 2] ?? v)
    const leftH = Math.max(values[i - 1] ?? v, values[i - 2] ?? v)
    const rightH = Math.max(values[i + 1] ?? v, values[i + 2] ?? v)
    if (kind === "LOW") {
      if (v <= left && v <= right) idxs.push(i)
    } else {
      if (v >= leftH && v >= rightH) idxs.push(i)
    }
  }
  if (idxs.length < 2) return null
  return [idxs[idxs.length - 2] ?? 0, idxs[idxs.length - 1] ?? 0]
}

function buildMacdSeries(closes: number[], fast: number, slow: number): number[] {
  const fastEma: number[] = []
  const slowEma: number[] = []

  let fastVal = closes[0] ?? 0
  let slowVal = closes[0] ?? 0
  const kFast = 2 / (fast + 1)
  const kSlow = 2 / (slow + 1)

  for (let i = 0; i < closes.length; i += 1) {
    const v = closes[i] ?? 0
    fastVal = v * kFast + fastVal * (1 - kFast)
    slowVal = v * kSlow + slowVal * (1 - kSlow)
    fastEma.push(fastVal)
    slowEma.push(slowVal)
  }

  return fastEma.map((x, i) => x - (slowEma[i] ?? 0))
}
