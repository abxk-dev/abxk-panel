"use client"

import { useEffect, useMemo, useRef, useState } from "react"

export function useLivePrice(symbol: string): { price?: number; source: "ws" | "rest" | "idle" } {
  const [price, setPrice] = useState<number | undefined>(undefined)
  const [source, setSource] = useState<"ws" | "rest" | "idle">("idle")
  const wsRef = useRef<WebSocket | null>(null)

  const dataType = useMemo(() => `${symbol}@ticker`, [symbol])

  useEffect(() => {
    let mounted = true
    let restTimer: number | undefined

    const startRestFallback = () => {
      if (restTimer) return
      setSource("rest")
      restTimer = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
          const json = (await res.json()) as any
          const row = json?.data ?? json
          const p = Number(row?.price ?? row?.lastPrice ?? row?.last)
          if (mounted && Number.isFinite(p)) setPrice(p)
        } catch {
          return
        }
      }, 3000)
    }

    try {
      const ws = new WebSocket("wss://open-api-swap.bingx.com/swap-market")
      wsRef.current = ws

      ws.onopen = () => {
        setSource("ws")
        ws.send(JSON.stringify({ id: `ui-${Date.now()}`, reqType: "sub", dataType }))
      }

      ws.onmessage = (evt) => {
        void (async () => {
          if (!mounted) return
          const text = await decodeBrowserWsMessage(evt.data)
          if (!text) return
          if (text === "Ping") {
            ws.send("Pong")
            return
          }
          try {
            const msg = JSON.parse(text)
            const row = msg?.data ?? msg?.tick ?? msg
            const p = Number(row?.lastPrice ?? row?.last ?? row?.price ?? row?.c ?? row?.close ?? row?.markPrice)
            if (Number.isFinite(p)) setPrice(p)
          } catch {
            return
          }
        })()
      }

      ws.onerror = () => {
        startRestFallback()
      }

      ws.onclose = () => {
        startRestFallback()
      }
    } catch {
      startRestFallback()
    }

    return () => {
      mounted = false
      if (wsRef.current) wsRef.current.close()
      if (restTimer) window.clearInterval(restTimer)
    }
  }, [symbol, dataType])

  return { price, source }
}

async function decodeBrowserWsMessage(data: unknown): Promise<string> {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return tryGunzip(new Uint8Array(data))
  if (data instanceof Blob) {
    const buf = await data.arrayBuffer()
    return tryGunzip(new Uint8Array(buf))
  }
  try {
    return String(data ?? "")
  } catch {
    return ""
  }
}

async function tryGunzip(bytes: Uint8Array): Promise<string> {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof (globalThis as any).DecompressionStream === "function") {
    const ds = new (globalThis as any).DecompressionStream("gzip")
    const stream = new Blob([bytes]).stream().pipeThrough(ds)
    const decompressed = await new Response(stream).arrayBuffer()
    return new TextDecoder().decode(decompressed)
  }
  return new TextDecoder().decode(bytes)
}
