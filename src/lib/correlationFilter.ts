import type { Candle, Timeframe, TradeSide } from "@/types/bot"
import { ema } from "@/lib/strategy"

export type CorrelationDecision = {
  blocked: boolean
  blockReason?: string
  scoreDelta: number
  warnings: string[]
  details: {
    btcAligned?: boolean
    btc1hMovePct?: number
    btcDominance?: number
    btcDominanceDelta?: number
    marketCapChange24hPct?: number
    dxyRising?: boolean
    dxyFalling?: boolean
  }
}

export async function evaluateCorrelation(opts: {
  symbol: string
  side: TradeSide
  fetchKlines: (symbol: string, interval: Timeframe, limit: number) => Promise<Candle[]>
  fetchCoingeckoGlobal: () => Promise<{
    btcDominance?: number
    marketCapChange24hPct?: number
  }>
  fetchDxyDaily: () => Promise<{ candles: { open: number; close: number }[] }>
  previousBtcDominance?: number
}): Promise<CorrelationDecision> {
  const isAlt = opts.symbol !== "BTC-USDT"
  const warnings: string[] = []
  const details: CorrelationDecision["details"] = {}
  let scoreDelta = 0

  const cg = await opts.fetchCoingeckoGlobal()
  details.btcDominance = cg.btcDominance
  details.marketCapChange24hPct = cg.marketCapChange24hPct

  if (cg.btcDominance !== undefined && opts.previousBtcDominance !== undefined) {
    details.btcDominanceDelta = cg.btcDominance - opts.previousBtcDominance
  }

  if (cg.btcDominance !== undefined && cg.btcDominance > 55 && isAlt) {
    return {
      blocked: true,
      blockReason: "BTC dominance > 55% = avoid altcoins entirely",
      scoreDelta: -100,
      warnings,
      details
    }
  }

  if (cg.marketCapChange24hPct !== undefined && cg.marketCapChange24hPct < -5 && opts.side === "LONG") {
    return {
      blocked: true,
      blockReason: "Total crypto market cap down > 5% in 24h = block all longs",
      scoreDelta: -100,
      warnings,
      details
    }
  }

  if (cg.marketCapChange24hPct !== undefined && cg.marketCapChange24hPct >= 0) {
    scoreDelta += 5
  }

  const dxy = await opts.fetchDxyDaily()
  const last3 = dxy.candles.slice(-3)
  const rising = last3.length === 3 && last3.every((c) => c.close > c.open) && isIncreasing(last3.map((c) => c.close))
  const falling = last3.length === 3 && last3.every((c) => c.close < c.open) && isDecreasing(last3.map((c) => c.close))
  details.dxyRising = rising
  details.dxyFalling = falling

  if (rising && opts.side === "LONG") {
    return {
      blocked: true,
      blockReason: "DXY rising — crypto headwind (block all LONG trades)",
      scoreDelta: -100,
      warnings: ["DXY rising — crypto headwind"],
      details
    }
  }

  if (falling && opts.side === "LONG") scoreDelta += 10

  if (!isAlt) {
    return { blocked: false, scoreDelta, warnings, details }
  }

  const btc4h = await opts.fetchKlines("BTC-USDT", "4h", 260)
  if (btc4h.length >= 60) {
    const closes = btc4h.map((c) => c.close)
    const btcEma20 = ema(closes, 20)
    const btcClose = closes[closes.length - 1] ?? 0

    const btcAligned = opts.side === "LONG" ? btcClose > btcEma20 : btcClose < btcEma20
    details.btcAligned = btcAligned
    if (btcAligned) scoreDelta += 15
    else scoreDelta -= 25
  }

  const btc1h = await opts.fetchKlines("BTC-USDT", "1h", 3)
  if (btc1h.length >= 2) {
    const prev = btc1h[btc1h.length - 2]?.close ?? 0
    const last = btc1h[btc1h.length - 1]?.close ?? 0
    if (prev > 0) {
      const movePct = ((last - prev) / prev) * 100
      details.btc1hMovePct = movePct
      if (movePct < -3 && opts.side === "LONG") {
        return {
          blocked: true,
          blockReason: `BTC dropped ${movePct.toFixed(1)}% in last 1H = block ALL altcoin longs`,
          scoreDelta: -100,
          warnings,
          details
        }
      }
      if (movePct > 3 && opts.side === "SHORT") {
        return {
          blocked: true,
          blockReason: `BTC pumped ${movePct.toFixed(1)}% in last 1H = block ALL altcoin shorts`,
          scoreDelta: -100,
          warnings,
          details
        }
      }
    }
  }

  if (details.btcDominance !== undefined && details.btcDominanceDelta !== undefined) {
    if (details.btcDominanceDelta > 0 && opts.side === "LONG") scoreDelta -= 15
    if (details.btcDominanceDelta < 0) scoreDelta += 10
  }

  return { blocked: false, scoreDelta, warnings, details }
}

function isIncreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i += 1) if ((xs[i] ?? 0) <= (xs[i - 1] ?? 0)) return false
  return true
}

function isDecreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i += 1) if ((xs[i] ?? 0) >= (xs[i - 1] ?? 0)) return false
  return true
}
