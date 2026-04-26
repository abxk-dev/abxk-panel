import type { Settings } from "@/types/bot"

export type CompoundingLevel = {
  level: number
  balanceUsd: number
  profitTargetUsd: number
  endingBalanceUsd: number
  riskUsd: number
}

export const COMPOUNDING_LEVELS = [
  { level: 1, balance: 20, risk: 4.5, target: 26 },
  { level: 2, balance: 26, risk: 6, target: 34 },
  { level: 3, balance: 34, risk: 8, target: 44 },
  { level: 4, balance: 44, risk: 10, target: 58 },
  { level: 5, balance: 58, risk: 14, target: 76 },
  { level: 6, balance: 76, risk: 18, target: 98 },
  { level: 7, balance: 98, risk: 22, target: 126 },
  { level: 8, balance: 126, risk: 28, target: 164 },
  { level: 9, balance: 164, risk: 38, target: 212 },
  { level: 10, balance: 212, risk: 48, target: 276 },
  { level: 11, balance: 276, risk: 64, target: 358 },
  { level: 12, balance: 358, risk: 82, target: 466 },
  { level: 13, balance: 466, risk: 108, target: 606 },
  { level: 14, balance: 606, risk: 140, target: 788 },
  { level: 15, balance: 788, risk: 182, target: 1024 },
  { level: 16, balance: 1024, risk: 236, target: 1332 },
  { level: 17, balance: 1332, risk: 308, target: 1732 },
  { level: 18, balance: 1732, risk: 400, target: 2252 },
  { level: 19, balance: 2252, risk: 520, target: 2926 },
  { level: 20, balance: 2926, risk: 674, target: 3804 },
  { level: 21, balance: 3804, risk: 878, target: 4944 },
  { level: 22, balance: 4944, risk: 1140, target: 6426 },
  { level: 23, balance: 6426, risk: 1482, target: 8354 },
  { level: 24, balance: 8354, risk: 1928, target: 10860 },
  { level: 25, balance: 10860, risk: 2506, target: 14116 },
  { level: 26, balance: 14116, risk: 3256, target: 18350 },
  { level: 27, balance: 18350, risk: 4234, target: 23854 },
  { level: 28, balance: 23854, risk: 5504, target: 31010 },
  { level: 29, balance: 31010, risk: 7156, target: 40312 },
  { level: 30, balance: 40312, risk: 9302, target: 52404 }
] as const satisfies ReadonlyArray<{ level: number; balance: number; risk: number; target: number }>

export function getFixedCompoundingLevel(level: number) {
  return COMPOUNDING_LEVELS.find((l) => l.level === level)
}

export function generateCompoundingPlan(settings: Settings): CompoundingLevel[] {
  const fixed = shouldUseFixedCompoundingPlan(settings)
  if (fixed) {
    return COMPOUNDING_LEVELS.map((l) => ({
      level: l.level,
      balanceUsd: roundUsd(l.balance),
      profitTargetUsd: roundUsd(l.target - l.balance),
      endingBalanceUsd: roundUsd(l.target),
      riskUsd: roundUsd(l.risk)
    }))
  }

  const levels = Math.max(1, Math.floor(settings.compounding.levels))
  const profitTargetPct = Math.max(0, settings.compounding.profitTargetPct) / 100
  const riskPct = Math.max(0, settings.compounding.riskPctOfBalance) / 100

  const plan: CompoundingLevel[] = []
  let balance = Math.max(0, settings.capital.initialCapitalUsd)

  for (let i = 1; i <= levels; i += 1) {
    const profitTargetUsd = balance * profitTargetPct
    const endingBalanceUsd = balance + profitTargetUsd
    const riskUsd = endingBalanceUsd * riskPct

    plan.push({
      level: i,
      balanceUsd: roundUsd(balance),
      profitTargetUsd: roundUsd(profitTargetUsd),
      endingBalanceUsd: roundUsd(endingBalanceUsd),
      riskUsd: roundUsd(riskUsd)
    })

    balance = endingBalanceUsd
  }

  return plan
}

export function getActiveLevel(levels: number, completedLevels: number[]): number {
  const completed = new Set(completedLevels)
  for (let i = 1; i <= levels; i += 1) {
    if (!completed.has(i)) return i
  }
  return levels
}

export function getProgress(levels: number, completedLevels: number[]): { done: number; total: number } {
  const done = completedLevels.filter((x) => x >= 1 && x <= levels).length
  return { done, total: levels }
}

export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100
}

function shouldUseFixedCompoundingPlan(settings: Settings): boolean {
  const levels = Math.max(1, Math.floor(settings.compounding.levels))
  const initial = Number(settings.capital.initialCapitalUsd)
  return levels === 30 && Math.abs(initial - 20) < 0.01
}
