"use client"

import { useEffect, useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useBotStore } from "@/store/botStore"
import { findLiquidationMagnets, getLiquidationHeatmap, topLevelsAroundPrice, type HeatmapData } from "@/lib/liquidationHeatmap"

export function LiquidationHeatmapWidget() {
  const settings = useBotStore((s) => s.settings)
  const openTrade = useBotStore((s) => {
    const open = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])].find((t) => t.status === "OPEN" && t.symbol === s.settings.symbol)
    return open ?? null
  })

  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.features.liquidationHeatmap) return
    let mounted = true
    const tick = async () => {
      setLoading(true)
      setError(null)
      try {
        const hm = await getLiquidationHeatmap({
          symbol: settings.symbol,
          exchange: settings.thresholds.liquidationExchange,
          range: settings.thresholds.liquidationRange
        })
        if (!mounted) return
        setHeatmap(hm)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ? String(e.message) : "Failed to fetch heatmap")
        setHeatmap(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 60_000)
    return () => {
      mounted = false
      window.clearInterval(t)
    }
  }, [settings.features.liquidationHeatmap, settings.symbol, settings.thresholds.liquidationExchange, settings.thresholds.liquidationRange])

  const chartData = useMemo(() => {
    if (!heatmap || heatmap.currentPrice <= 0) return []
    const levels = topLevelsAroundPrice({ heatmap, above: 10, below: 10 })
    return levels.map((l) => ({
      price: l.price,
      longUsd: l.price < heatmap.currentPrice ? l.longLiquidation : 0,
      shortUsd: l.price > heatmap.currentPrice ? l.shortLiquidation : 0,
      totalUsd: l.totalLiquidation
    }))
  }, [heatmap])

  const magnets = useMemo(() => {
    if (!heatmap) return []
    return findLiquidationMagnets(heatmap, openTrade?.side ?? "LONG")
  }, [heatmap, openTrade?.side])

  const tp1 = openTrade?.takeProfitPrice
  const tp2 = openTrade?.tp2Price
  const tp3 = openTrade?.tp3Price

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Liquidation Heatmap</div>
          <div className="text-xs text-white/60">
            {settings.symbol} • {settings.thresholds.liquidationExchange} • {settings.thresholds.liquidationRange}
          </div>
        </div>
        <div className="text-xs text-white/60">{loading ? "Updating…" : heatmap ? new Date(heatmap.fetchTime).toUTCString() : "—"}</div>
      </div>

      {error ? <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div> : null}

      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) => `$${fmtM(Number(v))}`}
              stroke="rgba(255,255,255,0.25)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="price"
              tickFormatter={(v) => `$${fmt0(Number(v))}`}
              stroke="rgba(255,255,255,0.25)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
              width={85}
            />
            <Tooltip
              contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.12)" }}
              formatter={(v: any, name: any) => {
                const label = name === "longUsd" ? "Long liquidations" : name === "shortUsd" ? "Short liquidations" : String(name)
                return [`$${fmtM(Number(v))}M`, label]
              }}
              labelFormatter={(v) => `Price: $${fmt0(Number(v))}`}
            />
            <Bar dataKey="longUsd" fill="rgba(16,185,129,0.7)" radius={[0, 6, 6, 0]} />
            <Bar dataKey="shortUsd" fill="rgba(244,63,94,0.7)" radius={[0, 6, 6, 0]} />

            {heatmap?.currentPrice ? (
              <ReferenceLine y={heatmap.currentPrice} stroke="rgba(59,130,246,0.9)" strokeWidth={2} />
            ) : null}

            {typeof tp1 === "number" ? <ReferenceLine y={tp1} stroke="#D4A017" strokeWidth={2} /> : null}
            {typeof tp2 === "number" ? <ReferenceLine y={tp2} stroke="rgba(212,160,23,0.7)" strokeWidth={2} /> : null}
            {typeof tp3 === "number" ? <ReferenceLine y={tp3} stroke="rgba(212,160,23,0.5)" strokeWidth={2} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60">Current Price</div>
          <div className="mt-1 text-lg font-semibold text-white">{heatmap?.currentPrice ? `$${fmt0(heatmap.currentPrice)}` : "—"}</div>
          {openTrade ? (
            <div className="mt-2 text-xs text-white/70">
              Trade: {openTrade.side} • SL ${openTrade.stopLossPrice.toFixed(2)} • TP1 ${openTrade.takeProfitPrice.toFixed(2)}
            </div>
          ) : (
            <div className="mt-2 text-xs text-white/70">No open trade</div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60">Top Magnets</div>
          <div className="mt-2 space-y-1 text-xs text-white/80">
            {magnets.length ? (
              magnets.slice(0, 3).map((m) => (
                <div key={m.rank}>
                  #{m.rank}: ${fmt0(m.price)} • ${fmtM(m.liquidationAmount)}M • {m.probability}% prob
                </div>
              ))
            ) : (
              <div className="text-white/60">—</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function fmt0(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return Math.round(n).toLocaleString()
}

function fmtM(n: number): string {
  if (!Number.isFinite(n)) return "0.0"
  return (n / 1_000_000).toFixed(1)
}

