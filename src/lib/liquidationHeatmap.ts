export type LiquidationLevel = {
  price: number
  longLiquidation: number
  shortLiquidation: number
  totalLiquidation: number
  dominantSide: "LONG" | "SHORT"
}

export type HeatmapData = {
  symbol: string
  currentPrice: number
  levels: LiquidationLevel[]
  fetchTime: number
}

export type LiquidationMagnet = {
  rank: number
  price: number
  liquidationAmount: number
  distanceFromPrice: number
  probability: number
  suggestTPHere: boolean
}

export type OptimizedTP = {
  price: number
  method: "basic" | "liquidation_magnet"
  magnet: LiquidationMagnet | null
  magnetAmount?: number
  probability?: number
  betterThanBasic?: boolean
}

export async function getLiquidationHeatmap(opts: {
  symbol: string
  exchange: string
  range: string
}): Promise<HeatmapData> {
  const [price, raw] = await Promise.all([
    fetch(`/api/bingx/price?symbol=${encodeURIComponent(opts.symbol)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => parseCurrentPrice(x))
      .catch(() => 0),
    fetch(
      `/api/coinglass/heatmap?exchange=${encodeURIComponent(opts.exchange)}&symbol=${encodeURIComponent(
        opts.symbol.replace("-", "")
      )}&range=${encodeURIComponent(opts.range)}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .catch(() => null)
  ])

  const currentPrice = Number.isFinite(price) && price > 0 ? price : 0
  const levels = normalizeCoinglassHeatmap(raw)

  return {
    symbol: opts.symbol,
    currentPrice,
    levels,
    fetchTime: Date.now()
  }
}

export function findLiquidationMagnets(heatmap: HeatmapData, direction: "LONG" | "SHORT"): LiquidationMagnet[] {
  const currentPrice = heatmap.currentPrice
  const levels = heatmap.levels

  const relevant =
    direction === "LONG"
      ? levels
          .filter((l) => l.price > currentPrice * 1.005)
          .filter((l) => l.shortLiquidation > 1_000_000)
          .sort((a, b) => b.shortLiquidation - a.shortLiquidation)
      : levels
          .filter((l) => l.price < currentPrice * 0.995)
          .filter((l) => l.longLiquidation > 1_000_000)
          .sort((a, b) => b.longLiquidation - a.longLiquidation)

  return relevant.slice(0, 3).map((level, index) => {
    const liquidationAmount = direction === "LONG" ? level.shortLiquidation : level.longLiquidation
    return {
      rank: index + 1,
      price: level.price,
      liquidationAmount,
      distanceFromPrice: currentPrice > 0 ? (Math.abs(level.price - currentPrice) / currentPrice) * 100 : 0,
      probability: calculateMagnetProbability(level, heatmap, direction),
      suggestTPHere: index === 0
    }
  })
}

export function calculateMagnetProbability(level: LiquidationLevel, heatmap: HeatmapData, direction: "LONG" | "SHORT"): number {
  const current = heatmap.currentPrice
  const distance = current > 0 ? (Math.abs(level.price - current) / current) * 100 : 99
  const liqAmount = direction === "LONG" ? level.shortLiquidation : level.longLiquidation

  let prob = 50
  if (liqAmount > 50_000_000) prob += 20
  else if (liqAmount > 20_000_000) prob += 10

  if (distance < 1) prob += 15
  else if (distance < 2) prob += 8
  else if (distance > 5) prob -= 15

  const roundNumber = Math.round(level.price / 1000) * 1000
  if (Math.abs(level.price - roundNumber) < 100) prob += 10

  return Math.min(95, Math.max(10, Math.round(prob)))
}

export async function optimizeTPWithHeatmap(opts: {
  direction: "LONG" | "SHORT"
  entryPrice: number
  basicTP: number
  symbol: string
  exchange: string
  range: string
  heatmap?: HeatmapData
}): Promise<OptimizedTP> {
  const heatmap =
    opts.heatmap ??
    (await getLiquidationHeatmap({
      symbol: opts.symbol,
      exchange: opts.exchange,
      range: opts.range
    }))

  const magnets = findLiquidationMagnets(heatmap, opts.direction)
  if (magnets.length === 0) {
    return { price: opts.basicTP, method: "basic", magnet: null }
  }

  const primaryMagnet = magnets[0]!
  const magnetPrice = primaryMagnet.price
  const tpOffset = opts.direction === "LONG" ? -0.002 : 0.002
  const magnetTP = magnetPrice * (1 + tpOffset)

  const usesMagnet =
    opts.direction === "LONG" ? magnetTP > opts.entryPrice * 1.005 : magnetTP < opts.entryPrice * 0.995

  const finalTP = usesMagnet ? magnetTP : opts.basicTP

  return {
    price: finalTP,
    method: usesMagnet ? "liquidation_magnet" : "basic",
    magnet: usesMagnet ? primaryMagnet : null,
    magnetAmount: primaryMagnet.liquidationAmount,
    probability: primaryMagnet.probability,
    betterThanBasic: usesMagnet && Math.abs(finalTP - opts.entryPrice) > Math.abs(opts.basicTP - opts.entryPrice)
  }
}

export function optimizeTPLevelsFromMagnets(opts: {
  direction: "LONG" | "SHORT"
  entryPrice: number
  tp1: number
  tp2?: number
  tp3?: number
  magnets: LiquidationMagnet[]
}): { tp1: number; tp2?: number; tp3?: number } {
  const tpOffset = opts.direction === "LONG" ? -0.002 : 0.002

  const apply = (magnetPrice: number, fallback: number | undefined): number | undefined => {
    if (!Number.isFinite(magnetPrice) || magnetPrice <= 0) return fallback
    const magnetTP = magnetPrice * (1 + tpOffset)
    const ok = opts.direction === "LONG" ? magnetTP > opts.entryPrice * 1.005 : magnetTP < opts.entryPrice * 0.995
    if (!ok) return fallback
    if (fallback === undefined) return magnetTP
    const better = Math.abs(magnetTP - opts.entryPrice) > Math.abs(fallback - opts.entryPrice)
    return better ? magnetTP : fallback
  }

  const m1 = opts.magnets[0]?.price
  const m2 = opts.magnets[1]?.price
  const m3 = opts.magnets[2]?.price

  const tp1 = m1 ? apply(m1, opts.tp1) ?? opts.tp1 : opts.tp1
  const tp2 = m2 ? apply(m2, opts.tp2) : opts.tp2
  const tp3 = m3 ? apply(m3, opts.tp3) : opts.tp3

  return { tp1, tp2, tp3 }
}

export function formatHeatmapTelegram(opts: {
  symbol: string
  direction: "LONG" | "SHORT"
  currentPrice: number
  magnetsForMove: LiquidationMagnet[]
  dangerLevels: LiquidationLevel[]
  entryPrice: number
  stopLoss: number
  tp1: number
  tp2?: number
  tp3?: number
}): string {
  const sym = opts.symbol.replace("-", "/")
  const tp1Line = opts.magnetsForMove[0]
    ? `🎯 $${fmt0(opts.magnetsForMove[0].price)} — $${fmtM(opts.magnetsForMove[0].liquidationAmount)} ← TP1 SET HERE (${opts.magnetsForMove[0].probability}% prob)`
    : "—"
  const tp2Line = opts.magnetsForMove[1]
    ? `$${fmt0(opts.magnetsForMove[1].price)} — $${fmtM(opts.magnetsForMove[1].liquidationAmount)} ← TP2 SET HERE`
    : "—"
  const tp3Line = opts.magnetsForMove[2]
    ? `$${fmt0(opts.magnetsForMove[2].price)} — $${fmtM(opts.magnetsForMove[2].liquidationAmount)} ← TP3 SET HERE`
    : "—"

  const dangers = opts.dangerLevels.slice(0, 3).map((l) => {
    const amt = l.totalLiquidation
    return `⚠️ $${fmt0(l.price)} — $${fmtM(amt)}`
  })

  const rr = Math.abs(opts.tp1 - opts.entryPrice) / Math.max(0.0000001, Math.abs(opts.stopLoss - opts.entryPrice))

  return `🔥 LIQUIDATION HEATMAP ANALYSIS
━━━━━━━━━━━━━━
${sym} | Current: $${fmt0(opts.currentPrice)}

${opts.direction === "LONG" ? "SHORT LIQUIDATIONS ABOVE (magnets for price):" : "LONG LIQUIDATIONS BELOW (magnets for price):"}
${tp1Line}
${tp2Line}
${tp3Line}

${opts.direction === "LONG" ? "LONG LIQUIDATIONS BELOW (danger zones):" : "SHORT LIQUIDATIONS ABOVE (danger zones):"}
${dangers.length ? dangers.join("\n") : "—"}

✅ Trade setup:
Entry: $${fmt0(opts.entryPrice)}
TP1: $${fmt0(opts.tp1)}
${opts.tp2 ? `TP2: $${fmt0(opts.tp2)}` : "TP2: —"}
${opts.tp3 ? `TP3: $${fmt0(opts.tp3)}` : "TP3: —"}
SL: $${fmt0(opts.stopLoss)}
RR: 1:${rr.toFixed(2)}`
}

export function findDangerLevels(opts: {
  heatmap: HeatmapData
  direction: "LONG" | "SHORT"
  minUsd?: number
}): LiquidationLevel[] {
  const minUsd = Math.max(0, opts.minUsd ?? 20_000_000)
  const price = opts.heatmap.currentPrice
  const levels = opts.heatmap.levels
  const danger =
    opts.direction === "LONG"
      ? levels
          .filter((l) => l.price < price && l.longLiquidation > minUsd)
          .sort((a, b) => b.price - a.price)
      : levels
          .filter((l) => l.price > price && l.shortLiquidation > minUsd)
          .sort((a, b) => a.price - b.price)
  return danger
}

export function findLevelNearPrice(opts: {
  heatmap: HeatmapData
  price: number
  withinPct: number
}): LiquidationLevel | null {
  const within = Math.max(0, opts.withinPct)
  const p = opts.price
  if (p <= 0 || within <= 0) return null
  const best = opts.heatmap.levels.find((l) => Math.abs(l.price - p) / p < within)
  return best ?? null
}

export function topLevelsAroundPrice(opts: {
  heatmap: HeatmapData
  above: number
  below: number
}): LiquidationLevel[] {
  const current = opts.heatmap.currentPrice
  const above = opts.heatmap.levels
    .filter((l) => l.price > current)
    .sort((a, b) => b.totalLiquidation - a.totalLiquidation)
    .slice(0, Math.max(0, opts.above))
  const below = opts.heatmap.levels
    .filter((l) => l.price < current)
    .sort((a, b) => b.totalLiquidation - a.totalLiquidation)
    .slice(0, Math.max(0, opts.below))
  return [...above, ...below].sort((a, b) => a.price - b.price)
}

function parseCurrentPrice(raw: unknown): number {
  const data = raw as any
  const row = data?.data ?? data
  const p = Number(row?.price ?? row?.lastPrice ?? row?.last)
  return Number.isFinite(p) ? p : 0
}

function normalizeCoinglassHeatmap(raw: unknown): LiquidationLevel[] {
  const data = raw as any
  const root = data?.data ?? data
  const candidates: any[] = Array.isArray(root) ? root : Array.isArray(root?.data) ? root.data : Array.isArray(root?.list) ? root.list : []

  const levels: LiquidationLevel[] = []
  for (const r of candidates) {
    if (!r || typeof r !== "object") continue
    const price = toNum(r.price ?? r.p ?? r.levelPrice)
    const longLiquidation = toNum(r.longLiquidation ?? r.longLiqUsd ?? r.longLiq ?? r.long)
    const shortLiquidation = toNum(r.shortLiquidation ?? r.shortLiqUsd ?? r.shortLiq ?? r.short)
    if (!Number.isFinite(price) || price <= 0) continue
    const longV = Number.isFinite(longLiquidation) ? longLiquidation : 0
    const shortV = Number.isFinite(shortLiquidation) ? shortLiquidation : 0
    const total = longV + shortV
    if (total <= 0) continue
    levels.push({
      price,
      longLiquidation: longV,
      shortLiquidation: shortV,
      totalLiquidation: total,
      dominantSide: longV > shortV ? "LONG" : "SHORT"
    })
  }

  return levels.sort((a, b) => a.price - b.price)
}

function toNum(x: unknown): number {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : NaN
}

function fmt0(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return Math.round(n).toLocaleString()
}

function fmtM(n: number): string {
  if (!Number.isFinite(n)) return "0.0M"
  return `${(n / 1_000_000).toFixed(1)}M`
}
