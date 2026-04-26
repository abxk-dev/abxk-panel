"use client"

import { useMemo } from "react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { useGridVaultStore } from "@/lib/gridVaultState"

export function OverviewTab({ liveSymbol, livePrice }: { liveSymbol: string; livePrice?: number }) {
  const totalCapital = useGridVaultStore((s) => s.totalCapital)
  const totalProfit = useGridVaultStore((s) => s.totalProfit)
  const totalCycles = useGridVaultStore((s) => s.totalCycles)
  const spotGrids = useGridVaultStore((s) => s.spotGrids)
  const futuresGrids = useGridVaultStore((s) => s.futuresGrids)
  const profitHistory = useGridVaultStore((s) => s.profitHistory)

  const currentValue = useMemo(() => totalCapital + totalProfit, [totalCapital, totalProfit])
  const activeCount = useMemo(
    () => spotGrids.filter((g) => g.running).length + futuresGrids.filter((g) => g.running).length,
    [spotGrids, futuresGrids]
  )

  const activeRows = useMemo(() => {
    const out: Array<{
      id: string
      label: string
      range: string
      cycles: number
      profit: number
      running: boolean
    }> = []
    for (const g of spotGrids) {
      out.push({
        id: g.id,
        label: `${g.config.symbol} Spot Grid`,
        range: `$${Math.round(g.config.lowerPrice).toLocaleString()} - $${Math.round(g.config.upperPrice).toLocaleString()}`,
        cycles: g.cycles,
        profit: g.totalProfit,
        running: g.running
      })
    }
    for (const g of futuresGrids) {
      out.push({
        id: g.id,
        label: `${g.config.symbol} Futures ${g.config.leverage}x Grid`,
        range: `$${Math.round(g.config.lowerPrice).toLocaleString()} - $${Math.round(g.config.upperPrice).toLocaleString()}`,
        cycles: g.cycles,
        profit: g.totalProfit,
        running: g.running
      })
    }
    return out.slice(0, 20)
  }, [spotGrids, futuresGrids])

  const chartData = useMemo(
    () =>
      profitHistory.map((p) => ({
        time: p.time,
        value: p.value
      })),
    [profitHistory]
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Starting Capital" value={`$${totalCapital.toLocaleString()}`} />
        <Card title={`Current Value (${liveSymbol})`} value={livePrice ? `$${currentValue.toLocaleString()}` : "—"} />
        <Card title="Total Profit" value={`${totalProfit >= 0 ? "+" : ""}$${totalProfit.toLocaleString()}`} tone={totalProfit >= 0 ? "good" : "bad"} />
        <Card title="Active Grids" value={`${activeCount}`} sub={`Total cycles: ${totalCycles}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">ACTIVE GRIDS</div>
          {activeRows.length ? (
            <div className="space-y-2">
              {activeRows.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-white">{r.label}</div>
                    <div className={r.running ? "text-emerald-300" : "text-white/40"}>{r.running ? "🟢 RUNNING" : "STOPPED"}</div>
                  </div>
                  <div className="mt-1 text-xs text-white/50">Range: {r.range}</div>
                  <div className="mt-1 text-xs text-white/50">
                    Cycles: {r.cycles} | Profit: {r.profit >= 0 ? "+" : ""}${r.profit.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-white/50">No grids yet. Start a Spot or Futures grid to populate this panel.</div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 text-sm font-semibold text-white">Growth Chart</div>
          <div className="h-72">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="time"
                    tickFormatter={(v) => new Date(v as number).toLocaleDateString()}
                    stroke="rgba(255,255,255,0.25)"
                    tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                  />
                  <YAxis stroke="rgba(255,255,255,0.25)" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.12)" }}
                    labelFormatter={(v) => new Date(v as number).toLocaleString()}
                    formatter={(v) => [`$${Number(v).toLocaleString()}`, "Vault Value"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#00FF88" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/50">No data yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Card({
  title,
  value,
  sub,
  tone
}: {
  title: string
  value: string
  sub?: string
  tone?: "good" | "bad"
}) {
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
      {sub ? <div className="mt-1 text-xs text-white/40">{sub}</div> : null}
    </div>
  )
}

