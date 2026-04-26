"use client"

import { generateCompoundingPlan, getActiveLevel, getProgress } from "@/lib/compounding"
import { useBotStore } from "@/store/botStore"

export function CompoundingTable() {
  const settings = useBotStore((s) => s.settings)
  const completed = useBotStore((s) => s.completedLevels)
  const setCompletedLevel = useBotStore((s) => s.setCompletedLevel)

  const plan = generateCompoundingPlan(settings)
  const activeLevel = getActiveLevel(settings.compounding.levels, completed)
  const progress = getProgress(settings.compounding.levels, completed)
  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-white">Progress</div>
          <div className="text-xs text-white/60">
            {progress.done}/{progress.total} levels complete
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/40 text-xs uppercase text-white/60">
            <tr>
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">Balance</th>
              <th className="px-3 py-2">Profit Target</th>
              <th className="px-3 py-2">Ending Balance</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-black/20">
            {plan.map((row) => {
              const isActive = row.level === activeLevel
              const isDone = completed.includes(row.level)
              return (
                <tr key={row.level} className={isActive ? "bg-brand/10" : undefined}>
                  <td className="px-3 py-2 font-medium text-white">{row.level}</td>
                  <td className="px-3 py-2 text-white/80">${row.balanceUsd.toLocaleString()}</td>
                  <td className="px-3 py-2 text-white/80">${row.profitTargetUsd.toLocaleString()}</td>
                  <td className="px-3 py-2 text-white/80">${row.endingBalanceUsd.toLocaleString()}</td>
                  <td className="px-3 py-2 text-white/80">${row.riskUsd.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={(e) => setCompletedLevel(row.level, e.target.checked)}
                      />
                      {isDone ? "Completed" : isActive ? "Active" : "Pending"}
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

