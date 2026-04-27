"use client"

import { useEffect, useMemo, useState } from "react"
import { useBotStore } from "@/store/botStore"
import { MusicPlayer } from "@/components/MusicPlayer"
import { GlitchText } from "@/components/effects/GlitchText"

type HeaderHealth = {
  apiLatencyMs?: number
  wsConnected?: boolean
  balanceUsd?: number
}

export function CyberHeader() {
  const paused = useBotStore((s) => s.paused)
  const setPaused = useBotStore((s) => s.setPaused)

  const [health, setHealth] = useState<HeaderHealth>({})
  const [toggling, setToggling] = useState(false)
  const [toggleIntent, setToggleIntent] = useState<"PAUSE" | "RESUME" | null>(null)

  useEffect(() => {
    let mounted = true
    const tick = async () => {
      try {
        const res = await fetch("/api/monitor/status", { cache: "no-store" })
        const json = (await res.json()) as any
        const h = json?.data?.health
        if (!mounted || !h) return
        setHealth({
          apiLatencyMs: typeof h.apiLatencyMs === "number" ? h.apiLatencyMs : undefined,
          wsConnected: typeof h.wsConnected === "boolean" ? h.wsConnected : undefined,
          balanceUsd: typeof h.balanceUsd === "number" ? h.balanceUsd : undefined
        })
      } catch {
        return
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 30_000)
    return () => {
      mounted = false
      window.clearInterval(t)
    }
  }, [])

  const apiText = useMemo(() => {
    if (typeof health.apiLatencyMs === "number") return `${Math.round(health.apiLatencyMs)}ms`
    return "—"
  }, [health.apiLatencyMs])

  const wsText = useMemo(() => {
    if (typeof health.wsConnected === "boolean") return health.wsConnected ? "LIVE" : "DOWN"
    return "—"
  }, [health.wsConnected])

  const balText = useMemo(() => {
    if (typeof health.balanceUsd === "number") return `$${health.balanceUsd.toFixed(2)}`
    return "—"
  }, [health.balanceUsd])

  return (
    <header
      style={{
        background: "linear-gradient(90deg,#000,#050510,#000)",
        borderBottom: "1px solid #00FF8830",
        boxShadow: "0 1px 30px #00FF8815",
        padding: "0 24px",
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div
          style={{
            width: 44,
            height: 44,
            border: "1px solid var(--neon-green)",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "var(--glow-green)",
            animation: "pulseGlow 2s infinite",
            background: "#001a0d",
            position: "relative"
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: 2,
              width: 8,
              height: 8,
              borderTop: "1px solid var(--neon-green)",
              borderLeft: "1px solid var(--neon-green)"
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 2,
              right: 2,
              width: 8,
              height: 8,
              borderBottom: "1px solid var(--neon-green)",
              borderRight: "1px solid var(--neon-green)"
            }}
          />
          <span
            style={{
              fontSize: 20,
              color: "var(--neon-green)",
              textShadow: "var(--glow-green)",
              fontFamily: "var(--font-cyber)"
            }}
          >
            ▶
          </span>
        </div>
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--neon-green)",
              textShadow: "var(--glow-green)",
              letterSpacing: 3
            }}
          >
            <GlitchText text="ABXK-BOT" fontSize={18} color="#00FF88" glitchInterval={4000} />
            <span style={{ animation: "blink 1s infinite", marginLeft: 2 }}>█</span>
          </div>
          <div style={{ fontFamily: "var(--font-cyber)", fontSize: 10, color: "#00FF8860", letterSpacing: 2 }}>
            &gt; CRYPTO_TERMINAL_v2.0_ONLINE
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: "#000",
          border: "1px solid #00FF8820",
          borderRadius: 4,
          padding: "6px 16px",
          fontFamily: "var(--font-cyber)",
          fontSize: 11
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: paused ? "var(--neon-yellow)" : "var(--neon-green)",
              boxShadow: paused ? "0 0 6px var(--neon-yellow)" : "0 0 6px var(--neon-green)",
              animation: "pulseGlow 1.5s infinite"
            }}
          />
          <span style={{ color: paused ? "var(--neon-yellow)" : "var(--neon-green)" }}>{paused ? "SYS_PAUSED" : "SYS_ONLINE"}</span>
        </div>
        <span style={{ color: "#00FF8840" }}>|</span>
        <span style={{ color: "#00FF8880" }}>
          API: <span style={{ color: "var(--neon-green)" }}>{apiText}</span>
        </span>
        <span style={{ color: "#00FF8840" }}>|</span>
        <span style={{ color: "#00FF8880" }}>
          WS: <span style={{ color: "var(--neon-green)" }}>{wsText}</span>
        </span>
        <span style={{ color: "#00FF8840" }}>|</span>
        <span style={{ color: "#00FF8880" }}>
          BAL: <span style={{ color: "var(--neon-yellow)" }}>{balText}</span>
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MusicPlayer />
        <CyberClock />
        <BotToggleButton
          paused={paused}
          toggling={toggling}
          intent={toggleIntent}
          onToggle={async (nextPaused) => {
            setToggling(true)
            setToggleIntent(nextPaused ? "PAUSE" : "RESUME")
            try {
              if (nextPaused) {
                await fetch("/api/bot/pause", { method: "POST" }).catch(() => undefined)
                setPaused(true)
              } else {
                await fetch("/api/bot/resume", { method: "POST" }).catch(() => undefined)
                setPaused(false)
                await fetch("/api/bot/scan", { method: "POST" }).catch(() => undefined)
                await useBotStore.getState().runBotCycle().catch(() => undefined)
              }
            } finally {
              setToggling(false)
              setToggleIntent(null)
            }
          }}
        />
      </div>
    </header>
  )
}

