import type { Candle, Settings, StrategySnapshot, TradeSide, Timeframe } from "@/types/bot"
import { scoreSetup } from "@/lib/strategy"
import { detectMarketRegime } from "@/lib/marketRegime"
import { scoreSmc } from "@/lib/smc"
import { evaluateCorrelation } from "@/lib/correlationFilter"
import { calculateAdaptiveSL, calculateAdaptiveTP } from "@/lib/adaptiveLevels"
import { detectOrderBlocks, detectFairValueGaps } from "@/lib/smc"

export const SCAN_SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "BNB-USDT",
  "LINK-USDT",
  "POL-USDT",
  "DOT-USDT",
  "UNI-USDT",
  "RENDER-USDT",
  "FET-USDT",
  "ARB-USDT",
  "XRP-USDT"
]

export const DEFAULT_SCAN_SYMBOLS = SCAN_SYMBOLS

export type ScoreBreakdown = {
  baseFilters: number
  smcZone: number
  regime: string
  btcAlignment: number
}

export type SymbolScore = {
  symbol: string
  requestedSymbol?: string
  direction: TradeSide
  totalScore: number
  breakdown: ScoreBreakdown
  entryPrice: number
  suggestedSL: number
  suggestedTP: number
  rr: number
  regime: string
  topReason: string
  rank: number
  scanTime: number
  snapshot: StrategySnapshot
}

export type ScanMeta = {
  attemptedSymbols: string[]
  resolvedSymbols: string[]
  aliasMap: Record<string, string>
  skippedSymbols: string[]
}

export type ScanAllResult = {
  results: SymbolScore[]
  meta: ScanMeta
}

export function resolveScanSymbols(opts: {
  requested: string[]
  active: string[]
}): { resolved: string[]; aliasMap: Record<string, string>; skipped: string[] } {
  const activeSet = new Set(opts.active.map((s) => s.toUpperCase()))
  const aliasCandidates: Record<string, string[]> = {
    "POL-USDT": ["POL-USDT", "MATIC-USDT"],
    "RENDER-USDT": ["RENDER-USDT", "RNDR-USDT"],
    "FET-USDT": ["FET-USDT", "FETCHAI-USDT"]
  }

  const aliasMap: Record<string, string> = {}
  const resolved: string[] = []
  const skipped: string[] = []

  for (const raw of opts.requested) {
    const want = raw.toUpperCase()
    const candidates = aliasCandidates[want] ?? [want]
    const found = candidates.find((c) => activeSet.has(c))
    if (!found) {
      skipped.push(want)
      continue
    }
    resolved.push(found)
    if (found !== want) aliasMap[found] = want
  }

  return { resolved: uniq(resolved), aliasMap, skipped }
}

export async function scanAllSymbols(opts: {
  settings: Settings
  symbols?: string[]
  maxConcurrent?: number
  fetchKlines: (symbol: string, interval: Timeframe, limit: number) => Promise<Candle[]>
  fetchFundingRatePct?: (symbol: string) => Promise<number | undefined>
  fetchCoingeckoGlobal: () => Promise<{ btcDominance?: number; marketCapChange24hPct?: number }>
  fetchDxyDaily: () => Promise<{ candles: { open: number; close: number }[] }>
  previousBtcDominance?: number
}): Promise<SymbolScore[]> {
  const symbols = opts.symbols?.length ? opts.symbols : DEFAULT_SCAN_SYMBOLS
  const out = await scanAllSymbolsDetailed({ ...opts, symbols })
  return out.results
}

