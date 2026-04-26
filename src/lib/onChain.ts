export type OnChainSignal = {
  signal: string
  value: number
  score: number
  description: string
  btcDominance?: number
  marketCapChange?: number
}

export type OnChainScoreSummary = {
  totalScore: number
  signals: OnChainSignal[]
  summary: string
  liqMagnets?: {
    nearestLongMagnet?: number
    nearestShortMagnet?: number
  }
}

export async function getExchangeNetflow(): Promise<OnChainSignal> {
  const key = process.env.CRYPTOQUANT_KEY
  if (!key) {
    return { signal: "NO_KEY", value: 0, score: 0, description: "CryptoQuant key missing" }
  }

  const res = await fetch("https://api.cryptoquant.com/v1/btc/exchange-flows/netflow?window=day&limit=3", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store"
  })
  if (!res.ok) {
    return { signal: "ERROR", value: 0, score: 0, description: `CryptoQuant error: ${res.status}` }
  }

  const data = (await res.json()) as any
  const latestNetflow = Number(data?.result?.data?.[0]?.netflow_total ?? 0)
  const signal =
    latestNetflow < -1000 ? "BULLISH" : latestNetflow > 1000 ? "BEARISH" : "NEUTRAL"
  const score =
    latestNetflow < -5000
      ? 20
      : latestNetflow < -1000
        ? 10
        : latestNetflow > 5000
          ? -20
          : latestNetflow > 1000
            ? -10
            : 0
  return { signal, value: latestNetflow, score, description: `Exchange netflow: ${latestNetflow} BTC` }
}

export async function getMempoolData(): Promise<OnChainSignal> {
  const res = await fetch("https://blockchain.info/q/unconfirmedcount", { cache: "no-store" })
  if (!res.ok) return { signal: "ERROR", value: 0, score: 0, description: `Mempool error: ${res.status}` }
  const text = await res.text()
  const mempoolSize = Number(text)
  const signal = mempoolSize > 50000 ? "HIGH_ACTIVITY" : "NORMAL"
  const score = mempoolSize > 50000 ? 5 : 0
  return { signal, value: mempoolSize, score, description: `Mempool: ${mempoolSize} unconfirmed tx` }
}

export async function getFearGreed(): Promise<OnChainSignal> {
  const res = await fetch("https://api.alternative.me/fng/?limit=3", { cache: "no-store" })
  if (!res.ok) return { signal: "ERROR", value: 0, score: 0, description: `FNG error: ${res.status}` }
  const data = (await res.json()) as any
  const scoreNum = Number.parseInt(String(data?.data?.[0]?.value ?? "0"), 10)
  const classification = String(data?.data?.[0]?.value_classification ?? "")

  let tradeScore = 0
  let signal = "NEUTRAL"
  if (scoreNum < 20) {
    tradeScore = 20
    signal = "EXTREME_FEAR_BUY"
  } else if (scoreNum < 40) {
    tradeScore = 10
    signal = "FEAR_BULLISH_LEAN"
  } else if (scoreNum > 80) {
    tradeScore = -20
    signal = "EXTREME_GREED_SELL"
  } else if (scoreNum > 60) {
    tradeScore = -10
    signal = "GREED_BEARISH_LEAN"
  }

  return { signal, value: scoreNum, score: tradeScore, description: `Fear & Greed: ${scoreNum} (${classification})` }
}

export async function getMarketData(): Promise<OnChainSignal> {
  const res = await fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
  if (!res.ok) return { signal: "ERROR", value: 0, score: 0, description: `CoinGecko error: ${res.status}` }
  const data = (await res.json()) as any
  const btcDominance = Number(data?.data?.market_cap_percentage?.btc ?? 0)
  const totalMarketCapChange = Number(data?.data?.market_cap_change_percentage_24h_usd ?? 0)

  const signal =
    totalMarketCapChange > 3 ? "BULLISH" : totalMarketCapChange < -3 ? "BEARISH" : "NEUTRAL"
  const score =
    totalMarketCapChange > 5
      ? 15
      : totalMarketCapChange > 2
        ? 8
        : totalMarketCapChange < -5
          ? -15
          : totalMarketCapChange < -2
            ? -8
            : 0
  return {
    signal,
    value: totalMarketCapChange,
    score,
    btcDominance,
    marketCapChange: totalMarketCapChange,
    description: `Market cap 24h: ${totalMarketCapChange.toFixed(2)}%`
  }
}

