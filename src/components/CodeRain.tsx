"use client"

import { useEffect, useRef } from "react"

export interface CodeRainProps {
  width?: number
  opacity?: number
  speed?: number
  fontSize?: number
  color?: string
}

export function CodeRain({ width = 160, opacity = 0.15, speed = 50, fontSize = 12, color = "#00FF88" }: CodeRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

    const chars = [
      "0",
      "1",
      "$",
      "€",
      "₿",
      "Ξ",
      "BTC",
      "ETH",
      "SOL",
      "if",
      "fn",
      "=>",
      "{",
      "}",
      "[]",
      "buy",
      "sell",
      "long",
      "short",
      "0x",
      "//",
      "&&",
      "||",
      "▲",
      "▼",
      "◆",
      "■",
      "RSI",
      "EMA",
      "ATR",
      "MACD",
      "100%",
      "x10",
      "TP",
      "SL",
      "npm",
      "tsx",
      "API",
      "WS",
      "∑",
      "∆",
      "π",
      "∞",
      "01",
      "10",
      "11",
      "00"
    ]

    const columns = Math.max(1, Math.floor(width / fontSize))
    const drops: number[] = new Array(columns).fill(1)

    const setCanvasSize = () => {
      const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1
      const h = typeof window !== "undefined" ? window.innerHeight : 800

      canvas.style.width = `${width}px`
      canvas.style.height = `${h}px`
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(h * dpr)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `${fontSize}px monospace`
    }

    setCanvasSize()

    let rafId = 0
    let lastDrawAt = 0
    const frameMs = Math.max(16, reducedMotion ? speed * 2 : speed)

    const draw = (t: number) => {
      if (t - lastDrawAt >= frameMs) {
        lastDrawAt = t

        ctx.fillStyle = "rgba(0, 0, 0, 0.05)"
        ctx.fillRect(0, 0, width, canvas.height)

        ctx.font = `${fontSize}px monospace`

        for (let i = 0; i < drops.length; i += 1) {
          const char = chars[Math.floor(Math.random() * chars.length)]!
          const x = i * fontSize
          const y = drops[i]! * fontSize

          ctx.fillStyle = Math.random() > 0.92 ? "rgba(255, 255, 255, 0.9)" : color
          ctx.fillText(char, x, y)

          if (y > canvas.height && Math.random() > 0.975) drops[i] = 0
          drops[i] = (drops[i] ?? 0) + 0.5
        }
      }

      rafId = window.requestAnimationFrame(draw)
    }

    rafId = window.requestAnimationFrame(draw)

    const handleResize = () => setCanvasSize()
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      window.cancelAnimationFrame(rafId)
    }
  }, [width, color, fontSize, speed])

  return (
    <canvas
      ref={canvasRef}
      style={{
        opacity,
        display: "block",
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none"
      }}
    />
  )
}

