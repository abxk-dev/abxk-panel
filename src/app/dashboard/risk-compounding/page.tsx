"use client"

import { CompoundingTable } from "@/components/CompoundingTable"
import { RiskControls } from "@/components/RiskControls"
import { generateCompoundingPlan } from "@/lib/compounding"
import { useBotStore } from "@/store/botStore"

export default function RiskCompoundingPage() {
  const settings = useBotStore((s) => s.settings)
  const locked = useBotStore((s) => s.lockedProfitByLevel)
  const withdrawn = useBotStore((s) => s.withdrawnLockedProfitUsd)
  const withdrawLocked = useBotStore((s) => s.withdrawLockedProfits)
  const plan = generateCompoundingPlan(settings)
  const projected = plan[plan.length - 1]?.endingBalanceUsd ?? settings.capital.initialCapitalUsd
  const lockedTotal = Object.values(locked).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-white">Risk & Compounding</div>
        <div className="text-sm text-white/60">All parameters adjustable from UI</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Projected Final Value</div>
          <div className="mt-1 text-2xl font-semibold text-brand">${projected.toLocaleString()}</div>
          <div className="mt-1 text-xs text-white/50">
            Based on {settings.compounding.levels} levels × {settings.compounding.profitTargetPct}% target
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Profit Target %</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {settings.compounding.profitTargetPct}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Risk %</div>
          <div className="mt-1 text-2xl font-semibold text-white">
            {settings.compounding.riskPctOfBalance}%
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-white/60">Locked Profit</div>
            <div className="mt-1 text-lg font-semibold text-emerald-300">${lockedTotal.toFixed(2)}</div>
            <div className="text-xs text-white/50">Withdrawn total: ${withdrawn.toFixed(2)}</div>
          </div>
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
            disabled={lockedTotal <= 0}
            onClick={() => withdrawLocked()}
          >
            Withdraw locked profits
          </button>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${Math.min(100, (lockedTotal / Math.max(1, projected)) * 100)}%` }}
          />
        </div>
      </div>

      <RiskControls />
      <CompoundingTable />
    </div>
  )
}
