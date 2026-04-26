"use client"

import { useMemo } from "react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { useBotStore } from "@/store/botStore"

export function EquityCurve() {
  const curve = useBotStore((s) => s.equityCurve)

  const data = useMemo(
    () =>
      [...curve]
        .slice()
        .reverse()
        .map((p) => ({
          time: p.time,
          equity: p.equity
        })),
    [curve]
  )

  return (
    <div className="h-72 w-full rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-2 text-sm font-semibold text-white">Equity Curve</div>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis
              dataKey="time"
              tickFormatter={(v) => new Date(v as number).toLocaleDateString()}
              stroke="rgba(255,255,255,0.25)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.25)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.12)" }}
              labelFormatter={(v) => new Date(v as number).toLocaleString()}
            />
            <Line type="monotone" dataKey="equity" stroke="#D4A017" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

