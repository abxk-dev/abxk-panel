"use client"

import { useEffect, useMemo, useState } from "react"
import { useBotStore } from "@/store/botStore"
import { LiquidationHeatmapWidget } from "@/components/LiquidationHeatmap"

type MonitorApi = {
  ok: boolean
  data?: {
    health?: any
    monitor?: any
    snapshot?: any
  }
}

export default function MarketMonitorPage() {
  const [api, setApi] = useState<MonitorApi | null>(null)
  const marketRegime = useBotStore((s) => s.marketRegime)
  const corr = useBotStore((s) => s.lastCorrelation)
  const settings = useBotStore((s) => s.settings)

  useEffect(() => {
    let mounted = true
    const tick = async () => {
      const res = await fetch("/api/monitor/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      if (!mounted) return
      setApi(res)
    }
    void tick()
    const t = window.setInterval(() => void tick(), 15_000)
    return () => {
      mounted = false
      window.clearInterval(t)
    }
  }, [])

  const health = api?.data?.health
  const monitor = api?.data?.monitor

  const healthLabel = useMemo(() => {
    const s = String(health?.state ?? "UNKNOWN")
    if (s === "HEALTHY") return "🟢 All systems healthy"
    if (s === "DEGRADED") return "🟡 Degraded"
    if (s === "CRITICAL") return "🔴 Critical"
    return "⚪ Unknown"
  }, [health?.state])

  const flags = monitor?.flags ?? {}

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-white">Market Monitor</div>
        <div className="text-sm text-white/60">Regime • Correlation • Health • News • Alerts</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Regime</div>
          <div className="mt-1 text-lg font-semibold text-white">{marketRegime?.regime?.replaceAll("_", " ") ?? "—"}</div>
          <div className="mt-2 text-sm text-white/70">
            ADX: {marketRegime?.adx14 ?? "—"} | Band Width: {marketRegime?.bbWidthPct ?? "—"}%
          </div>
          {marketRegime?.regime === "VOLATILE" ? (
            <div className="mt-1 text-sm text-orange-200">
              {marketRegime.volatileMode === "SKIP"
                ? "⚠️ Volatile: skip trades"
                : marketRegime.volatileMode === "REDUCE_50"
                  ? "⚠️ Volatile: reduced size (50%)"
                  : "⚠️ Volatile: caution"}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Correlation</div>
          <div className="mt-1 text-lg font-semibold text-white">
            {corr?.blocked ? "🚫 Blocked" : corr ? "✅ OK" : "—"}
          </div>
          <div className="mt-2 text-sm text-white/70">
            Score delta: {corr ? (corr.scoreDelta >= 0 ? "+" : "") + String(corr.scoreDelta) : "—"}
          </div>
          <div className="mt-1 text-sm text-white/70">{corr?.blockReason ?? corr?.warnings?.[0] ?? "—"}</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Exchange Health</div>
          <div className="mt-1 text-lg font-semibold text-white">{healthLabel}</div>
          <div className="mt-2 text-sm text-white/70">
            API latency: {typeof health?.apiLatencyMs === "number" ? `${Math.round(health.apiLatencyMs)}ms` : "—"}
          </div>
          <div className="text-sm text-white/70">WS: {health?.wsConnected ? "Connected" : "Disconnected"}</div>
          <div className="text-sm text-white/70">
            Balance: {typeof health?.balanceUsd === "number" ? `$${health.balanceUsd.toFixed(2)}` : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">Monitor Flags</div>
          <div className="mt-2 text-sm text-white/80">
            Pause all: {flags.pauseAllUntil ? `until ${new Date(flags.pauseAllUntil).toUTCString()}` : "—"}
          </div>
          <div className="text-sm text-white/80">
            Longs blocked: {flags.longsBlockedUntil ? `until ${new Date(flags.longsBlockedUntil).toUTCString()}` : "—"}
          </div>
          <div className="text-sm text-white/80">
            Shorts blocked: {flags.shortsBlockedUntil ? `until ${new Date(flags.shortsBlockedUntil).toUTCString()}` : "—"}
          </div>
          <div className="text-sm text-white/60">Note: {flags.note ?? "—"}</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-white/60">News Blackout</div>
          <div className="mt-1 text-sm text-white/80">
            {monitor?.news?.state === "ACTIVE"
              ? `ACTIVE — ${monitor.news.event?.title ?? "Event"}`
              : monitor?.news?.state === "UPCOMING"
                ? `UPCOMING — ${monitor.news.event?.title ?? "Event"}`
                : "CLEAR"}
          </div>
          <div className="mt-2 text-sm text-white/70">
            {monitor?.news?.state === "ACTIVE"
              ? `Ends: ${new Date(monitor.news.endsAt).toUTCString()}`
              : monitor?.news?.state === "UPCOMING"
                ? `Starts: ${new Date(monitor.news.startsAt).toUTCString()}`
                : "—"}
          </div>
        </div>
      </div>

      {settings.features.liquidationHeatmap ? <LiquidationHeatmapWidget /> : null}
    </div>
  )
}
