import type { Candle } from "@/types/bot"

export type Scalping3Timeframe = "1m" | "3m" | "5m" | "15m"
export type Scalping3Mode = "paper" | "live" | "mirror"

export type Scalping3Settings = {
  enabled: boolean
  paused: boolean
  mode: Scalping3Mode
  timeframe: Scalping3Timeframe
  minSmcScore: number
  minVolumeRatio: number
  marginPerTrade: number
  leverage: number
  minRR: number
  useGlobalTargets: boolean
  globalSlPct: number
  globalTp1Pct: number
  globalTp2Pct: number
  maxPerDay: number
  enabledSymbols: string[]
}

export type Bos = {
  direction: "BULLISH" | "BEARISH" | "NONE"
  level: number
  confirmed: boolean
  strength: number
}

export type OrderBlock = {
  high: number
  low: number
  mid: number
  index?: number
  strength: "STRONG" | "MODERATE" | "WEAK" | "NONE"
  tested: boolean
  valid: boolean
  timestamp?: number
}

export type FVG = {
  top: number
  bottom: number
  mid: number
  size: number
  filled: boolean
  timestamp?: number
}

export type LiquiditySweep = {
  detected: boolean
  type: "HIGH" | "LOW" | "NONE"
  level: number
  liquidityAbove: number
  liquidityBelow: number
}

export type SMCData = {
  demandOB: OrderBlock | null
  supplyOB: OrderBlock | null
  atOBZone: boolean
  obType: "DEMAND" | "SUPPLY" | "NONE"
  bullishFVG: FVG | null
  bearishFVG: FVG | null
  atFVGZone: boolean
  bos: Bos
  bosDirection: "BULLISH" | "BEARISH" | "NONE"
  bosConfirmed: boolean
  liquidityAbove: number
  liquidityBelow: number
  sweepDetected: boolean
  sweepType: "HIGH" | "LOW" | "NONE"
  smcBias: "BULLISH" | "BEARISH" | "NEUTRAL"
  smcScore: number
  entryValid: boolean
  entryDirection: "LONG" | "SHORT" | "NONE"
}

export type VolumeData = {
  currentVolume: number
  avgVolume: number
  volumeRatio: number
  volumeScore: number
  isSurge: boolean
  surgeLevel: "NORMAL" | "ELEVATED" | "SURGE" | "EXTREME"
  volumeTrend: "INCREASING" | "DECREASING" | "STABLE"
  deltaVolume: number
  deltaPositive: boolean
  confirmed: boolean
}

export type SessionData = {
  currentSession: string
  sessionScore: number
  isOptimal: boolean
  allowTrade: boolean
  nextOptimalTime: string
  reason: string
}

export type Scalping3Signal = {
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  tpPrice: number
  slPrice: number
  rr: number
  smcScore: number
  volumeScore: number
  sessionScore: number
  totalScore: number
  smcData: SMCData
  volumeData: VolumeData
  sessionData: SessionData
  timestamp: number
}

export type FetchCandles = (symbol: string, interval: Scalping3Timeframe | "1h", limit: number) => Promise<Candle[]>
