import type { Candle } from "@/types/bot"
import { analyzeSMC } from "@/lib/scalping3/smcEngine"
import { checkSession } from "@/lib/scalping3/sessionFilter"
import { analyzeVolume } from "@/lib/scalping3/volumeEngine"
import type { FetchCandles, Scalping3Settings, Scalping3Signal } from "@/lib/scalping3/types"

export type Scalping3ScanSummary = {
  scanned: number
  smcValid: number
  volumeConfirmed: number
  reason: string
  nextScanMinutes: number
}

export async function runScalping3Scan(
  settings: Scalping3Settings,
  fetchCandles: FetchCandles
): Promise<{ signal: Scalping3Signal | null; summary: Scalping3ScanSummary }> {
  const session = checkSession()
  if (!session.allowTrade) {
    return {
      signal: null,
      summary: {
        scanned: settings.enabledSymbols.length,
        smcValid: 0,
        volumeConfirmed: 0,
        reason: session.reason,
        nextScanMinutes: 5
      }
    }
  }

  const results: Scalping3Signal[] = []
  let smcValid = 0
  let volumeConfirmed = 0
  let rrRejected = 0

  for (const symbol of settings.enabledSymbols) {
    const [entryCandles, confirmCandles, biasCandles] = await Promise.all([
      fetchCandles(symbol, settings.timeframe, 100),
      fetchCandles(symbol, "15m", 60),
      fetchCandles(symbol, "1h", 60)
    ])

    if (!entryCandles.length || !confirmCandles.length || !biasCandles.length) continue

    const smc = analyzeSMC(entryCandles, confirmCandles, biasCandles)
    if (!smc.entryValid || smc.smcScore < settings.minSmcScore) continue
    smcValid += 1

    const volume = analyzeVolume(entryCandles.slice(-60), smc.entryDirection)
    if (volume.volumeRatio < settings.minVolumeRatio) continue
    if (!volume.confirmed) continue
    volumeConfirmed += 1

    const currentPrice = entryCandles[entryCandles.length - 1]!.close
    const atr = calculateATR(entryCandles, 14)

    let tpPrice = 0
    let slPrice = 0

    if (smc.entryDirection === "LONG") {
      slPrice = smc.demandOB ? smc.demandOB.low * 0.998 : currentPrice - atr * 1.5
      tpPrice = smc.supplyOB ? smc.supplyOB.low * 0.999 : currentPrice + atr * 2.5
    } else if (smc.entryDirection === "SHORT") {
      slPrice = smc.supplyOB ? smc.supplyOB.high * 1.002 : currentPrice + atr * 1.5
      tpPrice = smc.demandOB ? smc.demandOB.high * 1.001 : currentPrice - atr * 2.5
    } else {
      continue
    }

    if (!Number.isFinite(tpPrice) || !Number.isFinite(slPrice) || tpPrice <= 0 || slPrice <= 0) continue

    const slDistance = Math.abs(currentPrice - slPrice)
    const tpDistance = Math.abs(tpPrice - currentPrice)
    const rr = tpDistance / Math.max(1e-12, slDistance)
    if (rr < settings.minRR) {
      rrRejected += 1
      continue
    }

    const totalScore = smc.smcScore + volume.volumeScore + session.sessionScore
    results.push({
      symbol,
      direction: smc.entryDirection,
      entryPrice: currentPrice,
      tpPrice,
      slPrice,
      rr: Number(rr.toFixed(2)),
      smcScore: smc.smcScore,
      volumeScore: volume.volumeScore,
      sessionScore: session.sessionScore,
      totalScore,
      smcData: smc,
      volumeData: volume,
      sessionData: session,
      timestamp: Date.now()
    })
  }

  const signal = results.length ? results.sort((a, b) => b.totalScore - a.totalScore)[0]! : null
  const reason =
    smcValid === 0
      ? "SMC conditions not met"
      : volumeConfirmed === 0
        ? "Volume not surging"
        : signal === null && rrRejected > 0
          ? "RR below minimum"
          : "No setup"

  return {
    signal,
    summary: {
      scanned: settings.enabledSymbols.length,
      smcValid,
      volumeConfirmed,
      reason,
      nextScanMinutes: 5
    }
  }
}

export async function runScalping3(settings: Scalping3Settings, fetchCandles: FetchCandles): Promise<Scalping3Signal | null> {
  const r = await runScalping3Scan(settings, fetchCandles)
  return r.signal
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
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length)
}
