"use client"

import { useEffect, useRef, useState } from "react"

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

export function HackBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cfg, setCfg] = useState<VisualEffectsSettings>(() => readSettings())

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
    const canvas = canvasRef.current
    if (!canvas) return
    if (!cfg.matrixBackground) return

    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    if (reducedMotion) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const intensity = cfg.intensity
    const fontSize = intensity === "LOW" ? 15 : intensity === "HIGH" ? 12 : 13
    const frameMs = intensity === "LOW" ? 95 : intensity === "HIGH" ? 38 : 55
    const trailAlpha = intensity === "LOW" ? 0.06 : intensity === "HIGH" ? 0.035 : 0.045
    const glow = intensity === "LOW" ? 4 : intensity === "HIGH" ? 10 : 7

    const chars = ["₿", "₿", "₿", "0", "1", "Ξ", "BTC", "SAT", "HASH", "TX", "0x", "◆", "■", "▲", "▼", "░", "▒", "▓"]

    let width = 0
    let height = 0
    let columns = 0
    let drops: number[] = []

    const setCanvasSize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      width = window.innerWidth
      height = window.innerHeight
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `${fontSize}px monospace`
      columns = Math.max(1, Math.floor(width / fontSize))
      drops = new Array(columns).fill(1)
    }

    setCanvasSize()

    let rafId = 0
    let lastAt = 0

    const draw = (t: number) => {
      if (t - lastAt >= frameMs) {
        lastAt = t
        ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`
        ctx.fillRect(0, 0, width, height)

        ctx.font = `${fontSize}px monospace`
        ctx.shadowColor = "#00FF88"
        ctx.shadowBlur = glow

        for (let i = 0; i < drops.length; i += 1) {
          const char = chars[Math.floor(Math.random() * chars.length)]!
          const x = i * fontSize
          const y = drops[i]! * fontSize
          const a = intensity === "LOW" ? 0.07 : intensity === "HIGH" ? 0.14 : 0.1
          ctx.fillStyle = `rgba(0, 255, 136, ${a})`
          ctx.fillText(char, x, y)
          if (y > height && Math.random() > 0.975) drops[i] = 0
          drops[i] = (drops[i] ?? 0) + (intensity === "LOW" ? 0.35 : intensity === "HIGH" ? 0.8 : 0.55)
        }

        ctx.shadowBlur = 0
      }

      rafId = window.requestAnimationFrame(draw)
    }

    rafId = window.requestAnimationFrame(draw)

    const onResize = () => setCanvasSize()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      window.cancelAnimationFrame(rafId)
    }
  }, [cfg.intensity, cfg.matrixBackground])

  if (!cfg.matrixBackground) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        opacity: cfg.intensity === "LOW" ? 0.5 : cfg.intensity === "HIGH" ? 0.9 : 0.7
      }}
    />
  )
}

