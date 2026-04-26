"use client"

import { useMemo, useState } from "react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useBotStore } from "@/store/botStore"

type BacktestApiResult =
  | { ok: true; data: any }
  | { ok: false; error: string }

export default function BacktesterPage() {
  const settings = useBotStore((s) => s.settings)
  const [symbol, setSymbol] = useState<string>(settings.symbol)
  const [timeframe, setTimeframe] = useState<"4h" | "1d">(settings.timeframe === "1d" ? "1d" : "4h")
  const [rangeDays, setRangeDays] = useState<number>(90)
  const [initialBalance, setInitialBalance] = useState<number>(settings.capital.initialCapitalUsd)
  const [riskPercent, setRiskPercent] = useState<number>(settings.compounding.riskPctOfBalance)
  const [leverage, setLeverage] = useState<number>(settings.risk.leverage)
  const [threshold, setThreshold] = useState<number>(settings.minSetupScore)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any | null>(null)

  const equityData = useMemo(() => {
    const curve: { time: number; equity: number }[] = Array.isArray(result?.equityCurve) ? result.equityCurve : []
    return curve.map((p) => ({ time: p.time, equity: p.equity }))
  }, [result])

  const onRun = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    const endTimeMs = Date.now()
    const startTimeMs = endTimeMs - Math.max(1, rangeDays) * 24 * 60 * 60 * 1000

    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          startTimeMs,
          endTimeMs,
          initialBalance,
          riskPercent,
          leverage,
          targetScoreThreshold: threshold,
          settings
        })
      })
      const json = (await res.json()) as BacktestApiResult
      if (!json.ok) {
        setError(json.error || "Backtest failed")
        return
      }
      setResult(json.data)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Backtest failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Backtester</div>
        <div className="text-sm text-white/60">Run historical walk-forward tests using your current strategy settings</div>
      </div>

      <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 lg:grid-cols-4">
        <Field label="Symbol">
          <input
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </Field>
        <Field label="Timeframe">
          <select
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value === "1d" ? "1d" : "4h")}
          >
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </Field>
        <Field label="Range">
          <select
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={String(rangeDays)}
            onChange={(e) => setRangeDays(Number(e.target.value))}
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 180 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </Field>
        <Field label="Min Score">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </Field>

        <Field label="Initial Balance (USD)">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
          />
        </Field>
        <Field label="Risk % / Trade">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={riskPercent}
            onChange={(e) => setRiskPercent(Number(e.target.value))}
          />
        </Field>
        <Field label="Leverage">
          <input
            type="number"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
          />
        </Field>
        <div className="flex items-end">
          <button
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black hover:bg-brand/90 disabled:opacity-60"
            disabled={loading}
            onClick={() => void onRun()}
          >
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div> : null}

      {result ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card title="Trades" value={String(result.totalTrades ?? "0")} />
            <Card title="Win Rate" value={`${Number(result.winRate ?? 0) * 100}%`} />
            <Card title="Profit Factor" value={String(result.profitFactor ?? "0")} />
            <Card title="Max DD" value={`${String(result.maxDrawdown ?? "0")}%`} />
            <Card title="Return" value={`${String(result.returnPercent ?? "0")}%`} />
          </div>

          <div className="h-72 w-full rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-2 text-sm font-semibold text-white">Equity Curve (Backtest)</div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
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
                  />
                  <Line type="monotone" dataKey="equity" stroke="#D4A017" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-2 text-sm font-semibold text-white">Filter Performance</div>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-white/70">
                  <tr>
                    <th className="px-3 py-2">Filter</th>
                    <th className="px-3 py-2">WR with</th>
                    <th className="px-3 py-2">WR without</th>
                    <th className="px-3 py-2">Impact</th>
                    <th className="px-3 py-2">Reco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(Array.isArray(result.filterPerformance) ? result.filterPerformance : []).slice(0, 12).map((r: any) => (
                    <tr key={String(r.filter)}>
                      <td className="px-3 py-2 text-white/80">{String(r.filter)}</td>
                      <td className="px-3 py-2 text-white/80">{`${Math.round(Number(r.winRateWith ?? 0) * 100)}%`}</td>
                      <td className="px-3 py-2 text-white/80">{`${Math.round(Number(r.winRateWithout ?? 0) * 100)}%`}</td>
                      <td className="px-3 py-2 text-white/80">{`${Math.round(Number(r.impact ?? 0) * 100)}%`}</td>
                      <td className="px-3 py-2 text-white/80">{String(r.recommendation ?? "—")}</td>
                    </tr>
                  ))}
                  {!Array.isArray(result.filterPerformance) || result.filterPerformance.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-white/60" colSpan={5}>
                        No filter stats yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Field(opts: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-white/60">{opts.label}</div>
      {opts.children}
    </div>
  )
}

function Card(opts: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{opts.title}</div>
      <div className="mt-1 text-lg font-semibold text-white">{opts.value}</div>
    </div>
  )
}
