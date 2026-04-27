"use client"

import { useEffect, useRef, useState } from "react"

interface FloatingBTC {
  x: number
  y: number
  size: number
  opacity: number
  speed: number
  hacked: boolean
  hackProgress: number
  rotation: number
  color: string
}

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

export function BitcoinHack() {
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
    if (!cfg.floatingBitcoin) return

    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    if (reducedMotion) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const intensity = cfg.intensity
    const count = intensity === "LOW" ? 8 : intensity === "HIGH" ? 24 : 15
    const hackChance = intensity === "LOW" ? 0.0006 : intensity === "HIGH" ? 0.0016 : 0.001

    let w = 0
    let h = 0

    const setCanvasSize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      w = window.innerWidth
      h = window.innerHeight
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    setCanvasSize()

    const btcs: FloatingBTC[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 20 + 10,
      opacity: Math.random() * 0.3 + 0.05,
      speed: Math.random() * 0.3 + 0.1,
      hacked: false,
      hackProgress: 0,
      rotation: Math.random() * Math.PI * 2,
      color: "#F7931A"
    }))

    let animId = 0

    const draw = () => {
      ctx.clearRect(0, 0, w, h)

      btcs.forEach((btc) => {
        ctx.save()
        ctx.translate(btc.x, btc.y)
        ctx.rotate(btc.rotation)

        if (!btc.hacked && Math.random() < hackChance) btc.hacked = true

        if (btc.hacked) {
          btc.hackProgress = Math.min(btc.hackProgress + 0.02, 1)

          ctx.font = `${btc.size}px monospace`
          ctx.fillStyle = `rgba(255, 0, 68, ${btc.opacity})`
          ctx.shadowColor = "#FF0044"
          ctx.shadowBlur = 10

          const glitchX = (Math.random() - 0.5) * 4
          const glitchY = (Math.random() - 0.5) * 4

          ctx.fillText("₿", glitchX, glitchY)

          ctx.strokeStyle = `rgba(255, 0, 68, ${btc.opacity * 1.5})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(-btc.size / 2, -btc.size / 2)
          ctx.lineTo(btc.size / 2, btc.size / 2)
          ctx.moveTo(btc.size / 2, -btc.size / 2)
          ctx.lineTo(-btc.size / 2, btc.size / 2)
          ctx.stroke()

          if (btc.hackProgress >= 1) {
            btc.hacked = false
            btc.hackProgress = 0
            btc.color = "#F7931A"
            btc.x = Math.random() * w
            btc.y = Math.random() * h
          }
        } else {
          ctx.font = `${btc.size}px monospace`
          ctx.fillStyle = `rgba(247, 147, 26, ${btc.opacity})`
          ctx.shadowColor = "#F7931A"
          ctx.shadowBlur = 5
          ctx.fillText("₿", 0, 0)
        }

        ctx.shadowBlur = 0
        ctx.restore()

        btc.y -= btc.speed * (intensity === "LOW" ? 0.22 : intensity === "HIGH" ? 0.45 : 0.3)
        btc.rotation += 0.002

        if (btc.y < -50) {
          btc.y = h + 50
          btc.x = Math.random() * w
        }
      })

      animId = window.requestAnimationFrame(draw)
    }

    draw()

    const onResize = () => setCanvasSize()
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      window.cancelAnimationFrame(animId)
    }
  }, [cfg.floatingBitcoin, cfg.intensity])

  if (!cfg.floatingBitcoin) return null

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
        pointerEvents: "none"
      }}
    />
  )
}

