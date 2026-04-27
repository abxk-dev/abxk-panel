import type { Candle } from "@/types/bot"
import type { VolumeData } from "@/lib/scalping3/types"

export function analyzeVolume(candles: Candle[], smcDirection: "LONG" | "SHORT" | "NONE"): VolumeData {
  if (candles.length < 25) {
    return {
      currentVolume: 0,
      avgVolume: 0,
      volumeRatio: 0,
      volumeScore: 0,
      isSurge: false,
      surgeLevel: "NORMAL",
      volumeTrend: "STABLE",
      deltaVolume: 0,
      deltaPositive: false,
      confirmed: false
    }
  }

  const last = candles[candles.length - 1]!
  const prev3 = candles.slice(-4, -1)
  const last20 = candles.slice(-21, -1)

  const avgVolume =
    last20.reduce((s, c) => s + (Number.isFinite(c.volume) ? c.volume : 0), 0) / Math.max(1, last20.length)

  const currentVolume = Number.isFinite(last.volume) ? last.volume : 0
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 0

  const surgeLevel: VolumeData["surgeLevel"] =
    volumeRatio >= 5 ? "EXTREME" : volumeRatio >= 3 ? "SURGE" : volumeRatio >= 1.5 ? "ELEVATED" : "NORMAL"

  const volTrend = prev3.map((c) => (Number.isFinite(c.volume) ? c.volume : 0))
  const volumeTrend: VolumeData["volumeTrend"] =
    volTrend.length === 3 && volTrend[2]! > volTrend[1]! && volTrend[1]! > volTrend[0]!
      ? "INCREASING"
      : volTrend.length === 3 && volTrend[2]! < volTrend[1]! && volTrend[1]! < volTrend[0]!
        ? "DECREASING"
        : "STABLE"

  const isBullCandle = last.close > last.open
  const range = Math.max(1e-12, last.high - last.low)
  const bodyPercent = Math.abs(last.close - last.open) / range
  const deltaVolume = isBullCandle ? currentVolume * bodyPercent : -currentVolume * bodyPercent
  const deltaPositive = deltaVolume > 0

  const confirmed =
    volumeRatio >= 1.5 &&
    (smcDirection === "LONG" ? deltaPositive : true) &&
    (smcDirection === "SHORT" ? !deltaPositive : true)

  const volumeScore =
    (volumeRatio >= 5 ? 40 : volumeRatio >= 3 ? 30 : volumeRatio >= 2 ? 20 : volumeRatio >= 1.5 ? 10 : 0) +
    (volumeTrend === "INCREASING" ? 15 : 0) +
    (confirmed ? 20 : 0) +
    (surgeLevel !== "NORMAL" ? 10 : 0)

  return {
    currentVolume,
    avgVolume,
    volumeRatio,
    volumeScore,
    isSurge: volumeRatio >= 1.5,
    surgeLevel,
    volumeTrend,
    deltaVolume,
    deltaPositive,
    confirmed
  }
}
