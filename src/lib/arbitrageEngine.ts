export type FundingOpportunity = {
  symbol: string
  fundingRate: number
  annualizedPct: number
  direction: "SHORT_PERP_LONG_SPOT" | "LONG_PERP_SHORT_SPOT"
  estDailyPct: number
}

export type BasisOpportunity = {
  symbol: string
  basisPct: number
  spotLikePrice?: number
  futuresPrice?: number
  note?: string
}

export type ArbitrageThresholds = {
  fundingRateAbsPct: number
  basisAbsPct: number
}

export function defaultArbitrageThresholds(): ArbitrageThresholds {
  return { fundingRateAbsPct: 0.05, basisAbsPct: 0.3 }
}

export function annualizeFundingRate(opts: { fundingRate: number; paymentsPerDay?: number }): { annualizedPct: number; estDailyPct: number } {
  const payments = typeof opts.paymentsPerDay === "number" && Number.isFinite(opts.paymentsPerDay) ? opts.paymentsPerDay : 3
  const fr = Number(opts.fundingRate)
  const per = Number.isFinite(fr) ? fr : 0
  const estDailyPct = Math.abs(per) * payments * 100
  const annualizedPct = Math.abs(per) * payments * 365 * 100
  return { annualizedPct, estDailyPct }
}

export function decideFundingArbDirection(fundingRate: number): FundingOpportunity["direction"] {
  return fundingRate > 0 ? "SHORT_PERP_LONG_SPOT" : "LONG_PERP_SHORT_SPOT"
}

export function parseBingxFundingRateFromPremiumIndex(json: unknown): number | null {
  const data = json as any
  const raw = data?.data?.lastFundingRate ?? data?.data?.fundingRate ?? data?.data?.lastFundingRatePercent
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export function parseBingxPrice(json: unknown): number | null {
  const data = json as any
  const raw = data?.data?.price ?? data?.data?.markPrice ?? data?.data?.lastPrice
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export function parseBingxMarkPrice(json: unknown): number | null {
  const data = json as any
  const raw = data?.data?.markPrice ?? data?.data?.indexPrice ?? data?.data?.lastPrice
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export function computeBasisPct(opts: { futuresPrice: number; spotLikePrice: number }): number {
  if (!opts.spotLikePrice || !Number.isFinite(opts.spotLikePrice)) return 0
  return ((opts.futuresPrice - opts.spotLikePrice) / opts.spotLikePrice) * 100
}

