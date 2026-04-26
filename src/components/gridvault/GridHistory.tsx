"use client"

import { useMemo } from "react"
import { useGridVaultStore } from "@/lib/gridVaultState"

export function GridHistory() {
  const history = useGridVaultStore((s) => s.history)
  const clearHistory = useGridVaultStore((s) => s.clearHistory)

  const stats = useMemo(() => {
    const cycles = history.length
    const totalProfit = history.reduce((sum, r) => sum + r.profit, 0)
    const best = history.reduce((m, r) => (r.profit > m ? r.profit : m), 0)
    const avg = cycles ? totalProfit / cycles : 0
    const wins = history.filter((r) => r.profit >= 0).length
    const winRate = cycles ? (wins / cycles) * 100 : 0
    return { cycles, totalProfit, best, avg, winRate }
  }, [history])

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Total cycles" value={`${stats.cycles}`} />
        <Card title="Total profit" value={`${stats.totalProfit >= 0 ? "+" : ""}$${stats.totalProfit.toFixed(2)}`} tone={stats.totalProfit >= 0 ? "good" : "bad"} />
        <Card title="Best cycle" value={`+$${stats.best.toFixed(2)}`} tone="good" />
        <Card title="Avg cycle" value={`${stats.avg >= 0 ? "+" : ""}$${stats.avg.toFixed(2)}`} tone={stats.avg >= 0 ? "good" : "bad"} />
        <Card title="Win rate" value={`${stats.winRate.toFixed(1)}%`} />
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">GRID CYCLE HISTORY</div>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${history.length ? "bg-white/5 text-white/70 hover:text-white" : "bg-white/5 text-white/30"}`}
            onClick={clearHistory}
            disabled={!history.length}
          >
            Clear
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-white/70">
            <thead className="text-xs text-white/50">
              <tr>
                <th className="py-2">Time</th>
                <th>Type</th>
                <th>Buy Price</th>
                <th>Sell Price</th>
                <th>Profit</th>
                <th>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {history.length ? (
                history.slice(0, 300).map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="py-2">{new Date(r.time).toLocaleTimeString()}</td>
                    <td>{r.type}</td>
                    <td>${Math.round(r.buyPrice).toLocaleString()}</td>
                    <td>${Math.round(r.sellPrice).toLocaleString()}</td>
                    <td className={r.profit >= 0 ? "text-[#00FF88]" : "text-red-300"}>
                      {r.profit >= 0 ? "+" : ""}${r.profit.toFixed(2)}
                    </td>
                    <td className="text-white/80">{r.cumulative >= 0 ? "+" : ""}${r.cumulative.toFixed(2)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="py-4 text-sm text-white/50" colSpan={6}>
                    No completed cycles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Card({ title, value, tone }: { title: string; value: string; tone?: "good" | "bad" }) {
  const color =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-rose-300"
        : "text-white"
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  )
}

