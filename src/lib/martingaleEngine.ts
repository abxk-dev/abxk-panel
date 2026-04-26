export type MartingaleConfig = {
  enabled: boolean
  multiplier: number
  maxLevels: number
  resetOnWin: boolean
  applyTo: "SCALPING" | "COMPOUNDING" | "BOTH"
}

export type MartingaleDecision = {
  nextSizeUsd: number
  level: number
  maxLevels: number
  stoppedByCap: boolean
}

export function defaultMartingaleConfig(): MartingaleConfig {
  return {
    enabled: false,
    multiplier: 2,
    maxLevels: 3,
    resetOnWin: true,
    applyTo: "BOTH"
  }
}

export function normalizeMartingaleConfig(input: unknown): MartingaleConfig {
  const base = defaultMartingaleConfig()
  const x = input as any
  const enabled = Boolean(x?.enabled ?? base.enabled)
  const multiplier = clampNumber(Number(x?.multiplier ?? base.multiplier), 1, 10)
  const maxLevels = clampInt(Number(x?.maxLevels ?? base.maxLevels), 0, 20)
  const resetOnWin = Boolean(x?.resetOnWin ?? base.resetOnWin)
  const applyToRaw = String(x?.applyTo ?? base.applyTo).toUpperCase()
  const applyTo: MartingaleConfig["applyTo"] =
    applyToRaw === "SCALPING" ? "SCALPING" : applyToRaw === "COMPOUNDING" ? "COMPOUNDING" : "BOTH"
  return { enabled, multiplier, maxLevels, resetOnWin, applyTo }
}

export function getMartingaleSize(baseSizeUsd: number, consecutiveLosses: number, config: MartingaleConfig): MartingaleDecision {
  const base = clampNumber(baseSizeUsd, 0, 1_000_000_000)
  if (!config.enabled) return { nextSizeUsd: base, level: 0, maxLevels: config.maxLevels, stoppedByCap: false }
  const losses = clampInt(consecutiveLosses, 0, 1_000_000)
  if (config.maxLevels > 0 && losses >= config.maxLevels) {
    return { nextSizeUsd: base, level: losses, maxLevels: config.maxLevels, stoppedByCap: true }
  }
  const mult = clampNumber(config.multiplier, 1, 10)
  const next = base * Math.pow(mult, losses)
  return { nextSizeUsd: next, level: losses + (losses > 0 ? 1 : 1), maxLevels: config.maxLevels, stoppedByCap: false }
}

export function buildTelegramMartingaleActive(opts: {
  previousPnlUsd: number
  nextSizeUsd: number
  level: number
  maxLevels: number
  recoveryNeededUsd: number
}): string {
  const prev = opts.previousPnlUsd
  const rec = opts.recoveryNeededUsd
  return `⚠️ <b>MARTINGALE ACTIVE</b>
━━━━━━━━━━━━━━
Previous: ${prev >= 0 ? "WIN" : "LOSS"} (${fmtUsd(prev)})
Next size: $${fmtUsd(opts.nextSizeUsd)}
Level: ${opts.level}/${opts.maxLevels}
Recovery needed: +$${fmtUsd(rec)}`
}

export function buildTelegramMartingaleRecovered(opts: {
  winLevel: number
  grossProfitUsd: number
  netAfterLossesUsd: number
  resetBaseUsd: number
}): string {
  return `✅ <b>MARTINGALE RECOVERED</b>
━━━━━━━━━━━━━━
Win at level ${opts.winLevel}
Gross: +$${fmtUsd(opts.grossProfitUsd)}
Net after losses: +$${fmtUsd(opts.netAfterLossesUsd)}
Reset to base size: $${fmtUsd(opts.resetBaseUsd)}`
}

function fmtUsd(n: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "0.00"
  const abs = Math.abs(v)
  const s = abs >= 1 ? abs.toFixed(2) : abs.toFixed(6)
  return v < 0 ? `-${s}` : s
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

