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

export function DataStreams() {
  const [cfg, setCfg] = useState<VisualEffectsSettings>(() => readSettings())
  const containerRef = useRef<HTMLDivElement>(null)

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
    if (!cfg.dataStreams) return
    const container = containerRef.current
    if (!container) return

    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    if (reducedMotion) return

    const STREAMS = [
      "SHA256:0x4F2A8B9C1D3E5F7A",
      "BLOCK:847,293",
      "TX:0x8f4e2a...c9d1",
      "WALLET:3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5",
      "PRIVATE_KEY:5HueCGU8rMjxECyDaLV2",
      "BTC:-33.7291",
      "MERKLE:0xAB34CD56",
      ">>> ACCESSING <<<",
      "DECRYPT:AES-256",
      "PORT:8333 OPEN",
      "> sudo hack --target btc",
      "HASH:000000000019d668",
      "NONCE:2083236893",
      "₿₿₿ MINING ₿₿₿"
    ]

    const nodes = new Set<HTMLDivElement>()

    const createStream = () => {
      const div = document.createElement("div")
      nodes.add(div)

      const stream = STREAMS[Math.floor(Math.random() * STREAMS.length)]!
      div.textContent = stream

      const intensity = cfg.intensity
      const alpha = Math.random() * (intensity === "LOW" ? 0.09 : intensity === "HIGH" ? 0.22 : 0.15) + 0.03
      const fontSize = Math.random() * (intensity === "LOW" ? 6 : intensity === "HIGH" ? 10 : 8) + 9
      const left = Math.random() * 100

      div.style.cssText = `
        position: absolute;
        left: ${left}vw;
        top: -30px;
        font-family: 'Share Tech Mono', monospace;
        font-size: ${fontSize}px;
        color: rgba(0, 255, 136, ${alpha});
        pointer-events: none;
        white-space: nowrap;
        text-shadow: 0 0 4px #00FF88;
        transition: none;
      `

      container.appendChild(div)

      const duration = Math.random() * (intensity === "LOW" ? 10_000 : intensity === "HIGH" ? 7_000 : 8_000) + 4_000
      const startTime = Date.now()

      const animate = () => {
        const elapsed = Date.now() - startTime
        const progress = elapsed / duration
        div.style.top = `${-30 + progress * (window.innerHeight + 60)}px`

        if (progress < 1) {
          window.requestAnimationFrame(animate)
        } else {
          nodes.delete(div)
          div.remove()
        }
      }

      window.requestAnimationFrame(animate)
    }

    const intensity = cfg.intensity
    const intervalMs = intensity === "LOW" ? 1400 : intensity === "HIGH" ? 420 : 800
    const interval = window.setInterval(createStream, intervalMs)

    const burst = intensity === "LOW" ? 4 : intensity === "HIGH" ? 12 : 8
    for (let i = 0; i < burst; i += 1) {
      window.setTimeout(createStream, i * 200)
    }

    return () => {
      window.clearInterval(interval)
      nodes.forEach((n) => n.remove())
      nodes.clear()
    }
  }, [cfg.dataStreams, cfg.intensity])

  if (!cfg.dataStreams) return null

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none"
      }}
    />
  )
}
