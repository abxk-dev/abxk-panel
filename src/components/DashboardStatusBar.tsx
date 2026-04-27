"use client"

import { useEffect, useState } from "react"
import { useBotStore } from "@/store/botStore"

type HealthSnapshot =
  | {
      state: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CRITICAL"
      apiLatencyMs?: number
      wsConnected?: boolean
      authConfigured?: boolean
      authOk?: boolean
      balanceUsd?: number
      lastBalanceAt?: number
    }

export function DashboardStatusBar() {
  const paused = useBotStore((s) => s.paused)
  const pausedUntil = useBotStore((s) => s.pausedUntil)
  const setPaused = useBotStore((s) => s.setPaused)
  const runBotCycle = useBotStore((s) => s.runBotCycle)
  const [health, setHealth] = useState<HealthSnapshot>({ state: "UNKNOWN" })
  const [refreshing, setRefreshing] = useState(false)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    let mounted = true
    const tick = async (refresh = false) => {
      try {
        const url = refresh ? "/api/monitor/status?refresh=1" : "/api/monitor/status"
        const res = await fetch(url, { cache: "no-store" })
        const json = (await res.json()) as any
        const h = json?.data?.health
        if (!mounted) return
        if (!h) {
          setHealth({ state: "UNKNOWN" })
          return
        }
        setHealth({
          state: String(h.state ?? "UNKNOWN") as any,
          apiLatencyMs: typeof h.apiLatencyMs === "number" ? h.apiLatencyMs : undefined,
          wsConnected: Boolean(h.wsConnected),
          authConfigured: Boolean(h.authConfigured),
          authOk: typeof h.authOk === "boolean" ? h.authOk : undefined,
          balanceUsd: typeof h.balanceUsd === "number" ? h.balanceUsd : undefined,
          lastBalanceAt: typeof h.lastBalanceAt === "number" ? h.lastBalanceAt : undefined
        } as any)
      } catch {
        if (mounted) setHealth({ state: "UNKNOWN" })
      }
    }

    void tick()
    const t = window.setInterval(() => void tick(), 30_000)
    return () => {
      mounted = false
      window.clearInterval(t)
    }
  }, [])

  const pausedText =
    pausedUntil && Date.now() < pausedUntil
      ? `Paused until ${new Date(pausedUntil).toUTCString()}`
      : paused
        ? "Bot paused"
        : null

  const botStatus: "PAUSED" | "RUNNING" = paused || (pausedUntil ? Date.now() < pausedUntil : false) ? "PAUSED" : "RUNNING"

  const color =
    health.state === "HEALTHY"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : health.state === "DEGRADED"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
        : health.state === "CRITICAL"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-white/10 bg-white/5 text-white/70"

  const prefix = health.state === "HEALTHY" ? "🟢" : health.state === "DEGRADED" ? "🟡" : health.state === "CRITICAL" ? "🔴" : "⚪"

  const authLabel =
    health.authConfigured === false
      ? "Missing keys"
      : health.authOk === true
        ? "Connected"
        : health.authOk === false
          ? "Error"
          : "Checking"

  return (
    <div className={`mb-4 rounded-xl border px-4 py-2 text-xs ${color}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {prefix}{" "}
            {health.state === "HEALTHY"
              ? "All systems healthy"
              : health.state === "DEGRADED"
                ? "API slow — cautious"
                : health.state === "CRITICAL"
                  ? "Connection issues — bot paused"
                  : "System status"}
          </span>
          {typeof health.apiLatencyMs === "number" ? <span>API: {Math.round(health.apiLatencyMs)}ms</span> : null}
          <span>WS: {health.wsConnected ? "Connected" : "Disconnected"}</span>
          <span>BingX Auth: {authLabel}</span>
          {typeof health.balanceUsd === "number" ? (
            <span>
              Futures: ${health.balanceUsd.toFixed(2)}
              {typeof health.lastBalanceAt === "number" ? ` (as of ${new Date(health.lastBalanceAt).toLocaleTimeString()})` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={toggling}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
            style={{
              background: botStatus === "PAUSED" ? "rgba(255, 140, 0, 0.25)" : "rgba(0, 255, 136, 0.18)",
              borderColor: botStatus === "PAUSED" ? "rgba(255, 140, 0, 0.35)" : "rgba(0, 255, 136, 0.35)",
              color: botStatus === "PAUSED" ? "rgba(255, 215, 170, 0.95)" : "rgba(200, 255, 230, 0.95)"
            }}
            onClick={async () => {
              setToggling(true)
              try {
                if (botStatus === "PAUSED") {
                  await fetch("/api/bot/resume", { method: "POST" }).catch(() => undefined)
                  setPaused(false)
                  await fetch("/api/bot/scan", { method: "POST" }).catch(() => undefined)
                  await runBotCycle().catch(() => undefined)
                } else {
                  await fetch("/api/bot/pause", { method: "POST" }).catch(() => undefined)
                  setPaused(true)
                }
              } finally {
                setToggling(false)
              }
            }}
          >
            {toggling ? "Updating…" : botStatus === "PAUSED" ? "Bot paused" : "Bot running"}
          </button>
          <button
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-50"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                const res = await fetch("/api/monitor/status?refresh=1", { cache: "no-store" })
                const json = (await res.json()) as any
                const h = json?.data?.health
                if (h) {
                  setHealth({
                    state: String(h.state ?? "UNKNOWN") as any,
                    apiLatencyMs: typeof h.apiLatencyMs === "number" ? h.apiLatencyMs : undefined,
                    wsConnected: Boolean(h.wsConnected),
                    authConfigured: Boolean(h.authConfigured),
                    authOk: typeof h.authOk === "boolean" ? h.authOk : undefined,
                    balanceUsd: typeof h.balanceUsd === "number" ? h.balanceUsd : undefined,
                    lastBalanceAt: typeof h.lastBalanceAt === "number" ? h.lastBalanceAt : undefined
                  } as any)
                }
              } finally {
                setRefreshing(false)
              }
            }}
            type="button"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {pausedText ? <div className="text-white/80">{pausedText}</div> : null}
        </div>
      </div>
    </div>
  )
}