export async function scanAllSymbolsDetailed(opts: {
  settings: Settings
  symbols: string[]
  maxConcurrent?: number
  fetchKlines: (symbol: string, interval: Timeframe, limit: number) => Promise<Candle[]>
  fetchFundingRatePct?: (symbol: string) => Promise<number | undefined>
  fetchCoingeckoGlobal: () => Promise<{ btcDominance?: number; marketCapChange24hPct?: number }>
  fetchDxyDaily: () => Promise<{ candles: { open: number; close: number }[] }>
  previousBtcDominance?: number
  aliasMap?: Record<string, string>
}): Promise<ScanAllResult> {
  const maxConcurrent = Math.max(1, Math.min(3, opts.maxConcurrent ?? 3))
  const results: SymbolScore[] = []
  const skippedSymbols: string[] = []
  const symbols = opts.symbols

  const baseInterval = opts.settings.timeframe
  const btcTrend =
    symbols.some((s) => s.toUpperCase() !== "BTC-USDT")
      ? await opts
          .fetchKlines("BTC-USDT", baseInterval, 260)
          .then((c) => (c.length ? getTrendFrom4h(c) : undefined))
          .catch(() => undefined)
      : undefined

  const chunks = chunkArray(symbols, maxConcurrent)
  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map((symbol) =>
        scoreSymbol({
          symbol,
          settings: opts.settings,
          fetchKlines: opts.fetchKlines,
          fetchFundingRatePct: opts.fetchFundingRatePct,
          fetchCoingeckoGlobal: opts.fetchCoingeckoGlobal,
          fetchDxyDaily: opts.fetchDxyDaily,
          previousBtcDominance: opts.previousBtcDominance,
          btcTrend,
          requestedSymbol: opts.aliasMap?.[symbol]
        })
      )
    )

    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i]
      const sym = chunk[i]!
      if (r?.status === "fulfilled" && r.value) results.push(r.value)
      else skippedSymbols.push(sym)
    }

    await sleep(500)
  }

  results.sort((a, b) => b.totalScore - a.totalScore)
  results.forEach((r, i) => (r.rank = i + 1))

  return {
    results,
    meta: {
      attemptedSymbols: symbols,
      resolvedSymbols: symbols,
      aliasMap: opts.aliasMap ?? {},
      skippedSymbols
    }
  }
}

