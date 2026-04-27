"use client"

import { useEffect, useMemo, useState } from "react"
import { GRID_COINS } from "@/lib/gridEngine"
import { useLivePrice } from "@/lib/useLivePrice"
import { calculateGridLevels, calculateGridStats, useGridVaultStore, type GridLevel, type SpotGridConfig } from "@/lib/gridVaultState"

type Suggestion = {
  currentPrice: number
  suggestedUpper: number
  suggestedLower: number
  suggestedLevels: number
  rangePercent: string
  message: string
}

export function SpotGridPanel() {
  const settings = useGridVaultStore((s) => s.settings)
  const spotGrids = useGridVaultStore((s) => s.spotGrids)
  const startSpotGrid = useGridVaultStore((s) => s.startSpotGrid)
  const stopSpotGrid = useGridVaultStore((s) => s.stopSpotGrid)

  const active = useMemo(() => spotGrids.find((g) => g.running), [spotGrids])

  const [symbol, setSymbol] = useState(settings.defaultSymbol || "BTC-USDT")
  const [capital, setCapital] = useState(100)
  const [upperPrice, setUpperPrice] = useState(90_000)
  const [lowerPrice, setLowerPrice] = useState(78_000)
  const [gridLevels, setGridLevels] = useState(settings.defaultLevels || 6)
  const [mode, setMode] = useState<SpotGridConfig["mode"]>("paper")

  const { price } = useLivePrice(symbol)

  const config = useMemo(
    (): SpotGridConfig => ({
      symbol,
      capital: Math.max(1, capital),
      upperPrice: Math.max(0.01, upperPrice),
      lowerPrice: Math.max(0.01, lowerPrice),
      gridLevels: Math.max(2, Math.min(20, Math.floor(gridLevels))),
      mode
    }),
    [symbol, capital, upperPrice, lowerPrice, gridLevels, mode]
  )

  const stats = useMemo(() => calculateGridStats(config), [config])
  const previewLevels = useMemo(() => calculateGridLevels(config, price ?? (lowerPrice + upperPrice) / 2), [config, price, lowerPrice, upperPrice])

  const rows = useMemo(() => {
    const src = active?.config.symbol === symbol ? active.levels : previewLevels
    const p = price ?? active?.lastPrice
    return [...src]
      .slice()
      .sort((a, b) => b.price - a.price)
      .map((l) => ({
        ...l,
        isNow: typeof p === "number" ? Math.abs(l.price - p) <= Math.max(0.000001, stats.interval / 4) : false
      }))
  }, [active, symbol, previewLevels, price, stats.interval])

  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [startLoading, setStartLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    setSuggestLoading(true)
    void suggestGridRange(symbol)
      .then((s) => {
        if (!mounted) return
        setSuggestion(s)
      })
      .catch(() => {
        if (mounted) setSuggestion(null)
      })
      .finally(() => {
        if (mounted) setSuggestLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [symbol])

  const start = async () => {
    setStartLoading(true)
    try {
      if (!settings.enabled) return
      if (mode === "live") {
        return
      }
      const p = price ?? (await fetchLivePrice(symbol).catch(() => 0))
      if (!p || p <= 0) return
      const grid = startSpotGrid(config, p)
      if (!grid) return
      if (!settings.telegramUpdates) return
      const msg = `🔲 GRID VAULT STARTED
━━━━━━━━━━━━━━
Type: Spot Grid
Symbol: ${config.symbol}
Capital: $${config.capital.toFixed(2)}
Range: $${Math.round(config.lowerPrice).toLocaleString()} - $${Math.round(config.upperPrice).toLocaleString()}
Levels: ${config.gridLevels}
Mode: ${config.mode.toUpperCase()}
━━━━━━━━━━━━━━
Per cycle profit: $${stats.profitPerCycle.toFixed(2)}
Daily estimate: $${(stats.dailyProfitAverage).toFixed(2)}
Monthly estimate: $${(stats.monthlyAverage).toFixed(2)}`
      await sendTelegramMessage(msg)
    } finally {
      setStartLoading(false)
    }
  }

  const stop = () => {
    if (!active) return
    stopSpotGrid(active.id)
  }

  const modeDisabled = mode === "live"

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <div className="space-y-6">
        <Section title="⚙️ SPOT GRID SETTINGS">
          <Select
            label="Symbol"
            value={symbol}
            onChange={setSymbol}
            options={[...GRID_COINS].slice(0, 50).map((s) => ({ value: s, label: s }))}
          />
          <NumberInput label="Capital ($)" value={capital} onChange={setCapital} min={1} step={1} />
          <NumberInput label="Upper Price" value={upperPrice} onChange={setUpperPrice} min={0.01} step={1} />
          <NumberInput label="Lower Price" value={lowerPrice} onChange={setLowerPrice} min={0.01} step={1} />

          <div>
            <div className="mb-1 text-xs text-white/50">Grid Levels: {Math.floor(gridLevels)}</div>
            <input
              className="w-full"
              type="range"
              min={2}
              max={20}
              value={gridLevels}
              onChange={(e) => setGridLevels(Number(e.target.value))}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                mode === "paper" ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
              }`}
              onClick={() => setMode("paper")}
            >
              PAPER
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                mode === "live" ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-white/60 hover:text-white"
              }`}
              onClick={() => setMode("live")}
            >
              LIVE
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
            <div className="text-xs font-semibold text-white/70">AUTO CALCULATE</div>
            <div className="mt-2 grid gap-1 text-xs text-white/60">
              <div>Grid interval: ${Math.round(stats.interval).toLocaleString()}</div>
              <div>Profit/grid: {stats.profitPerGridPercent.toFixed(2)}%</div>
              <div>Amount/level: ${stats.amountPerLevel.toFixed(2)}</div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
            <div className="text-xs font-semibold text-white/70">ESTIMATED RETURNS</div>
            <div className="mt-2 grid gap-1 text-xs text-white/60">
              <div>Per cycle: ${stats.profitPerCycle.toFixed(2)}</div>
              <div>Daily (avg): ${stats.dailyProfitAverage.toFixed(2)}</div>
              <div>Monthly: ${stats.monthlyAverage.toFixed(2)}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                settings.enabled && !modeDisabled ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/40"
              }`}
              onClick={() => void start()}
              disabled={!settings.enabled || modeDisabled || startLoading}
            >
              {startLoading ? "Starting…" : "▶ START SPOT GRID"}
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                active ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-white/40"
              }`}
              onClick={stop}
              disabled={!active}
            >
              ■ STOP
            </button>
          </div>

          {modeDisabled ? (
            <div className="text-xs text-orange-300">LIVE mode is reserved for exchange execution and is not wired in this UI yet.</div>
          ) : null}

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-white/70">💡 Suggested range based on 30-day history</div>
              <div className="text-xs text-white/40">{suggestLoading ? "Loading…" : ""}</div>
            </div>
            {suggestion ? (
              <div className="mt-2 text-xs text-white/60">
                <div>
                  Upper: ${suggestion.suggestedUpper.toLocaleString()} | Lower: ${suggestion.suggestedLower.toLocaleString()}
                </div>
                <div>
                  Range: {suggestion.rangePercent}% | Current: ${Math.round(suggestion.currentPrice).toLocaleString()}
                </div>
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white"
                  onClick={() => {
                    setUpperPrice(suggestion.suggestedUpper)
                    setLowerPrice(suggestion.suggestedLower)
                    setGridLevels(suggestion.suggestedLevels)
                  }}
                >
                  Apply Suggestion
                </button>
              </div>
            ) : (
              <div className="mt-2 text-xs text-white/50">No suggestion available.</div>
            )}
          </div>
        </Section>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">GRID VISUALIZATION</div>
          <div className="flex justify-center">
            <div className="w-full max-w-md rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-white/50">
                <div>Levels</div>
                <div>
                  Live: {price ? `$${Math.round(price).toLocaleString()}` : "—"}
                </div>
              </div>
              <div className="space-y-1">
                {rows.map((l) => (
                  <LadderRow key={`${l.price}-${l.type}`} level={l} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {active ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-2 text-sm font-semibold text-white">ACTIVE GRID</div>
            <div className="grid gap-2 text-sm text-white/70">
              <Line label="Status" value={active.running ? "🟢 RUNNING" : "STOPPED"} />
              <Line label="Cycles" value={`${active.cycles}`} />
              <Line label="Profit" value={`${active.totalProfit >= 0 ? "+" : ""}$${active.totalProfit.toFixed(2)}`} />
              <Line label="Last price" value={typeof active.lastPrice === "number" ? `$${Math.round(active.lastPrice).toLocaleString()}` : "—"} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

function Select(props: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/50">{props.label}</div>
      <select
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function NumberInput(props: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/50">{props.label}</div>
      <input
        type="number"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
        value={Number.isFinite(props.value) ? String(props.value) : ""}
        min={props.min}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function LadderRow({ level }: { level: GridLevel & { isNow?: boolean } }) {
  const isBuy = level.type === "BUY"
  const base = isBuy ? "bg-red-500/10 border-red-500/20 text-red-200" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
  const now = level.isNow ? "bg-blue-500/15 border-blue-500/30 text-blue-200" : ""
  const color = level.isNow ? now : base
  const label = level.isNow ? "NOW" : level.type
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${color}`}>
      <div className="font-mono">${Math.round(level.price).toLocaleString()}</div>
      <div className="flex items-center gap-2 text-[10px]">
        <div>{label}</div>
        <div className="text-white/60">{level.status}</div>
        {level.profit ? <div className="text-white/80">+${level.profit.toFixed(2)}</div> : null}
      </div>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-white/50">{label}</div>
      <div className="font-semibold text-white">{value}</div>
    </div>
  )
}

async function fetchLivePrice(symbol: string): Promise<number> {
  const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const price = Number(json?.data?.data?.price ?? json?.data?.price ?? json?.data?.lastPrice ?? json?.price ?? 0)
  return Number.isFinite(price) ? price : 0
}

async function suggestGridRange(symbol: string): Promise<Suggestion> {
  const price = await fetchLivePrice(symbol)
  const res = await fetch(`/api/bingx/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=30`, { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const rows = (json?.data?.data ?? json?.data ?? json?.rows ?? []) as any[]
  const highs = rows.map((c) => Number(c?.high ?? c?.h ?? (Array.isArray(c) ? c[2] : undefined))).filter(Number.isFinite)
  const lows = rows.map((c) => Number(c?.low ?? c?.l ?? (Array.isArray(c) ? c[3] : undefined))).filter(Number.isFinite)
  const high30 = highs.length ? Math.max(...highs) : price
  const low30 = lows.length ? Math.min(...lows) : price

  const suggestedUpper = Math.round(high30 * 1.05)
  const suggestedLower = Math.round(low30 * 0.95)
  const suggestedLevels = 6
  const rangePercent = price > 0 ? (((suggestedUpper - suggestedLower) / price) * 100).toFixed(1) : "0.0"

  return {
    currentPrice: price,
    suggestedUpper,
    suggestedLower,
    suggestedLevels,
    rangePercent,
    message: "Based on 30-day price range"
  }
}

async function sendTelegramMessage(message: string) {
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  }).catch(() => null)
}
