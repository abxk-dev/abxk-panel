import type { Candle, ExecutionMode, Timeframe, TradeSide } from "@/types/bot"
import { SCALP_COINS } from "@/lib/scalpEngine"

export const BREAKOUT_COINS = SCALP_COINS

export type ConsolidationStrength = "TIGHT" | "NORMAL" | "WIDE"

export type ConsolidationZone = {
  symbol: string
  timeframe: Timeframe
  highPrice: number
  lowPrice: number
  rangePercent: number
  candleCount: number
  avgVolume: number
  startTime: number
  endTime: number
  strength: ConsolidationStrength
}

export type BreakoutType = "BULLISH" | "BEARISH"
export type BreakoutStrength = "NORMAL" | "STRONG" | "EXPLOSIVE"

export type BreakoutSignal = {
  symbol: string
  timeframe: Timeframe
  type: BreakoutType
  breakoutPrice: number
  resistanceLevel?: number
  supportLevel?: number
  volumeRatio: number
  breakoutPercent: number
  strength: BreakoutStrength
  detectedAt: number
  zone: ConsolidationZone
}

export type BreakoutDetectionSettings = {
  consolidationCandles: number
  maxRangePct: number
  volumeConfirm: number
  minBreakoutPct: number
}

export type BreakoutTradeSettings = {
  tpMultiplier: number
  slMode: "inside"
  leverage: number
  marginUsd: number
}

export type BreakoutModuleSettings = {
  coins: string[]
  timeframe: Timeframe
  mode: ExecutionMode
  detection: BreakoutDetectionSettings
  trade: BreakoutTradeSettings
}

export const DEFAULT_BREAKOUT_SETTINGS: BreakoutModuleSettings = {
  coins: [...BREAKOUT_COINS],
  timeframe: "1h",
  mode: "paper",
  detection: {
    consolidationCandles: 10,
    maxRangePct: 2,
    volumeConfirm: 2.5,
    minBreakoutPct: 0.5
  },
  trade: {
    tpMultiplier: 3,
    slMode: "inside",
    leverage: 15,
    marginUsd: 20
  }
}

export function detectConsolidation(opts: {
  symbol: string
  timeframe: Timeframe
  candles: Candle[]
  lookback?: number
  maxRangePct?: number
}): ConsolidationZone | null {
  const lookback = clampInt(opts.lookback ?? 10, 3, 200)
  const maxRangePct = clampNumber(opts.maxRangePct ?? 2, 0.1, 20)

  const candles = opts.candles
  if (candles.length < lookback) return null

  const recent = candles.slice(-lookback)
  const high = Math.max(...recent.map((c) => c.high))
  const low = Math.min(...recent.map((c) => c.low))
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null

  const rangePercent = ((high - low) / low) * 100
  if (!Number.isFinite(rangePercent)) return null
  if (rangePercent > maxRangePct) return null

  const avgVolume = recent.reduce((s, c) => s + c.volume, 0) / recent.length
  const startTime = recent[0]?.openTime ?? 0
  const endTime = recent[recent.length - 1]?.openTime ?? startTime
  const strength: ConsolidationStrength = rangePercent < 1 ? "TIGHT" : rangePercent < 2 ? "NORMAL" : "WIDE"

  return {
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    highPrice: high,
    lowPrice: low,
    rangePercent,
    candleCount: recent.length,
    avgVolume: Number.isFinite(avgVolume) ? avgVolume : 0,
    startTime,
    endTime,
    strength
  }
}

export function detectBreakout(opts: {
  candles: Candle[]
  zone: ConsolidationZone
  volumeConfirm?: number
  minBreakoutPct?: number
}): BreakoutSignal | null {
  const volumeConfirm = clampNumber(opts.volumeConfirm ?? 2.5, 1, 50)
  const minBreakoutPct = clampNumber(opts.minBreakoutPct ?? 0.5, 0.01, 20)

  const candles = opts.candles
  if (!candles.length) return null
  const last = candles[candles.length - 1]
  if (!last) return null

  const currentVolume = Number(last.volume)
  const avgVol = opts.zone.avgVolume
  const volumeRatio = avgVol > 0 ? currentVolume / avgVol : 0
  if (!Number.isFinite(volumeRatio) || volumeRatio < volumeConfirm) return null

  const abovePct = ((last.close - opts.zone.highPrice) / opts.zone.highPrice) * 100
  const belowPct = ((opts.zone.lowPrice - last.close) / opts.zone.lowPrice) * 100

  const strength: BreakoutStrength = volumeRatio > 4 ? "EXPLOSIVE" : volumeRatio >= volumeConfirm ? "STRONG" : "NORMAL"

  if (last.close > opts.zone.highPrice && abovePct >= minBreakoutPct) {
    return {
      symbol: opts.zone.symbol,
      timeframe: opts.zone.timeframe,
      type: "BULLISH",
      breakoutPrice: last.close,
      resistanceLevel: opts.zone.highPrice,
      volumeRatio,
      breakoutPercent: abovePct,
      strength,
      detectedAt: Date.now(),
      zone: opts.zone
    }
  }

  if (last.close < opts.zone.lowPrice && belowPct >= minBreakoutPct) {
    return {
      symbol: opts.zone.symbol,
      timeframe: opts.zone.timeframe,
      type: "BEARISH",
      breakoutPrice: last.close,
      supportLevel: opts.zone.lowPrice,
      volumeRatio,
      breakoutPercent: belowPct,
      strength,
      detectedAt: Date.now(),
      zone: opts.zone
    }
  }

  return null
}

export function calculateBreakoutLevels(opts: {
  breakout: BreakoutSignal
  tpMultiplier?: number
  slMode?: "inside"
}): { entry: number; tp1: number; tp2: number; sl: number; rr: number; side: TradeSide } {
  const tpMultiplier = clampNumber(opts.tpMultiplier ?? 3, 0.5, 20)
  const zone = opts.breakout.zone
  const zoneSize = zone.highPrice - zone.lowPrice
  const side: TradeSide = opts.breakout.type === "BULLISH" ? "LONG" : "SHORT"

  const entry = opts.breakout.breakoutPrice
  const tp1 = side === "LONG" ? entry + zoneSize * tpMultiplier : entry - zoneSize * tpMultiplier
  const tp2 = side === "LONG" ? entry + zoneSize * tpMultiplier * 2 : entry - zoneSize * tpMultiplier * 2
  const sl = side === "LONG" ? zone.lowPrice * 0.999 : zone.highPrice * 1.001

  const risk = Math.abs(entry - sl)
  const reward = Math.abs(tp1 - entry)
  const rr = risk > 0 ? reward / risk : 0

  return { entry, tp1, tp2, sl, rr, side }
}

export function confirmBreakoutWithCandle(opts: {
  breakout: BreakoutSignal
  zone: ConsolidationZone
  confirmCandle: Candle
}): boolean {
  const c = opts.confirmCandle
  if (!c) return false

  if (opts.breakout.type === "BULLISH") {
    return c.close > opts.zone.highPrice && c.low > opts.zone.lowPrice
  }
  return c.close < opts.zone.lowPrice && c.high < opts.zone.highPrice
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