export async function getLiquidationData(symbol: string): Promise<{ nearestLongMagnet?: number; nearestShortMagnet?: number }> {
  const key = process.env.COINGLASS_API_KEY || process.env.COINGLASS_KEY
  if (!key) return {}

  const res = await fetch(
    `https://open-api.coinglass.com/public/v2/liquidation?symbol=${encodeURIComponent(symbol)}&interval=h4`,
    { headers: { coinglassSecret: key }, cache: "no-store" }
  )
  if (!res.ok) return {}

  const data = (await res.json()) as any
  const longs: any[] = Array.isArray(data?.data?.longLiquidationUsd) ? data.data.longLiquidationUsd : []
  const shorts: any[] = Array.isArray(data?.data?.shortLiquidationUsd) ? data.data.shortLiquidationUsd : []

  longs.sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
  shorts.sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))

  const nearestLongMagnet = Number(longs[0]?.price)
  const nearestShortMagnet = Number(shorts[0]?.price)
  return {
    nearestLongMagnet: Number.isFinite(nearestLongMagnet) ? nearestLongMagnet : undefined,
    nearestShortMagnet: Number.isFinite(nearestShortMagnet) ? nearestShortMagnet : undefined
  }
}

export async function getAddressesInProfit(symbol: string): Promise<OnChainSignal> {
  const key = process.env.INTOTHEBLOCK_KEY
  if (!key) return { signal: "NO_KEY", value: 0, score: 0, description: "IntoTheBlock key missing" }

  const res = await fetch(`https://api.intotheblock.com/v1/${encodeURIComponent(symbol)}/signals/summary`, {
    headers: { "x-api-key": key },
    cache: "no-store"
  })
  if (!res.ok) return { signal: "ERROR", value: 0, score: 0, description: `IntoTheBlock error: ${res.status}` }

  const data = (await res.json()) as any
  const inProfitPercent = Number(data?.inTheMoney?.percent ?? 0)
  const signal =
    inProfitPercent > 80 ? "OVERBOUGHT_ADDRESSES" : inProfitPercent < 40 ? "OVERSOLD_ADDRESSES" : "NEUTRAL"
  const score =
    inProfitPercent > 85
      ? -15
      : inProfitPercent > 75
        ? -8
        : inProfitPercent < 35
          ? 20
          : inProfitPercent < 45
            ? 10
            : 0
  return {
    signal,
    value: inProfitPercent,
    score,
    description: `Addresses in profit: ${inProfitPercent}%`
  }
}

export async function getOnChainScore(symbolForLiq = "BTC"): Promise<OnChainScoreSummary> {
  const itbSymbol = symbolForLiq.toLowerCase()
  const [netflow, fearGreed, market, mempool, inProfit, liquidations] = await Promise.all([
    getExchangeNetflow(),
    getFearGreed(),
    getMarketData(),
    getMempoolData(),
    getAddressesInProfit(itbSymbol),
    getLiquidationData(symbolForLiq)
  ])

  const totalScore = netflow.score + fearGreed.score + market.score + mempool.score + inProfit.score
  const summary =
    totalScore > 20
      ? "STRONG BULLISH ON-CHAIN"
      : totalScore > 10
        ? "MILD BULLISH"
        : totalScore < -20
          ? "STRONG BEARISH ON-CHAIN"
          : totalScore < -10
            ? "MILD BEARISH"
            : "NEUTRAL"

  return { totalScore, signals: [netflow, fearGreed, market, inProfit, mempool], summary, liqMagnets: liquidations }
}
