"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type VisualEffectsSettings = {
  matrixBackground: boolean
  floatingBitcoin: boolean
  dataStreams: boolean
  hackedScreen: boolean
  glitchText: boolean
  intensity: "LOW" | "MED" | "HIGH"
}

const KEY = "visual_effects_settings"
const GLITCH_CHARS = "₿@#$%^&*!<>[]{}|\\?/~`░▒▓█▄▀■□●○"

function readSettings(): VisualEffectsSettings {
  const fallback: VisualEffectsSettings = {
    matrixBackground: true,
    floatingBitcoin: true,
    dataStreams: true,
    hackedScreen: true,
    glitchText: true,
    intensity: "MED"
  }
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<VisualEffectsSettings>
    const intensity: VisualEffectsSettings["intensity"] =
      parsed.intensity === "LOW" || parsed.intensity === "HIGH" || parsed.intensity === "MED" ? parsed.intensity : "MED"
    return {
      matrixBackground: Boolean(parsed.matrixBackground ?? fallback.matrixBackground),
      floatingBitcoin: Boolean(parsed.floatingBitcoin ?? fallback.floatingBitcoin),
      dataStreams: Boolean(parsed.dataStreams ?? fallback.dataStreams),
      hackedScreen: Boolean(parsed.hackedScreen ?? fallback.hackedScreen),
      glitchText: Boolean(parsed.glitchText ?? fallback.glitchText),
      intensity
    }
  } catch {
    return fallback
  }
}

