import type { Candle, TradeSide } from "@/types/bot"
import type { FVG, OrderBlock } from "@/lib/smc"

export type SLCalculation = {
  method: string
  price: number
  distance: number
  distancePercent: number
  quality: "TIGHT" | "NORMAL" | "WIDE"
}

export type TPLevels =
  | { valid: false; reason: string }
  | {
      valid: true
      tp1: { price: number; sizePercent: number; rr: number }
      tp2: { price: number; sizePercent: number; rr: number }
      tp3: { price: number; sizePercent: number; rr: number }
      primaryTP: number
      liqTarget?: number
      method: string
    }

export type LiquidationData = {
  nearestLongMagnet?: number
  nearestShortMagnet?: number
}

export type SMCData = {
  orderBlocks: OrderBlock[]
  fvgs: FVG[]
}

export function calculateAdaptiveSL(
  candles: Candle[],
  direction: TradeSide,
  entryPrice: number,
  smcData: SMCData
): SLCalculation {
  const atr = calculateATR(candles, 14)

  const atrSL = direction === "LONG" ? entryPrice - atr * 1.5 : entryPrice + atr * 1.5

  const swing = findSwingPoints(candles, 10)
  const structureSL =
    direction === "LONG"
      ? Math.max(...swing.lows.slice(-3).filter((l) => l < entryPrice), entryPrice - atr * 1.5) - atr * 0.3
      : Math.min(...swing.highs.slice(-3).filter((h) => h > entryPrice), entryPrice + atr * 1.5) + atr * 0.3

  const obSL = (() => {
    if (direction === "LONG") {
      const ob = smcData.orderBlocks
        .filter((ob) => ob.type === "DEMAND" && ob.high < entryPrice)
        .sort((a, b) => b.high - a.high)[0]
      return ob ? ob.low - atr * 0.2 : null
    }
    const ob = smcData.orderBlocks
      .filter((ob) => ob.type === "SUPPLY" && ob.low > entryPrice)
      .sort((a, b) => a.low - b.low)[0]
    return ob ? ob.high + atr * 0.2 : null
  })()

  const fib = fibRange(candles.slice(-50))
  const fibSL = direction === "LONG" ? entryPrice - fib.range * 0.236 : entryPrice + fib.range * 0.236

  const maxLossPercent = 0.023
  const maxSLDistance = entryPrice * maxLossPercent
  const allSLs = [atrSL, structureSL, obSL, fibSL].filter((x): x is number => typeof x === "number" && Number.isFinite(x))

  const valid = allSLs.filter((sl) =>
    direction === "LONG" ? entryPrice - sl <= maxSLDistance : sl - entryPrice <= maxSLDistance
  )

  const bestSL =
    valid.length > 0
      ? direction === "LONG"
        ? Math.max(...valid)
        : Math.min(...valid)
      : null

  const finalSL =
    bestSL ??
    (direction === "LONG" ? entryPrice - maxSLDistance : entryPrice + maxSLDistance)

  const distance = Math.abs(entryPrice - finalSL)
  const distancePercent = entryPrice > 0 ? (distance / entryPrice) * 100 : 0
  const quality = distancePercent < 1 ? "TIGHT" : distancePercent > 2 ? "WIDE" : "NORMAL"

  const method =
    obSL !== null && bestSL === obSL
      ? "Order Block"
      : bestSL === structureSL
        ? "Structure"
        : bestSL === atrSL
          ? "ATR"
          : "Fibonacci"

  return {
    method,
    price: round2(finalSL),
    distance,
    distancePercent,
    quality
  }
}

