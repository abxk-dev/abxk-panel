"use client"

import { useMemo, useState } from "react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"

type Months = 1 | 3 | 6 | 12

type GrowthData = {
  month: number
  value: number
  profit: number
  returnPercent: number
}

export function GridCalculator() {
  const [capital, setCapital] = useState(100)
  const [leverage, setLeverage] = useState(1)
  const [dailyCycles, setDailyCycles] = useState(3)
  const [compound, setCompound] = useState(true)
  const [months, setMonths] = useState<Months>(12)

  const perCycleReturnPct = 0.66
  const dailyReturnPct = perCycleReturnPct * dailyCycles * leverage
  const monthlyReturnPercent = dailyReturnPct * 30

  const without = useMemo(() => calculateCompoundGrowth(capital, monthlyReturnPercent, months, false), [capital, monthlyReturnPercent, months])
  const withComp = useMemo(() => calculateCompoundGrowth(capital, monthlyReturnPercent, months, true), [capital, monthlyReturnPercent, months])

  const chartData = useMemo(() => {
    const rows: Array<{ month: number; without: number; with: number }> = []
    for (let i = 1; i <= months; i += 1) {
      rows.push({
        month: i,
        without: without[i - 1]?.value ?? capital,
        with: withComp[i - 1]?.value ?? capital
      })
    }
    return rows
  }, [without, withComp, months, capital])

  const dailyProfitUsd = useMemo(() => (capital * dailyReturnPct) / 100, [capital, dailyReturnPct])
  const weeklyProfitUsd = dailyProfitUsd * 7
  const monthlyProfitUsd = dailyProfitUsd * 30

  const activeSeries = compound ? withComp : without

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 text-sm font-semibold text-white">Interactive Profit Calculator</div>
        <div className="grid gap-4 lg:grid-cols-6">
          <Field label={`Capital ($${capital})`}>
            <input className="w-full" type="range" min={10} max={10_000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
          </Field>
          <Field label="Leverage">
            <div className="grid grid-cols-4 gap-2">
              <Pill active={leverage === 1} label="1x" onClick={() => setLeverage(1)} />
              <Pill active={leverage === 3} label="3x" onClick={() => setLeverage(3)} />
              <Pill active={leverage === 5} label="5x" onClick={() => setLeverage(5)} />
              <Pill active={leverage === 10} label="10x" onClick={() => setLeverage(10)} />
            </div>
          </Field>
          <Field label="Daily cycles">
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Pill key={n} active={dailyCycles === n} label={`${n}`} onClick={() => setDailyCycles(n)} />
              ))}
            </div>
          </Field>
          <Field label="Compound">
            <div className="flex gap-2">
              <Pill active={!compound} label="OFF" onClick={() => setCompound(false)} />
              <Pill active={compound} label="ON" onClick={() => setCompound(true)} />
            </div>
          </Field>
          <Field label="Months">
            <div className="grid grid-cols-4 gap-2">
              <Pill active={months === 1} label="1" onClick={() => setMonths(1)} />
              <Pill active={months === 3} label="3" onClick={() => setMonths(3)} />
              <Pill active={months === 6} label="6" onClick={() => setMonths(6)} />
              <Pill active={months === 12} label="12" onClick={() => setMonths(12)} />
            </div>
          </Field>
          <Field label="Monthly return">
            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">{monthlyReturnPercent.toFixed(1)}%</div>
          </Field>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Stat title="Daily profit" value={`$${dailyProfitUsd.toFixed(2)}`} />
        <Stat title="Weekly" value={`$${weeklyProfitUsd.toFixed(2)}`} />
        <Stat title="Monthly" value={`$${monthlyProfitUsd.toFixed(2)}`} />
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 text-sm font-semibold text-white">Growth Curve</div>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.25)" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <YAxis stroke="rgba(255,255,255,0.25)" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.12)" }}
                formatter={(v) => [`$${Number(v).toLocaleString()}`, "Value"]}
              />
              <Line type="monotone" dataKey="without" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="with" stroke="#00FF88" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 text-sm font-semibold text-white">{compound ? "WITH COMPOUNDING" : "WITHOUT COMPOUNDING"}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-white/70">
            <thead className="text-xs text-white/50">
              <tr>
                <th className="py-2">Month</th>
                <th>Value</th>
                <th>Profit</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {activeSeries.map((r) => (
                <tr key={r.month} className="border-t border-white/10">
                  <td className="py-2">{r.month}</td>
                  <td>${r.value.toLocaleString()}</td>
                  <td className={r.profit >= 0 ? "text-[#00FF88]" : "text-red-300"}>{r.profit >= 0 ? "+" : ""}${r.profit.toLocaleString()}</td>
                  <td>{r.returnPercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function calculateCompoundGrowth(
  capital: number,
  monthlyReturnPercent: number,
  months: number,
  compound: boolean
): GrowthData[] {
  const results: GrowthData[] = []
  let current = capital
  for (let m = 1; m <= months; m += 1) {
    if (compound) {
      current = current * (1 + monthlyReturnPercent / 100)
    } else {
      current = capital + (capital * monthlyReturnPercent) / 100 * m
    }
    results.push({
      month: m,
      value: round2(current),
      profit: round2(current - capital),
      returnPercent: round1(((current - capital) / Math.max(0.000001, capital)) * 100)
    })
  }
  return results
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/50">{label}</div>
      {children}
    </label>
  )
}

function Pill(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
        props.active ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