export async function scoreSymbol(opts: {
  symbol: string
  requestedSymbol?: string
  settings: Settings
  fetchKlines: (symbol: string, interval: Timeframe, limit: number) => Promise<Candle[]>
  fetchFundingRatePct?: (symbol: string) => Promise<number | undefined>
  fetchCoingeckoGlobal: () => Promise<{ btcDominance?: number; marketCapChange24hPct?: number }>
  fetchDxyDaily: () => Promise<{ candles: { open: number; close: number }[] }>
  previousBtcDominance?: number
  btcTrend?: TradeSide
}): Promise<SymbolScore | null> {
  console.log(`[scanner] Scanning ${opts.symbol}...`)

  const baseInterval = opts.settings.timeframe

  const [daily, h4, fundingRatePct] = await Promise.all([
    opts.fetchKlines(opts.symbol, "1d", 120),
    opts.fetchKlines(opts.symbol, baseInterval, 260),
    opts.fetchFundingRatePct ? opts.fetchFundingRatePct(opts.symbol).catch(() => undefined) : Promise.resolve(undefined)
  ])

  console.log(
    `[scanner] ${opts.symbol} candles fetched: 1d=${daily?.length ?? 0} ${baseInterval}=${h4?.length ?? 0}`
  )

  if (!h4 || h4.length < 210 || !daily || daily.length < 20) {
    console.log(`[scanner] ${opts.symbol} SKIP — not enough candle data`)
    return null
  }

  const direction =
    opts.symbol.toUpperCase() === "BTC-USDT"
      ? getDailyBias(daily)
      : opts.btcTrend
        ? opts.btcTrend
        : getDailyBias(daily)
  const regimeData = detectMarketRegime(h4)
  if (regimeData.regime === "VOLATILE") return null

  const baseSnapshot = scoreSetup(h4, direction, opts.settings, { dailyBias: direction, fundingRatePct })
  if (baseSnapshot.blocked) return null

  let total = baseSnapshot.totalScore
  let btcAlignmentScore = 0

  if (opts.settings.features.correlationFilter && opts.symbol !== "BTC-USDT") {
    const decision = await evaluateCorrelation({
      symbol: opts.symbol,
      side: direction,
      fetchKlines: (s, interval, limit) => opts.fetchKlines(s, interval, limit),
      fetchCoingeckoGlobal: opts.fetchCoingeckoGlobal,
      fetchDxyDaily: opts.fetchDxyDaily,
      previousBtcDominance: opts.previousBtcDominance
    })
    if (decision.blocked) return null
    total += decision.scoreDelta
    btcAlignmentScore = decision.details?.btcAligned ? 15 : decision.scoreDelta < 0 ? decision.scoreDelta : 0
  }

  let smcBonus = 0
  if (opts.settings.features.smc) {
    const smc = scoreSmc(h4, direction, opts.settings.timeframe === "1d" ? "1D" : "4H")
    if (smc.blocked) return null
    total += smc.scoreDelta
    if (smc.insideOrderBlock) smcBonus += 25
  }

  const currentPrice = h4[h4.length - 1]!.close

  const smcData = {
    orderBlocks: detectOrderBlocks(h4, opts.settings.timeframe === "1d" ? "1D" : "4H"),
    fvgs: detectFairValueGaps(h4)
  }

  const sl = calculateAdaptiveSL(h4, direction, currentPrice, smcData)
  const tp = calculateAdaptiveTP(h4, direction, currentPrice, sl.price, undefined, smcData)
  if (!tp.valid) return null

  const rr = Math.abs(tp.tp1.price - currentPrice) / Math.max(0.0000001, Math.abs(sl.price - currentPrice))
  const totalScore = Math.max(0, Math.min(100, Math.round(total + smcBonus)))

  console.log(`[scanner] ${opts.symbol} score: ${totalScore}`)

  const snapshot: StrategySnapshot = {
    ...baseSnapshot,
    totalScore,
    reasons: [
      ...baseSnapshot.reasons,
      ...(opts.symbol.toUpperCase() !== "BTC-USDT" && opts.btcTrend
        ? [`BTC 4H gate: ${opts.btcTrend} only`]
        : [])
    ]
  }

  return {
    symbol: opts.symbol,
    requestedSymbol: opts.requestedSymbol,
    direction,
    totalScore,
    breakdown: {
      baseFilters: baseSnapshot.totalScore,
      smcZone: smcBonus,
      regime: regimeData.regime,
      btcAlignment: btcAlignmentScore
    },
    entryPrice: currentPrice,
    suggestedSL: sl.price,
    suggestedTP: tp.tp1.price,
    rr,
    regime: regimeData.regime,
    topReason: pickTopReason(baseSnapshot),
    rank: 0,
    scanTime: Date.now(),
    snapshot
  }
}

function getDailyBias(daily: Candle[]): TradeSide {
  if (!daily || daily.length < 20) return "LONG"
  const closes = daily.map((c) => c.close)
  const ema20 = ema(closes, 20)
  const lastClose = closes[closes.length - 1]
  if (!Number.isFinite(ema20) || !Number.isFinite(lastClose)) return "LONG"
  return lastClose > ema20 ? "LONG" : "SHORT"
}

function getTrendFrom4h(candles: Candle[]): TradeSide {
  const closes = candles.map((c) => c.close)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  return ema20 >= ema50 ? "LONG" : "SHORT"
}

function pickTopReason(snapshot: StrategySnapshot): string {
  const first = snapshot.reasons.find(Boolean)
  if (first) return first
  return snapshot.blocked ? snapshot.blocks[0] ?? "Blocked" : "High score"
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function ema(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0
  const k = 2 / (period + 1)
  let e = values[0] ?? 0
  for (const v of values) e = v * k + e * (1 - k)
  return e
}

function uniq(arr: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of arr) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}