export function calculateAdaptiveTP(
  candles: Candle[],
  direction: TradeSide,
  entryPrice: number,
  slPrice: number,
  liquidationData: LiquidationData | undefined,
  smcData: SMCData
): TPLevels {
  const atr = calculateATR(candles, 14)
  const slDistance = Math.max(0.0000001, Math.abs(entryPrice - slPrice))

  const rr2 = direction === "LONG" ? entryPrice + slDistance * 2 : entryPrice - slDistance * 2
  const rr3 = direction === "LONG" ? entryPrice + slDistance * 3 : entryPrice - slDistance * 3

  const levels = findKeyLevels(candles, 100)
  const nextStructure =
    direction === "LONG"
      ? Math.min(...levels.filter((l) => l > entryPrice * 1.005), rr2)
      : Math.max(...levels.filter((l) => l < entryPrice * 0.995), rr2)

  const fib = fibRange(candles.slice(-50))
  const fib127 =
    direction === "LONG" ? fib.swingHigh + fib.range * 0.272 : fib.swingLow - fib.range * 0.272
  const fib162 =
    direction === "LONG" ? fib.swingHigh + fib.range * 0.618 : fib.swingLow - fib.range * 0.618

  const liqTarget = direction === "LONG" ? liquidationData?.nearestShortMagnet : liquidationData?.nearestLongMagnet

  const nearestFVG = smcData.fvgs
    .filter((fvg) => fvg.type === (direction === "LONG" ? "BEARISH" : "BULLISH"))
    .filter((fvg) => (direction === "LONG" ? fvg.bottom > entryPrice : fvg.top < entryPrice))
    .sort((a, b) => (direction === "LONG" ? a.bottom - b.bottom : b.top - a.top))[0]

  const tp1Candidates = [rr2, nextStructure].filter((x): x is number => typeof x === "number" && Number.isFinite(x))
  const tp2Candidates = [rr3, fib127, direction === "LONG" ? nearestFVG?.bottom : nearestFVG?.top].filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x)
  )
  const tp3Candidates = [fib162, liqTarget].filter((x): x is number => typeof x === "number" && Number.isFinite(x))

  const tp1 =
    direction === "LONG" ? Math.min(...tp1Candidates) : Math.max(...tp1Candidates)

  const tp2Pool = tp2Candidates.filter((t) => (direction === "LONG" ? t > tp1 : t < tp1))
  const tp2 = tp2Pool.length ? (direction === "LONG" ? Math.min(...tp2Pool) : Math.max(...tp2Pool)) : tp1

  const tp3Pool = tp3Candidates.filter((t) => (direction === "LONG" ? t > tp2 : t < tp2))
  const tp3 = tp3Pool.length ? (direction === "LONG" ? Math.min(...tp3Pool) : Math.max(...tp3Pool)) : tp2

  const tp1RR = Math.abs(tp1 - entryPrice) / slDistance
  if (tp1RR < 1.5) {
    return { valid: false, reason: `RR too low: ${tp1RR.toFixed(2)}` }
  }

  return {
    valid: true,
    tp1: { price: round2(tp1), sizePercent: 50, rr: tp1RR },
    tp2: { price: round2(tp2), sizePercent: 30, rr: Math.abs(tp2 - entryPrice) / slDistance },
    tp3: { price: round2(tp3), sizePercent: 20, rr: Math.abs(tp3 - entryPrice) / slDistance },
    primaryTP: round2(tp1),
    liqTarget: liqTarget ? round2(liqTarget) : undefined,
    method: liqTarget ? "Liquidation + Structure" : "Structure + Fibonacci"
  }
}

export type TrailingState = {
  active: boolean
  activationPrice: number
  currentStopPrice: number
  peakPrice: number
  trailDistance: number
  trailMethod: "ATR" | "PERCENT" | "STRUCTURE"
  lockInAmount: number
}

