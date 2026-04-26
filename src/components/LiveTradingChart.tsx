"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts"

type ChartInterval = "15m" | "1h" | "4h" | "1d"

export function LiveTradingChart({ symbol = "BTC-USDT" }: { symbol?: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null)

  const [interval, setIntervalTf] = useState<ChartInterval>("4h")
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)

  const tfButtons = useMemo(
    () =>
      [
        { label: "15m", value: "15m" as const },
        { label: "1H", value: "1h" as const },
        { label: "4H", value: "4h" as const },
        { label: "1D", value: "1d" as const }
      ] satisfies { label: string; value: ChartInterval }[],
    []
  )

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#888888"
      },
      grid: {
        vertLines: { color: "#1a1a1a" },
        horzLines: { color: "#1a1a1a" }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#00FF8844", labelBackgroundColor: "#00FF88" },
        horzLine: { color: "#00FF8844", labelBackgroundColor: "#00FF88" }
      },
      rightPriceScale: {
        borderColor: "#1a1a1a",
        textColor: "#888888"
      },
      timeScale: {
        borderColor: "#1a1a1a",
        timeVisible: true,
        secondsVisible: false
      },
      width: chartContainerRef.current.clientWidth,
      height: 220
    })

    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00FF88",
      downColor: "#FF4444",
      borderUpColor: "#00FF88",
      borderDownColor: "#FF4444",
      wickUpColor: "#00FF88",
      wickDownColor: "#FF4444"
    })
    candleSeriesRef.current = candleSeries

    const ema20Series = chart.addSeries(LineSeries, {
      color: "#00C896",
      lineWidth: 1,
      title: "EMA20"
    })
    ema20SeriesRef.current = ema20Series

    const ema50Series = chart.addSeries(LineSeries, {
      color: "#FF9900",
      lineWidth: 1,
      title: "EMA50"
    })
    ema50SeriesRef.current = ema50Series

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current) return
      chart.applyOptions({ width: chartContainerRef.current.clientWidth })
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      ema20SeriesRef.current = null
      ema50SeriesRef.current = null
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function fetchCandles() {
      try {
        const res = await fetch(
          `/api/chart-data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=120`,
          { cache: "no-store" }
        )
        const data = (await res.json()) as any

        if (!mounted) return
        if (!data?.candles?.length) return

        const candles = (data.candles as any[]).map((c) => ({
          time: Math.floor(Number(c.time) / 1000) as UTCTimestamp,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close)
        }))

        candleSeriesRef.current?.setData(candles)

        if (Array.isArray(data.ema20)) {
          ema20SeriesRef.current?.setData(
            (data.ema20 as any[]).map((e) => ({
              time: Math.floor(Number(e.time) / 1000) as UTCTimestamp,
              value: Number(e.value)
            }))
          )
        }

        if (Array.isArray(data.ema50)) {
          ema50SeriesRef.current?.setData(
            (data.ema50 as any[]).map((e) => ({
              time: Math.floor(Number(e.time) / 1000) as UTCTimestamp,
              value: Number(e.value)
            }))
          )
        }

        chartRef.current?.timeScale().fitContent()
        setLastUpdatedAt(Date.now())
      } catch {
        if (!mounted) return
      }
    }

    void fetchCandles()
    const refreshInterval = window.setInterval(() => void fetchCandles(), 30_000)
    return () => {
      mounted = false
      window.clearInterval(refreshInterval)
    }
  }, [symbol, interval])

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #1a1a1a"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "13px",
              color: "#00FF88",
              fontWeight: 600
            }}
          >
            {symbol}
          </span>
          <span style={{ fontSize: "11px", color: "#555", fontFamily: "monospace" }}>
            {interval.toUpperCase()} · Live{lastUpdatedAt ? ` · ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {tfButtons.map((tf) => (
            <button
              key={tf.value}
              type="button"
              onClick={() => setIntervalTf(tf.value)}
              style={{
                padding: "2px 8px",
                fontSize: "11px",
                background: tf.value === interval ? "#00FF8822" : "transparent",
                border: `1px solid ${tf.value === interval ? "#00FF88" : "#333"}`,
                borderRadius: "4px",
                color: tf.value === interval ? "#00FF88" : "#666",
                cursor: "pointer",
                fontFamily: "monospace"
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: "100%", height: "220px" }} />

      <div
        style={{
          display: "flex",
          gap: "16px",
          padding: "6px 12px",
          borderTop: "1px solid #1a1a1a",
          fontSize: "10px",
          fontFamily: "monospace"
        }}
      >
        <span style={{ color: "#00C896" }}>── EMA 20</span>
        <span style={{ color: "#FF9900" }}>── EMA 50</span>
        <span style={{ color: "#00FF88" }}>▲ Bullish</span>
        <span style={{ color: "#FF4444" }}>▼ Bearish</span>
      </div>
    </div>
  )
}