export function HackedScreen() {
  const [show, setShow] = useState(false)
  const [phase, setPhase] = useState<"glitch" | "hacked" | "recovering" | "hidden">("hidden")
  const [glitchText, setGlitchText] = useState("ABXK-BOT")
  const [cfg, setCfg] = useState<VisualEffectsSettings>(() => readSettings())

  const scheduleRef = useRef<number | null>(null)
  const firstTimerRef = useRef<number | null>(null)
  const glitchIntervalRef = useRef<number | null>(null)
  const phaseTimeoutRef = useRef<number | null>(null)
  const phaseTimeout2Ref = useRef<number | null>(null)

  const glitchString = useCallback((str: string): string => {
    return str
      .split("")
      .map((c) => (Math.random() > 0.6 ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]! : c))
      .join("")
  }, [])

  const clearTimers = useCallback(() => {
    if (scheduleRef.current !== null) window.clearTimeout(scheduleRef.current)
    if (firstTimerRef.current !== null) window.clearTimeout(firstTimerRef.current)
    if (glitchIntervalRef.current !== null) window.clearInterval(glitchIntervalRef.current)
    if (phaseTimeoutRef.current !== null) window.clearTimeout(phaseTimeoutRef.current)
    if (phaseTimeout2Ref.current !== null) window.clearTimeout(phaseTimeout2Ref.current)
    scheduleRef.current = null
    firstTimerRef.current = null
    glitchIntervalRef.current = null
    phaseTimeoutRef.current = null
    phaseTimeout2Ref.current = null
  }, [])

  const triggerHack = useCallback(() => {
    clearTimers()
    setShow(true)
    setPhase("glitch")
    let glitchCount = 0
    glitchIntervalRef.current = window.setInterval(() => {
      setGlitchText(glitchString("ABXK-BOT SYSTEM"))
      glitchCount += 1
      if (glitchCount > 15) {
        if (glitchIntervalRef.current !== null) window.clearInterval(glitchIntervalRef.current)
        glitchIntervalRef.current = null
        setPhase("hacked")
        phaseTimeoutRef.current = window.setTimeout(() => {
          setPhase("recovering")
          phaseTimeout2Ref.current = window.setTimeout(() => {
            setShow(false)
            setPhase("hidden")
            setGlitchText("ABXK-BOT")
          }, 1000)
        }, 2500)
      }
    }, 60)
  }, [clearTimers, glitchString])

  useEffect(() => {
    const onCustom = () => setCfg(readSettings())
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return
      setCfg(readSettings())
    }
    window.addEventListener("visual_effects_settings", onCustom as EventListener)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("visual_effects_settings", onCustom as EventListener)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    clearTimers()
    if (!cfg.hackedScreen) return

    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    if (reducedMotion) return

    const minMs = 2 * 60 * 60 * 1000
    const maxMs = 4 * 60 * 60 * 1000

    const scheduleNext = () => {
      const delay = minMs + Math.random() * (maxMs - minMs)
      scheduleRef.current = window.setTimeout(() => {
        triggerHack()
        scheduleNext()
      }, delay)
    }

    firstTimerRef.current = window.setTimeout(() => triggerHack(), 30_000)
    scheduleNext()

    return () => clearTimers()
  }, [cfg.hackedScreen, clearTimers, triggerHack])

  if (!show || !cfg.hackedScreen) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Share Tech Mono', monospace",
        overflow: "hidden"
      }}
    >
      {phase === "glitch" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 16,
            animation: "glitchFlicker 0.06s infinite"
          }}
        >
          <div
            style={{
              fontSize: 48,
              color: "#00FF88",
              textShadow: "3px 0 #FF0044, -3px 0 #0088FF",
              letterSpacing: 6,
              animation: "glitchShift 0.08s infinite"
            }}
          >
            {glitchText}
          </div>
          <div
            style={{
              fontSize: 16,
              color: "#FF0044",
              letterSpacing: 4,
              opacity: 0.8
            }}
          >
            ⚠ INTRUSION DETECTED ⚠
          </div>
        </div>
      ) : null}

      {phase === "hacked" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.97)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column"
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "#FF0044",
              boxShadow: "0 0 20px #FF0044",
              animation: "scanDown 0.8s linear infinite"
            }}
          />

          {(["topLeft", "topRight", "botLeft", "botRight"] as const).map((pos) => (
            <div
              key={pos}
              style={{
                position: "absolute",
                ...(pos.includes("top") ? { top: 40 } : { bottom: 40 }),
                ...(pos.includes("Left") ? { left: 40 } : { right: 40 }),
                width: 60,
                height: 60,
                borderTop: pos.includes("top") ? "3px solid #FF0044" : "none",
                borderBottom: pos.includes("bot") ? "3px solid #FF0044" : "none",
                borderLeft: pos.includes("Left") ? "3px solid #FF0044" : "none",
                borderRight: pos.includes("Right") ? "3px solid #FF0044" : "none",
                boxShadow: "0 0 10px #FF004444"
              }}
            />
          ))}

          <div
            style={{
              fontSize: "clamp(60px, 12vw, 120px)",
              fontWeight: 900,
              color: "#FF0044",
              letterSpacing: 16,
              textShadow: "0 0 30px #FF0044, 0 0 60px #FF004488, 4px 0 #00FFFF, -4px 0 #00FF88",
              animation: "hackedPulse 0.5s ease-in-out infinite alternate",
              fontFamily: "'Orbitron', monospace",
              textAlign: "center"
            }}
          >
            HACKED
          </div>

          <div
            style={{
              fontSize: 64,
              color: "#FF0044",
              textShadow: "0 0 20px #FF0044",
              marginTop: 16,
              animation: "spin 1s linear infinite"
            }}
          >
            ₿
          </div>

          <div
            style={{
              marginTop: 24,
              fontSize: 14,
              color: "#FF004499",
              letterSpacing: 4,
              textAlign: "center",
              lineHeight: 2
            }}
          >
            <div>SYSTEM COMPROMISED</div>
            <div style={{ color: "#FF004466", fontSize: 11 }}>INITIALIZING COUNTERMEASURES...</div>
          </div>

          <div
            style={{
              marginTop: 24,
              width: 300,
              height: 4,
              background: "#1a0000",
              borderRadius: 2,
              overflow: "hidden",
              border: "1px solid #FF004440"
            }}
          >
            <div
              style={{
                height: "100%",
                background: "#FF0044",
                boxShadow: "0 0 8px #FF0044",
                animation: "hackProgress 2.5s linear forwards"
              }}
            />
          </div>

          <div
            style={{
              position: "absolute",
              bottom: 60,
              left: 60,
              right: 60,
              fontSize: 10,
              color: "#FF004460",
              fontFamily: "monospace",
              lineHeight: 1.8,
              textAlign: "left"
            }}
          >
            <div>{"> BREACH DETECTED: 192.168.1.337"}</div>
            <div>{"> ACCESSING: /wallet/keys/private.dat"}</div>
            <div>{"> EXTRACTING: BTC_PRIVATE_KEY..."}</div>
            <div>{"> PAYLOAD: 0x4F2A8B9C..."}</div>
            <div style={{ color: "#FF0044" }}>{"> ████████████████ 87% COMPLETE"}</div>
          </div>
        </div>
      ) : null}

      {phase === "recovering" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 16
          }}
        >
          <div
            style={{
              fontSize: 32,
              color: "#00FF88",
              letterSpacing: 6,
              textShadow: "0 0 20px #00FF88",
              animation: "blink 0.3s infinite"
            }}
          >
            COUNTERMEASURE ACTIVATED
          </div>
          <div
            style={{
              fontSize: 48,
              color: "#00FF88",
              textShadow: "0 0 30px #00FF88",
              fontFamily: "'Orbitron', monospace"
            }}
          >
            SECURED ✓
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#00FF8860",
              letterSpacing: 3
            }}
          >
            ABXK-BOT SYSTEMS RESTORED
          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes glitchFlicker { 
          0%,100%{opacity:1} 
          50%{opacity:0.85} 
        } 
        @keyframes glitchShift { 
          0%{transform:translate(0,0) skew(0deg)} 
          20%{transform:translate(-3px,1px) skew(-1deg)} 
          40%{transform:translate(3px,-1px) skew(1deg)} 
          60%{transform:translate(-2px,2px) skew(0.5deg)} 
          80%{transform:translate(2px,-2px) skew(-0.5deg)} 
          100%{transform:translate(0,0) skew(0deg)} 
        } 
        @keyframes hackedPulse { 
          0%{opacity:1;text-shadow:0 0 30px #FF0044,4px 0 #00FFFF,-4px 0 #00FF88} 
          100%{opacity:0.85;text-shadow:0 0 60px #FF0044,6px 0 #00FFFF,-6px 0 #00FF88} 
        } 
        @keyframes scanDown { 
          0%{top:0} 
          100%{top:100%} 
        } 
        @keyframes spin { 
          from{transform:rotate(0deg)} 
          to{transform:rotate(360deg)} 
        } 
        @keyframes hackProgress { 
          0%{width:0%} 
          100%{width:100%} 
        } 
        @keyframes blink { 
          0%,100%{opacity:1} 
          50%{opacity:0.3} 
        }
      `}</style>
    </div>
  )
}
