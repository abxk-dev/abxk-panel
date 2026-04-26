import type { Candle, TradeSide } from "@/types/bot"

export type OrderBlock = {
  type: "DEMAND" | "SUPPLY"
  high: number
  low: number
  mid: number
  strength: "STRONG" | "MODERATE" | "WEAK"
  timeframe: string
  tested: boolean
  valid: boolean
}

export type FVG = {
  type: "BULLISH" | "BEARISH"
  top: number
  bottom: number
  filled: boolean
  strength: number
}

export type LiquiditySweep = {
  type: "STOP_HUNT_HIGH" | "STOP_HUNT_LOW"
  level: number
  sweepCandle: number
  reversalConfirmed: boolean
  strength: "STRONG" | "WEAK"
}

export type BosResult = {
  direction: "BULLISH" | "BEARISH" | "NONE"
  level: number
  strength: number
}

export type SmcScore = {
  scoreDelta: number
  blocked: boolean
  blockReason?: string
  summary: string
  orderBlocks: OrderBlock[]
  fvgs: FVG[]
  sweeps: LiquiditySweep[]
  bos: BosResult
  insideOrderBlock: boolean
}

export function detectOrderBlocks(candles: Candle[], timeframe = "4H"): OrderBlock[] {
  const orderBlocks: OrderBlock[] = []
  for (let i = 1; i < candles.length - 4; i += 1) {
    const curr = candles[i]
    if (!curr) continue

    const currBody = Math.abs(curr.close - curr.open)
    const next3 = candles.slice(i + 1, i + 4)
    if (next3.length < 3) continue

    const nextMoveUp = next3.reduce((max, c) => Math.max(max, c.high - curr.low), 0)
    if (curr.close < curr.open && nextMoveUp > currBody * 2) {
      const movePercent = curr.low > 0 ? (nextMoveUp / curr.low) * 100 : 0
      orderBlocks.push({
        type: "DEMAND",
        high: curr.open,
        low: curr.low,
        mid: (curr.open + curr.low) / 2,
        strength: movePercent > 3 ? "STRONG" : movePercent > 1.5 ? "MODERATE" : "WEAK",
        timeframe,
        tested: false,
        valid: true
      })
      continue
    }

    const nextMoveDown = curr.high - Math.min(...next3.map((c) => c.low))
    if (curr.close > curr.open && next3.some((c) => c.low < curr.high - currBody * 2)) {
      const movePercent = curr.high > 0 ? (nextMoveDown / curr.high) * 100 : 0
      orderBlocks.push({
        type: "SUPPLY",
        high: curr.high,
        low: curr.close,
        mid: (curr.high + curr.close) / 2,
        strength: movePercent > 3 ? "STRONG" : movePercent > 1.5 ? "MODERATE" : "WEAK",
        timeframe,
        tested: false,
        valid: true
      })
    }
  }

  const latest = candles[candles.length - 1]
  if (!latest) return []

  return orderBlocks.filter((ob) => {
    if (ob.type === "DEMAND" && latest.close < ob.low) ob.valid = false
    if (ob.type === "SUPPLY" && latest.close > ob.high) ob.valid = false
    return ob.valid
  })
}

export function detectFairValueGaps(candles: Candle[]): FVG[] {
  const fvgs: FVG[] = []
  for (let i = 1; i < candles.length - 1; i += 1) {
    const c1 = candles[i - 1]
    const c2 = candles[i]
    const c3 = candles[i + 1]
    if (!c1 || !c2 || !c3) continue

    if (c1.high < c3.low && c2.close > c2.open) {
      const gapSize = c2.close > 0 ? ((c3.low - c1.high) / c2.close) * 100 : 0
      if (gapSize > 0.1) {
        fvgs.push({ type: "BULLISH", top: c3.low, bottom: c1.high, filled: false, strength: gapSize })
      }
    }

    if (c1.low > c3.high && c2.close < c2.open) {
      const gapSize = c2.close !== 0 ? ((c1.low - c3.high) / Math.abs(c2.close)) * 100 : 0
      if (gapSize > 0.1) {
        fvgs.push({ type: "BEARISH", top: c1.low, bottom: c3.high, filled: false, strength: gapSize })
      }
    }
  }

  const latestPrice = candles[candles.length - 1]?.close ?? 0
  return fvgs.map((fvg) => ({ ...fvg, filled: latestPrice >= fvg.bottom && latestPrice <= fvg.top }))
}