export function updateTrailingStop(opts: {
  direction: TradeSide
  entryPrice: number
  takeProfitPrice: number
  currentStopLoss: number
  currentPrice: number
  peakPrice: number
  atr: number
}): TrailingState {
  const atr = Math.max(0.0000001, opts.atr)
  const tp1Distance = Math.abs(opts.takeProfitPrice - opts.entryPrice)
  const activationDistance = tp1Distance * 0.5
  const activationPrice =
    opts.direction === "LONG" ? opts.entryPrice + activationDistance : opts.entryPrice - activationDistance

  const isActive =
    opts.direction === "LONG" ? opts.currentPrice >= activationPrice : opts.currentPrice <= activationPrice

  const peak =
    opts.direction === "LONG" ? Math.max(opts.peakPrice, opts.currentPrice) : Math.min(opts.peakPrice, opts.currentPrice)

  if (!isActive) {
    return {
      active: false,
      activationPrice,
      currentStopPrice: opts.currentStopLoss,
      peakPrice: peak,
      trailDistance: atr,
      trailMethod: "ATR",
      lockInAmount: 0
    }
  }

  const profitPercent =
    opts.direction === "LONG"
      ? ((opts.currentPrice - opts.entryPrice) / opts.entryPrice) * 100
      : ((opts.entryPrice - opts.currentPrice) / opts.entryPrice) * 100

  const profitMultiplier = Math.max(0.5, 1 - profitPercent / 20)
  const trailDistance = atr * 1.5 * profitMultiplier

  const newStop = opts.direction === "LONG" ? peak - trailDistance : peak + trailDistance

  const updatedStop =
    opts.direction === "LONG" ? Math.max(newStop, opts.currentStopLoss) : Math.min(newStop, opts.currentStopLoss)

  let minimumStop = opts.currentStopLoss
  if (profitPercent > 1) minimumStop = opts.entryPrice
  if (profitPercent > 2) minimumStop = opts.direction === "LONG" ? opts.entryPrice * 1.005 : opts.entryPrice * 0.995
  if (profitPercent > 3) minimumStop = opts.direction === "LONG" ? opts.entryPrice * 1.01 : opts.entryPrice * 0.99

  const finalStop = opts.direction === "LONG" ? Math.max(updatedStop, minimumStop) : Math.min(updatedStop, minimumStop)

  return {
    active: true,
    activationPrice,
    currentStopPrice: round2(finalStop),
    peakPrice: peak,
    trailDistance,
    trailMethod: "ATR",
    lockInAmount: finalStop - opts.entryPrice
  }
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]!.close
    const high = candles[i]!.high
    const low = candles[i]!.low
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trs.push(tr)
  }
  const slice = trs.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function findSwingPoints(candles: Candle[], lookback: number): { highs: number[]; lows: number[] } {
  const highs: number[] = []
  const lows: number[] = []
  const list = candles.slice(-Math.max(lookback * 6, 30))
  for (let i = 1; i < list.length - 1; i += 1) {
    const c = list[i]!
    if (c.high > list[i - 1]!.high && c.high > list[i + 1]!.high) highs.push(c.high)
    if (c.low < list[i - 1]!.low && c.low < list[i + 1]!.low) lows.push(c.low)
  }
  return { highs, lows }
}

function findKeyLevels(candles: Candle[], lookback: number): number[] {
  const list = candles.slice(-lookback)
  if (list.length < 10) return []
  const out: number[] = []
  for (let i = 2; i < list.length - 2; i += 1) {
    const c = list[i]!
    const prev2 = list[i - 2]!
    const prev1 = list[i - 1]!
    const next1 = list[i + 1]!
    const next2 = list[i + 2]!
    const isHigh = c.high > prev2.high && c.high > prev1.high && c.high > next1.high && c.high > next2.high
    const isLow = c.low < prev2.low && c.low < prev1.low && c.low < next1.low && c.low < next2.low
    if (isHigh) out.push(c.high)
    if (isLow) out.push(c.low)
  }
  return dedupeLevels(out, candles[candles.length - 1]?.close ?? 0)
}

function dedupeLevels(levels: number[], refPrice: number): number[] {
  const sorted = levels.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const out: number[] = []
  for (const l of sorted) {
    const prev = out[out.length - 1]
    if (prev === undefined) {
      out.push(l)
      continue
    }
    const pct = refPrice > 0 ? Math.abs(l - prev) / refPrice : 1
    if (pct > 0.002) out.push(l)
  }
  return out
}

function fibRange(candles: Candle[]): { swingHigh: number; swingLow: number; range: number } {
  const swingHigh = Math.max(...candles.map((c) => c.high))
  const swingLow = Math.min(...candles.map((c) => c.low))
  return { swingHigh, swingLow, range: Math.max(0, swingHigh - swingLow) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

