import type { Candle, MarketRegime } from "@/types/bot"
import { ema, atr, bollingerBandwidthPct, sma } from "@/lib/strategy"

export type MarketRegimeSnapshot = {
  regime: MarketRegime
  adx14: number
  atr14: number
  atr14Avg14: number
  bbWidthPct: number
  bbWidthPctP20_100: number
  ema20: number
  ema50: number
  ema200: number
  lastClose: number
  lastBody: number
  volatileMode: "SKIP" | "REDUCE_50" | "NONE"
}

export function detectMarketRegime(candles: Candle[]): MarketRegimeSnapshot {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)

  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)

  const adx14 = adx(highs, lows, closes, 14)
  const atr14 = atr(highs, lows, closes, 14)
  const atrSeries = atrSeries14(highs, lows, closes, 14)
  const atr14Avg14 = sma(atrSeries.slice(-14), 14)

  const bbWidthPct = bollingerBandwidthPct(closes, 20, 2)
  const bbSeries = bollingerWidthSeriesPct(closes, 20, 2, 100)
  const bbWidthPctP20_100 = percentile(bbSeries, 20)

  const last = candles[candles.length - 1]
  const lastClose = last?.close ?? 0
  const lastBody = last ? Math.abs(last.close - last.open) : 0

  const emaBull = ema20 > ema50 && ema50 > ema200
  const emaBear = ema20 < ema50 && ema50 < ema200

  const trendingBull = adx14 > 25 && lastClose > ema200 && emaBull
  const trendingBear = adx14 > 25 && lastClose < ema200 && emaBear
  const ranging = adx14 < 20 && bbWidthPct > 0 && bbWidthPctP20_100 > 0 && bbWidthPct < bbWidthPctP20_100

  const atrMultiple = atr14Avg14 > 0 ? atr14 / atr14Avg14 : 0
  const volatile = atrMultiple > 2 || (atr14 > 0 && lastBody > 3 * atr14)

  let volatileMode: MarketRegimeSnapshot["volatileMode"] = "NONE"
  if (atrMultiple >= 3) volatileMode = "SKIP"
  else if (atrMultiple >= 2) volatileMode = "REDUCE_50"

  let regime: MarketRegime = "RANGING"
  if (trendingBull) regime = "TRENDING_BULL"
  else if (trendingBear) regime = "TRENDING_BEAR"
  else if (volatile) regime = "VOLATILE"
  else if (ranging) regime = "RANGING"

  return {
    regime,
    adx14: round2(adx14),
    atr14: round2(atr14),
    atr14Avg14: round2(atr14Avg14),
    bbWidthPct: round2(bbWidthPct),
    bbWidthPctP20_100: round2(bbWidthPctP20_100),
    ema20: round2(ema20),
    ema50: round2(ema50),
    ema200: round2(ema200),
    lastClose: round2(lastClose),
    lastBody: round2(lastBody),
    volatileMode
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function atrSeries14(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    const high = highs[i] ?? 0
    const low = lows[i] ?? 0
    const prevClose = closes[i - 1] ?? closes[i] ?? 0
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    out.push(tr)
  }
  if (out.length < period) return []
  const smooth: number[] = []
  for (let i = period - 1; i < out.length; i += 1) {
    smooth.push(sma(out.slice(i - period + 1, i + 1), period))
  }
  return smooth
}

function bollingerWidthSeriesPct(closes: number[], period: number, mult: number, limit: number): number[] {
  const out: number[] = []
  for (let i = Math.max(0, closes.length - limit); i < closes.length; i += 1) {
    const window = closes.slice(Math.max(0, i - period + 1), i + 1)
    if (window.length < period) continue
    out.push(bollingerBandwidthPct(window, period, mult))
  }
  return out
}

function percentile(values: number[], p: number): number {
  const filtered = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b)
  if (filtered.length === 0) return 0
  const rank = (p / 100) * (filtered.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const w = rank - low
  const a = filtered[low] ?? 0
  const b = filtered[high] ?? a
  return a + (b - a) * w
}

export function adx(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < period + 2) return 0

  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []

  for (let i = 1; i < highs.length; i += 1) {
    const upMove = (highs[i] ?? 0) - (highs[i - 1] ?? 0)
    const downMove = (lows[i - 1] ?? 0) - (lows[i] ?? 0)

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)

    const high = highs[i] ?? 0
    const low = lows[i] ?? 0
    const prevClose = closes[i - 1] ?? closes[i] ?? 0
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }

  const atrSmoothed = wilderSmooth(tr, period)
  const plusDMSmoothed = wilderSmooth(plusDM, period)
  const minusDMSmoothed = wilderSmooth(minusDM, period)

  const dx: number[] = []
  for (let i = 0; i < atrSmoothed.length; i += 1) {
    const atrVal = atrSmoothed[i] ?? 0
    const p = atrVal > 0 ? ((plusDMSmoothed[i] ?? 0) / atrVal) * 100 : 0
    const m = atrVal > 0 ? ((minusDMSmoothed[i] ?? 0) / atrVal) * 100 : 0
    const denom = p + m
    dx.push(denom > 0 ? (Math.abs(p - m) / denom) * 100 : 0)
  }

  const adxSeries = wilderSmooth(dx, period)
  return adxSeries[adxSeries.length - 1] ?? 0
}

function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return []
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < period; i += 1) sum += values[i] ?? 0
  let prev = sum
  out.push(prev)
  for (let i = period; i < values.length; i += 1) {
    const v = values[i] ?? 0
    prev = prev - prev / period + v
    out.push(prev)
  }
  return out
}