export function detectLiquiditySweeps(candles: Candle[]): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = []
  const last20 = candles.slice(-20)
  if (last20.length < 5) return []

  const recentHigh = Math.max(...last20.map((c) => c.high))
  const recentLow = Math.min(...last20.map((c) => c.low))
  const lastCandle = candles[candles.length - 1]
  const prevCandle = candles[candles.length - 2]
  if (!lastCandle || !prevCandle) return []

  if (lastCandle.high > recentHigh && lastCandle.close < recentHigh) {
    sweeps.push({
      type: "STOP_HUNT_HIGH",
      level: recentHigh,
      sweepCandle: lastCandle.openTime,
      reversalConfirmed: lastCandle.close < prevCandle.low,
      strength: (lastCandle.high - lastCandle.close) / Math.max(0.0000001, lastCandle.close) > 0.005 ? "STRONG" : "WEAK"
    })
  }

  if (lastCandle.low < recentLow && lastCandle.close > recentLow) {
    sweeps.push({
      type: "STOP_HUNT_LOW",
      level: recentLow,
      sweepCandle: lastCandle.openTime,
      reversalConfirmed: lastCandle.close > prevCandle.high,
      strength: (lastCandle.close - lastCandle.low) / Math.max(0.0000001, lastCandle.close) > 0.005 ? "STRONG" : "WEAK"
    })
  }

  return sweeps
}

export function detectBOS(candles: Candle[]): BosResult {
  const last20 = candles.slice(-20)
  if (last20.length < 6) return { direction: "NONE", level: 0, strength: 0 }

  const swingHighs = last20.filter((c, i) => i > 0 && i < last20.length - 1 && c.high > last20[i - 1]!.high && c.high > last20[i + 1]!.high)
  const swingLows = last20.filter((c, i) => i > 0 && i < last20.length - 1 && c.low < last20[i - 1]!.low && c.low < last20[i + 1]!.low)

  const lastCandle = candles[candles.length - 1]
  const lastSwingHigh = swingHighs[swingHighs.length - 1]
  const lastSwingLow = swingLows[swingLows.length - 1]
  if (!lastCandle) return { direction: "NONE", level: 0, strength: 0 }

  if (lastSwingHigh && lastCandle.close > lastSwingHigh.high) {
    return {
      direction: "BULLISH",
      level: lastSwingHigh.high,
      strength: lastSwingHigh.high > 0 ? ((lastCandle.close - lastSwingHigh.high) / lastSwingHigh.high) * 100 : 0
    }
  }

  if (lastSwingLow && lastCandle.close < lastSwingLow.low) {
    return {
      direction: "BEARISH",
      level: lastSwingLow.low,
      strength: lastSwingLow.low > 0 ? ((lastSwingLow.low - lastCandle.close) / lastSwingLow.low) * 100 : 0
    }
  }

  return { direction: "NONE", level: 0, strength: 0 }
}

