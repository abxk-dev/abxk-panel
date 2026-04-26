import { NextResponse } from "next/server"
import type { Candle, Settings } from "@/types/bot"
import { evaluateSetup } from "@/lib/strategy"
import { bingxRequest } from "@/lib/bingx"
import { macd } from "@/lib/strategy"

export const runtime = "nodejs"

export async function GET() {
  const symbol = "BTC-USDT"
  const interval = "4h"
  const limit = 210

  const url = `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(
    limit
  )}`

  const raw = await fetch(url, { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => null)

  const candles = parseBingxV3Klines(raw)
  console.log(`[test-scanner] ${symbol} candles fetched: ${candles.length}`)

  const settings = getTestSettings()
  const fundingRate = await fetchFundingRateRaw(symbol)
  const evalRes = evaluateSetup(candles, settings, { dailyBias: "LONG", fundingRatePct: fundingRate * 100 })

  const scores = evalRes.snapshot.scores
  const breakdown = {
    ema: scores.trendEma ?? 0,
    volume: scores.volumeSpike ?? 0,
    rsi: scores.rsi ?? 0,
    macd: scores.macd ?? 0,
    atr: scores.atrVolatility ?? 0,
    session: scores.session ?? 0,
    funding: scores.fundingRate ?? 0
  }

  const last = candles[candles.length - 1]
  const lastVolumeUSDT = last ? last.volume * last.close : 0
  const recent = candles.slice(-20)
  const avgVolumeUSDT = recent.length ? recent.reduce((sum, c) => sum + c.volume * c.close, 0) / recent.length : 0
  const volumeRatio = avgVolumeUSDT > 0 ? lastVolumeUSDT / avgVolumeUSDT : 0

  const closes = candles.map((c) => c.close)
  const macdNow = macd(closes, 12, 26, 9)
  const macdPrev = macd(closes.slice(0, -1), 12, 26, 9)
  const histImproving = macdNow.histogram > macdPrev.histogram

  const utcHour = new Date().getUTCHours()
  const sessionActive = (utcHour >= 8 && utcHour < 16) || (utcHour >= 13 && utcHour < 21)
  const indicators = evalRes.snapshot.indicators as any

  return NextResponse.json({
    symbol,
    candleCount: candles.length,
    score: evalRes.snapshot.totalScore,
    breakdown,
    debug: {
      lastClose: last?.close ?? null,
      ema20: indicators?.ema20 ?? null,
      ema50: indicators?.ema50 ?? null,
      ema200: indicators?.ema200 ?? null,
      rsiValue: indicators?.rsi14 ?? null,
      macdValue: indicators?.macdLine ?? null,
      signalValue: indicators?.macdSignal ?? null,
      histValue: indicators?.macdHist ?? null,
      volumeUSDT: Number.isFinite(lastVolumeUSDT) ? Math.round(lastVolumeUSDT) : 0,
      volumeAvgUSDT: Number.isFinite(avgVolumeUSDT) ? Math.round(avgVolumeUSDT) : 0,
      volumeRatio: Number.isFinite(volumeRatio) ? Number(volumeRatio.toFixed(2)) : 0,
      macdScore: breakdown.macd,
      histPrev: macdPrev.histogram,
      histImproving,
      fundingRate: fundingRate,
      sessionActive,
      utcHour
    },
    direction: evalRes.side,
    candle_sample: last ? { close: last.close, openTime: last.openTime } : null
  })
}

async function fetchFundingRateRaw(symbol: string): Promise<number> {
  try {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (!apiKey || !secretKey) return 0
    const res = await bingxRequest<any>({
      method: "GET",
      path: "/openApi/swap/v2/quote/premiumIndex",
      params: { symbol },
      apiKey,
      secretKey
    })
    const row = res?.data ?? res
    const v = Number(row?.lastFundingRate)
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

function parseBingxV3Klines(raw: unknown): Candle[] {
  const data = raw as any
  const rows: any[] = Array.isArray(data?.data) ? data.data : []
  const out: Candle[] = []
  for (const k of rows) {
    if (!k || typeof k !== "object") continue
    const openTime = Number(k.time)
    const open = Number(k.open)
    const high = Number(k.high)
    const low = Number(k.low)
    const close = Number(k.close)
    const volume = Number(k.volume)
    if (![openTime, open, high, low, close, volume].every(Number.isFinite)) continue
    out.push({ openTime, open, high, low, close, volume })
  }
  out.sort((a, b) => a.openTime - b.openTime)
  return out
}

function getTestSettings(): Settings {
  return {
    mode: "paper",
    symbol: "BTC-USDT",
    timeframe: "4h",
    maxTradesPerDay: 1,
    minSetupScore: 75,
    filters: {
      trendEma: true,
      volumeSpike: true,
      atrVolatility: true,
      rsi: true,
      macd: true,
      bbSqueeze: true,
      fibGoldenPocket: true,
      stochRsi: true,
      macdDivergence: true,
      openInterest: false,
      liquidity: false,
      fundingRate: true,
      fundingHardBlock: false,
      session: true,
      htfDailyBias: false,
      newsBlackout: false,
      oiDivergence: false,
      fearGreed: false,
      liquidationTp: false
    },
    thresholds: {
      volumeSpikeMultiplier: 1.5,
      atrMin: 0,
      atrMax: 1_000_000,
      maxSpreadPct: 0.25,
      maxFundingRatePct: 0.06,
      fundingHardBlockPct: 0.12,
      londonNyOverlapStartUtcHour: 12,
      londonNyOverlapEndUtcHour: 16,
      bbSqueezePctOfAvg: 0.7,
      fibLookbackCandles: 120,
      newsBlackoutMinutes: 0,
      fearGreedLongOnlyBelow: 20,
      fearGreedShortOnlyAbove: 80,
      liquidationExchange: "Binance",
      liquidationSymbol: "BTCUSDT",
      liquidationRange: "24h",
      liquidationTpOffsetPct: 0.3
    },
    features: {
      marketRegime: true,
      correlationFilter: false,
      patternRecognition: false,
      smc: false,
      onChain: false,
      sentiment: false,
      disasterRecovery: false,
      adaptiveLevels: false,
      scanner: true,
      selfLearner: false,
      liquidationHeatmap: false,
      journal: false,
      preTradeAlerts: false,
      marketMonitor: false,
      projection: false,
      partialProfitLock: false,
      newsFilter: false,
      healthCheck: false,
      whaleAlert: false
    },
    notifications: {
      regime: false,
      correlation: false,
      patternRecognition: false,
      smc: false,
      onChain: false,
      sentiment: false,
      disasterRecovery: false,
      scanner: false,
      selfLearner: false,
      liquidationHeatmap: false,
      journal: false,
      preTrade: false,
      marketMonitor: false,
      projection: false,
      partialProfitLock: false,
      health: false,
      whale: false
    },
    capital: { initialCapitalUsd: 34 },
    compounding: { levels: 30, profitTargetPct: 30, riskPctOfBalance: 1.5 },
    partialProfitLock: { triggerPctOfLevelTarget: 50, lockPctOfProfitSoFar: 50 },
    risk: {
      leverage: 10,
      slMode: "atr",
      slFixedPct: 2.5,
      slAtrMultiplier: 1.8,
      tpMode: "rr",
      tpFixedPct: 7.0,
      rrRatio: 2.0,
      trailingStopEnabled: true,
      trailingActivationPct: 2.0,
      dailyLossLimitUsd: 25,
      maxDrawdownPct: 25
    }
  }
}
