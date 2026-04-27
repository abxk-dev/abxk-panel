import type { Candle } from "@/types/bot"
import { detectBOS, detectFairValueGaps, detectLiquiditySweeps, detectOrderBlocks } from "@/lib/smc"
import type { FVG, LiquiditySweep, OrderBlock, SMCData } from "@/lib/scalping3/types"

export function analyzeSMC(candlesEntry: Candle[], candlesConfirm: Candle[], candlesBias: Candle[]): SMCData {
  const currentPrice = candlesEntry[candlesEntry.length - 1]?.close ?? 0

  const obs = detectOrderBlocks(candlesEntry, "ENTRY")
  const fvgs = detectFairValueGaps(candlesEntry).filter((f) => !f.filled)
  const bos = detectBOS(candlesConfirm)
  const sweeps = detectLiquiditySweeps(candlesEntry)
  const bos1h = detectBOS(candlesBias)

  const demand = obs.filter((o) => o.type === "DEMAND")
  const supply = obs.filter((o) => o.type === "SUPPLY")

  const nearestDemand = demand
    .filter((ob) => ob.high < currentPrice)
    .sort((a, b) => b.high - a.high)[0]
  const nearestSupply = supply
    .filter((ob) => ob.low > currentPrice)
    .sort((a, b) => a.low - b.low)[0]

  const demandOB: OrderBlock | null = nearestDemand
    ? {
        high: nearestDemand.high,
        low: nearestDemand.low,
        mid: nearestDemand.mid,
        strength: nearestDemand.strength,
        tested: nearestDemand.tested,
        valid: nearestDemand.valid
      }
    : null

  const supplyOB: OrderBlock | null = nearestSupply
    ? {
        high: nearestSupply.high,
        low: nearestSupply.low,
        mid: nearestSupply.mid,
        strength: nearestSupply.strength,
        tested: nearestSupply.tested,
        valid: nearestSupply.valid
      }
    : null

  const atDemandOB =
    demandOB !== null && currentPrice >= demandOB.low * 0.999 && currentPrice <= demandOB.high * 1.001
  const atSupplyOB =
    supplyOB !== null && currentPrice >= supplyOB.low * 0.999 && currentPrice <= supplyOB.high * 1.001

  const bullishFvg = fvgs
    .filter((f) => f.type === "BULLISH" && f.top < currentPrice)
    .sort((a, b) => b.top - a.top)[0]
  const bearishFvg = fvgs
    .filter((f) => f.type === "BEARISH" && f.bottom > currentPrice)
    .sort((a, b) => a.bottom - b.bottom)[0]

  const bullishFVG: FVG | null = bullishFvg
    ? { top: bullishFvg.top, bottom: bullishFvg.bottom, mid: (bullishFvg.top + bullishFvg.bottom) / 2, size: bullishFvg.strength, filled: false }
    : null
  const bearishFVG: FVG | null = bearishFvg
    ? { top: bearishFvg.top, bottom: bearishFvg.bottom, mid: (bearishFvg.top + bearishFvg.bottom) / 2, size: bearishFvg.strength, filled: false }
    : null

  const atBullFVG = bullishFVG ? currentPrice >= bullishFVG.bottom && currentPrice <= bullishFVG.top : false
  const atBearFVG = bearishFVG ? currentPrice >= bearishFVG.bottom && currentPrice <= bearishFVG.top : false

  const lastBias = candlesBias[candlesBias.length - 1]
  const biasFallback = lastBias ? (lastBias.close >= lastBias.open ? "BULLISH" : "BEARISH") : "BULLISH"
  const htfBias = bos1h.direction !== "NONE" ? bos1h.direction : biasFallback

  const sweep = pickSweep(sweeps, currentPrice)

  let longScore = 0
  if (atDemandOB) longScore += 35
  if (atBullFVG) longScore += 20
  if (bos.direction === "BULLISH") longScore += 25
  if (sweep.type === "LOW") longScore += 20
  if (htfBias === "BULLISH") longScore += 15
  if (demandOB?.strength === "STRONG") longScore += 10

  let shortScore = 0
  if (atSupplyOB) shortScore += 35
  if (atBearFVG) shortScore += 20
  if (bos.direction === "BEARISH") shortScore += 25
  if (sweep.type === "HIGH") shortScore += 20
  if (htfBias === "BEARISH") shortScore += 15
  if (supplyOB?.strength === "STRONG") shortScore += 10

  let smcScore = 0
  let entryDirection: "LONG" | "SHORT" | "NONE" = "NONE"
  if (longScore > shortScore && longScore >= 55) {
    smcScore = longScore
    entryDirection = "LONG"
  } else if (shortScore > longScore && shortScore >= 55) {
    smcScore = shortScore
    entryDirection = "SHORT"
  }

  const smcBias = entryDirection === "LONG" ? "BULLISH" : entryDirection === "SHORT" ? "BEARISH" : "NEUTRAL"

  return {
    demandOB,
    supplyOB,
    atOBZone: Boolean(atDemandOB || atSupplyOB),
    obType: atDemandOB ? "DEMAND" : atSupplyOB ? "SUPPLY" : "NONE",
    bullishFVG,
    bearishFVG,
    atFVGZone: Boolean(atBullFVG || atBearFVG),
    bos: { direction: bos.direction, level: bos.level, confirmed: bos.direction !== "NONE", strength: bos.strength },
    bosDirection: bos.direction,
    bosConfirmed: bos.direction !== "NONE",
    liquidityAbove: sweep.liquidityAbove,
    liquidityBelow: sweep.liquidityBelow,
    sweepDetected: sweep.detected,
    sweepType: sweep.type,
    smcBias,
    smcScore,
    entryValid: smcScore >= 55,
    entryDirection
  }
}

function pickSweep(sweeps: ReturnType<typeof detectLiquiditySweeps>, currentPrice: number): LiquiditySweep {
  const last20 = sweeps.length ? sweeps : []
  const above = Math.max(...last20.map((s) => s.level), currentPrice)
  const below = Math.min(...last20.map((s) => s.level), currentPrice)
  const high = sweeps.find((s) => s.type === "STOP_HUNT_HIGH" && s.reversalConfirmed)
  const low = sweeps.find((s) => s.type === "STOP_HUNT_LOW" && s.reversalConfirmed)
  if (high) {
    return { detected: true, type: "HIGH", level: high.level, liquidityAbove: above, liquidityBelow: below }
  }
  if (low) {
    return { detected: true, type: "LOW", level: low.level, liquidityAbove: above, liquidityBelow: below }
  }
  return { detected: false, type: "NONE", level: 0, liquidityAbove: above, liquidityBelow: below }
}