function CyberClock() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = window.setInterval(tick, 1_000)
    return () => window.clearInterval(t)
  }, [])
  const d = now === null ? null : new Date(now)
  const hh = d ? String(d.getUTCHours()).padStart(2, "0") : "--"
  const mm = d ? String(d.getUTCMinutes()).padStart(2, "0") : "--"
  const ss = d ? String(d.getUTCSeconds()).padStart(2, "0") : "--"
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#000",
        border: "1px solid #00FF8820",
        borderRadius: 4,
        padding: "6px 12px",
        fontFamily: "var(--font-cyber)",
        fontSize: 11,
        letterSpacing: 2,
        color: "var(--neon-green)"
      }}
    >
      <span style={{ color: "#00FF8860" }}>UTC</span>
      <span style={{ textShadow: "var(--glow-green)" }}>
        {hh}:{mm}:{ss}
      </span>
    </div>
  )
}

function BotToggleButton(props: {
  paused: boolean
  toggling: boolean
  intent?: "PAUSE" | "RESUME" | null
  onToggle: (paused: boolean) => Promise<void>
}) {
  return (
    <button
      type="button"
      disabled={props.toggling}
      onClick={() => void props.onToggle(!props.paused)}
      style={{
        background: props.paused ? "rgba(255,215,0,0.12)" : "rgba(0,255,136,0.12)",
        border: `1px solid ${props.paused ? "rgba(255,215,0,0.35)" : "rgba(0,255,136,0.35)"}`,
        borderRadius: 4,
        color: props.paused ? "var(--neon-yellow)" : "var(--neon-green)",
        padding: "6px 12px",
        cursor: props.toggling ? "default" : "pointer",
        fontFamily: "var(--font-cyber)",
        fontSize: 11,
        letterSpacing: 2,
        textTransform: "uppercase",
        boxShadow: props.paused ? "0 0 10px rgba(255,215,0,0.2)" : "var(--glow-green)",
        opacity: props.toggling ? 0.6 : 1
      }}
    >
      {props.toggling ? (props.intent === "RESUME" ? "▶ RESUMING…" : "⏸ PAUSING…") : props.paused ? "▶ RESUME" : "⏸ PAUSE"}
    </button>
  )
}
