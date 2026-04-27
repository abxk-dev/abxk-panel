"use client"

import { useEffect, useMemo, useRef, useState } from "react"

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

function fmtUsd(n: number | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  return `$${v.toFixed(2)}`
}

function fmtPct(n: number | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

export default function RiskManagerPage() {
  const [recovery, setRecovery] = useState<any>(null)
  const [botSnap, setBotSnap] = useState<any>(null)
  const [scalpState, setScalpState] = useState<any>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setError("")
    setRefreshing(true)
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch("/api/recovery/state", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/bot/state", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/scalping/state", { cache: "no-store" }).then((r) => r.json())
      ])
      setRecovery(r1?.data ?? null)
      setBotSnap(r2?.data ?? null)
      setScalpState(r3?.data ?? null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh failed"
      setError(msg)
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    void refreshRef.current()
    const t = window.setInterval(() => void refreshRef.current(), 20_000)
    return () => window.clearInterval(t)
  }, [])

  const exposure = useMemo(() => {
    const positions = Array.isArray(recovery?.openPositions) ? recovery.openPositions : []
    let notional = 0
    let margin = 0
    let maxLev = 0
    for (const p of positions) {
      const size = Number(p?.size ?? 0)
      const entry = Number(p?.entryPrice ?? 0)
      const lev = Number(p?.leverage ?? 0)
      if (!Number.isFinite(size) || !Number.isFinite(entry)) continue
      const posNotional = Math.abs(size) * entry
      notional += posNotional
      if (Number.isFinite(lev) && lev > 0) margin += posNotional / lev
      if (Number.isFinite(lev)) maxLev = Math.max(maxLev, lev)
    }
    return { notional, margin, maxLev, count: positions.length }
  }, [recovery])

  const drawdown = useMemo(() => {
    const eq = Number(recovery?.equity ?? botSnap?.equity)
    const start = Number(recovery?.startingEquity ?? botSnap?.startingEquity)
    if (!Number.isFinite(eq) || !Number.isFinite(start) || start <= 0) return null
    const ddPct = ((eq - start) / start) * 100
    return { equity: eq, startingEquity: start, ddPct }
  }, [recovery, botSnap])

  const winRates = useMemo(() => {
    const scalping = Number(scalpState?.stats?.winRate)
    const comp = Number(botSnap?.winRate30d)
    return {
      scalping: Number.isFinite(scalping) ? scalping : undefined,
      compounding: Number.isFinite(comp) ? comp : undefined
    }
  }, [scalpState, botSnap])

  const overallRisk = useMemo(() => {
    const dd = drawdown?.ddPct
    const exp = exposure.margin
    if (dd !== null && dd !== undefined && dd < -10) return "HIGH"
    if (exp > 100) return "HIGH"
    if (dd !== null && dd !== undefined && dd < -5) return "MEDIUM"
    if (exp > 50) return "MEDIUM"
    return "LOW"
  }, [drawdown, exposure.margin])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">🛡️ RISK MANAGER</div>
        <div className="text-sm text-white/60">Central hub for exposure, drawdown, and circuit-breaker monitoring</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="OVERALL">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="text-xs text-white/50">Overall risk</div>
              <div className={`text-lg font-semibold ${overallRisk === "HIGH" ? "text-red-400" : overallRisk === "MEDIUM" ? "text-yellow-300" : "text-[#00FF88]"}`}>
                {loading ? "Loading…" : overallRisk}
              </div>
            </div>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh Now"}
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>

          <Section title="EXPOSURE MAP">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              <div>Open positions: {loading ? "—" : exposure.count}</div>
              <div className="mt-1">Notional (est): {loading ? "—" : fmtUsd(exposure.notional)}</div>
              <div className="mt-1">Margin in use (est): {loading ? "—" : fmtUsd(exposure.margin)}</div>
              <div className="mt-1">Max leverage used: {loading ? "—" : Number.isFinite(exposure.maxLev) ? `${exposure.maxLev}x` : "—"}</div>
            </div>
          </Section>

          <Section title="CIRCUIT BREAKERS">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              <div>Daily trade count: {loading ? "—" : recovery?.dailyTradeCount ?? "—"}</div>
              <div className="mt-1">Daily PnL: {loading ? "—" : fmtUsd(recovery?.dailyPnl ?? botSnap?.dailyPnlUsd)}</div>
              <div className="mt-1">Consecutive losses: {loading ? "—" : recovery?.consecutiveLosses ?? "—"}</div>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="KEY METRICS">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">VaR (est)</div>
                <div className="text-lg font-semibold text-white">{fmtUsd(Math.max(0, exposure.margin * 0.15))}</div>
                <div className="text-xs text-white/40">Proxy: 15% of margin</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Drawdown</div>
                <div className={`text-lg font-semibold ${(drawdown?.ddPct ?? 0) >= 0 ? "text-[#00FF88]" : "text-red-400"}`}>
                  {fmtPct(drawdown?.ddPct)}
                </div>
                <div className="text-xs text-white/40">
                  {fmtUsd(drawdown?.equity)} / {fmtUsd(drawdown?.startingEquity)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Sharpe (est)</div>
                <div className="text-lg font-semibold text-white">—</div>
                <div className="text-xs text-white/40">Needs returns history</div>
              </div>
            </div>
          </Section>

          <Section title="WIN RATE BY MODULE">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              <div>Compounding (30d): {winRates.compounding !== undefined ? `${winRates.compounding.toFixed(1)}%` : "—"}</div>
              <div className="mt-1">Scalping: {winRates.scalping !== undefined ? `${winRates.scalping.toFixed(1)}%` : "—"}</div>
              <div className="mt-1">Grid: —</div>
              <div className="mt-1">Breakout: —</div>
            </div>
          </Section>

          <Section title="RECOMMENDATIONS">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              <div>
                {overallRisk === "HIGH"
                  ? "Pause live trading and reduce leverage/exposure. Tighten risk caps."
                  : overallRisk === "MEDIUM"
                    ? "Monitor exposure and consider lowering max positions."
                    : "Risk looks controlled. Keep monitoring drawdown/exposure."}
              </div>
              <div className="mt-2 text-xs text-white/50">To compute real VaR/Sharpe/MaxDD, store an equity curve snapshot each minute/day.</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
