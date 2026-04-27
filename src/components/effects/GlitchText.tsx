"use client"

import { useEffect, useMemo, useState } from "react"

type VisualEffectsSettings = {
  matrixBackground: boolean
  floatingBitcoin: boolean
  dataStreams: boolean
  hackedScreen: boolean
  glitchText: boolean
  intensity: "LOW" | "MED" | "HIGH"
}

const KEY = "visual_effects_settings"

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

export function GlitchText({
  text,
  fontSize = 18,
  color = "#00FF88",
  glitchInterval = 5000
}: {
  text: string
  fontSize?: number
  color?: string
  glitchInterval?: number
}) {
  const [display, setDisplay] = useState(text)
  const [isGlitching, setIsGlitching] = useState(false)
  const [cfg, setCfg] = useState<VisualEffectsSettings>(() => readSettings())

  const enabled = cfg.glitchText

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

  const CHARS = useMemo(() => "₿@#$%^&!<>[]{}|?/~░▒▓", [])

  useEffect(() => {
    setDisplay(text)
  }, [text])

  useEffect(() => {
    if (!enabled) return
    const trigger = window.setInterval(() => {
      setIsGlitching(true)
      let count = 0
      const glitch = window.setInterval(() => {
        setDisplay(
          text
            .split("")
            .map((c) => (Math.random() > 0.5 ? CHARS[Math.floor(Math.random() * CHARS.length)]! : c))
            .join("")
        )
        count += 1
        if (count > 8) {
          window.clearInterval(glitch)
          setDisplay(text)
          setIsGlitching(false)
        }
      }, 50)
    }, glitchInterval)

    return () => window.clearInterval(trigger)
  }, [text, glitchInterval, enabled, CHARS])

  return (
    <span
      style={{
        fontFamily: "'Orbitron', monospace",
        fontSize,
        color,
        textShadow: enabled
          ? isGlitching
            ? `3px 0 #FF0044, -3px 0 #00FFFF, 0 0 20px ${color}`
            : `0 0 10px ${color}`
          : "none",
        letterSpacing: 3,
        transition: "text-shadow 0.1s",
        display: "inline-block",
        transform: enabled && isGlitching ? "skew(-2deg)" : "none"
      }}
    >
      {enabled ? display : text}
    </span>
  )
}