export function scoreSmc(candles: Candle[], side: TradeSide, timeframe = "4H"): SmcScore {
  const last = candles[candles.length - 1]
  const price = last?.close ?? 0

  const orderBlocks = detectOrderBlocks(candles, timeframe)
  const fvgs = detectFairValueGaps(candles).filter((f) => !f.filled)
  const sweeps = detectLiquiditySweeps(candles)
  const bos = detectBOS(candles)

  let scoreDelta = 0
  let blocked = false
  let blockReason: string | undefined

  const demand = orderBlocks.filter((o) => o.type === "DEMAND")
  const supply = orderBlocks.filter((o) => o.type === "SUPPLY")

  const near = (a: number, b: number, pct: number) => (b > 0 ? Math.abs(a - b) / b <= pct / 100 : false)
  const strongestDemand = demand.sort((a, b) => strengthRank(b.strength) - strengthRank(a.strength))[0]
  const strongestSupply = supply.sort((a, b) => strengthRank(b.strength) - strengthRank(a.strength))[0]

  const insideOrderBlock =
    (strongestDemand && price >= strongestDemand.low && price <= strongestDemand.high) ||
    (strongestSupply && price >= strongestSupply.low && price <= strongestSupply.high)

  if (strongestDemand && side === "LONG" && (insideOrderBlock || near(price, strongestDemand.mid, 0.4))) scoreDelta += 25
  if (strongestSupply && side === "SHORT" && (insideOrderBlock || near(price, strongestSupply.mid, 0.4))) scoreDelta += 25

  const bullishFvg = fvgs.filter((f) => f.type === "BULLISH" && f.bottom <= price).sort((a, b) => b.strength - a.strength)[0]
  if (bullishFvg && side === "LONG") scoreDelta += 15

  const sweep = sweeps.find((s) => s.reversalConfirmed && (s.type === "STOP_HUNT_LOW" || s.type === "STOP_HUNT_HIGH"))
  if (sweep?.reversalConfirmed) scoreDelta += 20

  if (bos.direction === "BULLISH" && side === "LONG") scoreDelta += 15
  if (bos.direction === "BEARISH" && side === "SHORT") scoreDelta += 15
  if (bos.direction === "BULLISH" && side === "SHORT") {
    blocked = true
    blockReason = `BOS against trade direction at ${bos.level.toFixed(0)}`
  }
  if (bos.direction === "BEARISH" && side === "LONG") {
    blocked = true
    blockReason = `BOS against trade direction at ${bos.level.toFixed(0)}`
  }

  const obLine =
    side === "LONG" && strongestDemand
      ? `Order Block: DEMAND at $${strongestDemand.low.toFixed(0)}-$${strongestDemand.high.toFixed(0)}`
      : side === "SHORT" && strongestSupply
        ? `Order Block: SUPPLY at $${strongestSupply.low.toFixed(0)}-$${strongestSupply.high.toFixed(0)}`
        : "Order Block: —"

  const fvgLine = bullishFvg ? `FVG: Bullish gap at $${bullishFvg.bottom.toFixed(0)}-$${bullishFvg.top.toFixed(0)}` : "FVG: —"
  const sweepLine = sweep ? `Liquidity Sweep: ${sweep.type === "STOP_HUNT_LOW" ? "Low swept" : "High swept"} at $${sweep.level.toFixed(0)}` : "Liquidity Sweep: —"
  const bosLine = bos.direction !== "NONE" ? `BOS: ${bos.direction} break at $${bos.level.toFixed(0)}` : "BOS: —"
  const insideLine = insideOrderBlock ? `Current price at: $${price.toFixed(0)} (inside OB) ✅` : `Current price at: $${price.toFixed(0)}`

  const summary = `🏦 <b>SMC ANALYSIS</b>
━━━━━━━━━━━━━━
${obLine} ${side === "LONG" || side === "SHORT" ? "✅" : ""}
${fvgLine} ${bullishFvg ? "✅" : ""}
${sweepLine} ${sweep ? "✅" : ""}
${bosLine} ${bos.direction !== "NONE" ? "✅" : ""}
${insideLine}

🎯 SMC Score: ${scoreDelta >= 0 ? "+" : ""}${scoreDelta} pts`

  return { scoreDelta, blocked, blockReason, summary, orderBlocks, fvgs, sweeps, bos, insideOrderBlock }
}

function strengthRank(s: OrderBlock["strength"]): number {
  if (s === "STRONG") return 3
  if (s === "MODERATE") return 2
  return 1
}

