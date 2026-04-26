"use client"

import { useMemo, useState } from "react"
import { addDays, format } from "date-fns"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts"
import { useBotStore } from "@/store/botStore"
import { generateCompoundingPlan, getActiveLevel } from "@/lib/compounding"

type ScenarioKey = "optimistic" | "realistic" | "pessimistic"

type Scenario = {
  key: ScenarioKey
  label: string
  winRatePct: number
  daysToLevel30: number
  finishDate: string
  tradesNeeded: number
  curve: { day: number; balance: number }[]
}

export function ProjectionCalculator() {
  const settings = useBotStore((s) => s.settings)
  const completed = useBotStore((s) => s.completedLevels)
  const equity = useBotStore((s) => s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd)

  const activeLevel = useMemo(() => getActiveLevel(settings.compounding.levels, completed), [settings.compounding.levels, completed])

  const [startLevel, setStartLevel] = useState<number>(activeLevel)
  const [currentBalance, setCurrentBalance] = useState<number>(equity)
  const [dailyProb, setDailyProb] = useState<number>(80)
  const [winRate, setWinRate] = useState<number>(60)
  const [profitTargetPct, setProfitTargetPct] = useState<number>(settings.compounding.profitTargetPct)

  const scenarios = useMemo(() => {
    const build = (key: ScenarioKey, label: string, wr: number): Scenario => {
      const { days, trades, curve } = project({
        startLevel,
        currentBalance,
        winRatePct: wr,
        dailyTradeProbabilityPct: dailyProb,
        profitTargetPct
      })
      return {
        key,
        label,
        winRatePct: wr,
        daysToLevel30: days,
        finishDate: format(addDays(new Date(), days), "dd/MM/yyyy"),
        tradesNeeded: trades,
        curve
      }
    }

    const optimisticWr = clamp(winRate + 10, 30, 80)
    const realisticWr = clamp(winRate, 30, 80)
    const pessimisticWr = clamp(winRate - 10, 30, 80)

    return [
      build("optimistic", "Optimistic", optimisticWr),
      build("realistic", "Realistic", realisticWr),
      build("pessimistic", "Pessimistic", pessimisticClamp(pessimisticWr))
    ]
  }, [startLevel, currentBalance, dailyProb, winRate, profitTargetPct])

  const chartData = useMemo(() => {
    const maxLen = Math.max(...scenarios.map((s) => s.curve.length))
    const rows: any[] = []
    for (let i = 0; i < maxLen; i += 1) {
      const day = scenarios[0]?.curve[i]?.day ?? 0
      rows.push({
        day,
        optimistic: scenarios[0]?.curve[i]?.balance,
        realistic: scenarios[1]?.curve[i]?.balance,
        pessimistic: scenarios[2]?.curve[i]?.balance
      })
    }
    return rows
  }, [scenarios])

  const milestones = useMemo(() => {
    const plan = generateCompoundingPlan(settings)
    const marks = [5, 10, 15, 20, 25, 30]
    const out: { level: number; balance: number }[] = []
    for (const m of marks) {
      const row = plan.find((p) => p.level === m)
      if (row) out.push({ level: m, balance: row.endingBalanceUsd })
    }
    return out
  }, [settings])

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-5">
        <Field label="Starting level">
          <input
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            type="number"
            min={1}
            max={30}
            value={startLevel}
            onChange={(e) => setStartLevel(clamp(Number(e.target.value), 1, 30))}
          />
        </Field>
        <Field label="Current balance ($)">
          <input
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            type="number"
            min={0}
            step="0.01"
            value={Number.isFinite(currentBalance) ? currentBalance : 0}
            onChange={(e) => setCurrentBalance(Math.max(0, Number(e.target.value)))}
          />
        </Field>
        <Field label={`Daily trade probability (${dailyProb}%)`}>
          <input
            className="w-full"
            type="range"
            min={0}
            max={100}
            value={dailyProb}
            onChange={(e) => setDailyProb(clamp(Number(e.target.value), 0, 100))}
          />
        </Field>
        <Field label={`Win rate (${winRate}%)`}>
          <input
            className="w-full"
            type="range"
            min={30}
            max={80}
            value={winRate}
            onChange={(e) => setWinRate(clamp(Number(e.target.value), 30, 80))}
          />
        </Field>
        <Field label={`Profit target per level (${profitTargetPct}%)`}>
          <input
            className="w-full"
            type="range"
            min={10}
            max={50}
            value={profitTargetPct}
            onChange={(e) => setProfitTargetPct(clamp(Number(e.target.value), 10, 50))}
          />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.key} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">{s.label}</div>
            <div className="mt-1 text-lg font-semibold text-white">Level 30 in: {s.daysToLevel30} days</div>
            <div className="mt-1 text-sm text-white/70">Finish date: {s.finishDate}</div>
            <div className="text-sm text-white/70">Trades needed: ~{s.tradesNeeded}</div>
            <div className="mt-2 text-xs text-white/50">WR: {s.winRatePct}%</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 text-sm font-semibold text-white">Projection Curves</div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="day" stroke="rgba(255,255,255,0.5)" />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
              />
              <Tooltip
                formatter={(v: any) => `$${Number(v).toFixed(2)}`}
                labelFormatter={(l) => `Day ${l}`}
              />
              <Line type="monotone" dataKey="optimistic" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="realistic" stroke="#D4A017" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pessimistic" stroke="#ef4444" strokeWidth={2} dot={false} />
              {milestones.map((m) => (
                <ReferenceLine
                  key={m.level}
                  y={m.balance}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 4"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export function project(opts: {
  startLevel: number
  currentBalance: number
  dailyTradeProbabilityPct: number
  winRatePct: number
  profitTargetPct: number
}): { days: number; trades: number; curve: { day: number; balance: number }[] } {
  const start = clamp(Math.floor(opts.startLevel), 1, 30)
  const prob = clamp(opts.dailyTradeProbabilityPct, 0, 100) / 100
  const wr = clamp(opts.winRatePct, 1, 99) / 100
  const target = Math.max(0, opts.profitTargetPct) / 100

  const expectedTradesPerLevel = Math.ceil(1 / wr)
  const daysPerLevel = prob > 0 ? expectedTradesPerLevel / prob : Infinity

  let day = 0
  let balance = Math.max(0, opts.currentBalance)
  let trades = 0
  const curve: { day: number; balance: number }[] = [{ day: 0, balance }]

  for (let lvl = start; lvl < 30; lvl += 1) {
    day += daysPerLevel
    trades += expectedTradesPerLevel
    balance = balance * (1 + target)
    curve.push({ day: Math.ceil(day), balance })
  }

  return { days: Number.isFinite(day) ? Math.ceil(day) : 0, trades, curve }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function pessimisticClamp(wr: number): number {
  return clamp(wr, 30, 80)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-white/60">{label}</div>
      {children}
    </div>
  )
}
