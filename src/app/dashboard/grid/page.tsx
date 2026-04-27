"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ExecutionMode } from "@/types/bot"
import {
  GRID_COINS,
  createGridLevels,
  estimatedProfitPerGridPct,
  gridInterval,
  initializeGridState,
  stepGrid,
  totalCapitalUsd,
  type GridConfig,
  type GridLevel,
  type GridState,
  type GridType
} from "@/lib/gridEngine"

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "0"
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(6)
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "0.00%"
  return `${n.toFixed(2)}%`
}

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

async function fetchLivePrice(symbol: string): Promise<number> {
  const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const price = Number(json?.data?.data?.price ?? json?.data?.price ?? json?.data?.lastPrice ?? json?.price ?? 0)
  return Number.isFinite(price) ? price : 0
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

function NumberInput(props: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/50">{props.label}</div>
      <div className="flex items-center gap-2">
        {props.prefix ? <div className="text-sm text-white/50">{props.prefix}</div> : null}
        <input
          type="number"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
          value={Number.isFinite(props.value) ? String(props.value) : ""}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
      </div>
    </label>
  )
}

function levelStatus(level: GridLevel) {
  if (level.buyActive) return "BUY"
  if (level.sellActive) return "SELL"
  return "—"
}

export default function GridPage() {
  const [symbol, setSymbol] = useState<string>(String(GRID_COINS[0] ?? "BTC-USDT"))
  const [mode, setMode] = useState<ExecutionMode>("paper")
  const [type, setType] = useState<GridType>("ARITHMETIC")

  const [upperPrice, setUpperPrice] = useState<number>(85_000)
  const [lowerPrice, setLowerPrice] = useState<number>(75_000)
  const [gridLevels, setGridLevels] = useState<number>(10)
  const [amountPerGridUsd, setAmountPerGridUsd] = useState<number>(10)

  const [running, setRunning] = useState(false)
  const [state, setState] = useState<GridState | null>(null)
  const [lastPrice, setLastPrice] = useState<number>(0)
  const [error, setError] = useState<string>("")
  const [startLoading, setStartLoading] = useState(false)

  const config = useMemo((): GridConfig => {
    return {
      symbol,
      upperPrice: clampNumber(upperPrice, 0.01, 10_000_000),
      lowerPrice: clampNumber(lowerPrice, 0.01, 10_000_000),
      gridLevels: clampInt(gridLevels, 1, 200),
      amountPerGridUsd: clampNumber(amountPerGridUsd, 0.5, 100_000),
      mode,
      type
    }
  }, [symbol, upperPrice, lowerPrice, gridLevels, amountPerGridUsd, mode, type])

  const derived = useMemo(() => {
    const interval = gridInterval(config)
    const capital = totalCapitalUsd(config)
    const profitPct = estimatedProfitPerGridPct(config, lastPrice || undefined)
    const levels = createGridLevels(config)
    return { interval, capital, profitPct, levels }
  }, [config, lastPrice])

  const start = async () => {
    setError("")
    setStartLoading(true)
    try {
    const upper = config.upperPrice
    const lower = config.lowerPrice
    if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) {
      setError("Upper price must be > lower price")
      return
    }
    const levels = createGridLevels(config)
    if (!levels.length) {
      setError("Invalid grid config")
      return
    }

    const price = await fetchLivePrice(config.symbol).catch(() => 0)
    if (!price || price <= 0) {
      setError("Failed to fetch price")
      return
    }

    setLastPrice(price)
    const next = initializeGridState(config, price)
    setState(next)
    setRunning(true)
    } finally {
      setStartLoading(false)
    }
  }

  const stop = () => {
    setRunning(false)
  }

  const stateRef = useRef<GridState | null>(null)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const configRef = useRef<GridConfig>(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    if (!running) return
    let stopped = false

    const tick = async () => {
      if (stopped) return
      const s = stateRef.current
      if (!s) return
      const price = await fetchLivePrice(s.config.symbol).catch(() => 0)
      if (!price || price <= 0) return
      setLastPrice(price)
      setState(stepGrid(s, price))
    }

    void tick()
    const t = window.setInterval(() => void tick(), 10_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [running])

  const rows = useMemo(() => {
    const levels = state?.levels ?? derived.levels
    return [...levels].sort((a, b) => b.price - a.price)
  }, [state, derived.levels])

  const activeOrders = useMemo(() => {
    const levels = state?.levels ?? []
    const buys = levels.filter((l) => l.buyActive).length
    const sells = levels.filter((l) => l.sellActive).length
    return { buys, sells }
  }, [state])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">📊 GRID TRADING</div>
        <div className="text-sm text-white/60">Place buy/sell orders at fixed intervals and profit from ranging markets</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="SETUP">
            <Select label="Symbol" value={symbol} onChange={setSymbol} options={[...GRID_COINS].map((s) => ({ value: s, label: s }))} />
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
                  mode === "live" ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={() => setMode("live")}
              >
                LIVE
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  mode === "mirror" ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={() => setMode("mirror")}
              >
                MIRROR
              </button>
            </div>
            <Select
              label="Grid type"
              value={type}
              onChange={(v) => setType(v === "GEOMETRIC" ? "GEOMETRIC" : "ARITHMETIC")}
              options={[
                { value: "ARITHMETIC", label: "ARITHMETIC" },
                { value: "GEOMETRIC", label: "GEOMETRIC" }
              ]}
            />
            <div className="text-xs text-white/50">
              Live price: {lastPrice ? `$${fmtUsd(lastPrice)}` : "—"} • Status: {running ? "RUNNING" : "STOPPED"}
            </div>
            {error ? <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          </Section>

          <Section title="GRID SETTINGS">
            <NumberInput label="Upper price" value={upperPrice} onChange={setUpperPrice} min={0} step={1} prefix="$" />
            <NumberInput label="Lower price" value={lowerPrice} onChange={setLowerPrice} min={0} step={1} prefix="$" />
            <NumberInput label="Grid levels" value={gridLevels} onChange={(v) => setGridLevels(clampInt(v, 1, 200))} min={1} max={200} step={1} />
            <NumberInput
              label="Amount/grid"
              value={amountPerGridUsd}
              onChange={(v) => setAmountPerGridUsd(clampNumber(v, 0.5, 100_000))}
              min={0.5}
              step={1}
              prefix="$"
            />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Total capital</div>
                <div className="text-base font-semibold text-white">${fmtUsd(derived.capital)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Grid interval</div>
                <div className="text-base font-semibold text-white">${fmtUsd(derived.interval)}</div>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm">
              <div className="text-xs text-white/50">Profit/grid (estimated)</div>
              <div className="text-base font-semibold text-white">{fmtPct(derived.profitPct)}</div>
            </div>
          </Section>

          <Section title="CONTROL">
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  running ? "bg-white/5 text-white/60 hover:text-white" : "bg-[#00FF88]/20 text-[#00FF88]"
                }`}
                onClick={() => void start()}
                disabled={running || startLoading}
              >
                {startLoading ? "Starting…" : "Start Grid"}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  running ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={stop}
              >
                Stop Grid
              </button>
            </div>
            <div className="text-xs text-white/50">
              Active orders: {activeOrders.buys} BUY • {activeOrders.sells} SELL
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">GRID VISUALIZATION</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Level</th>
                    <th className="py-2">Price</th>
                    <th className="py-2">Order</th>
                    <th className="py-2">Last fill</th>
                    <th className="py-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((l) => (
                      <tr key={l.index} className="border-t border-white/10 text-white/80">
                        <td className="py-2 font-semibold">#{l.index}</td>
                        <td className="py-2">${fmtUsd(l.price)}</td>
                        <td className="py-2">{levelStatus(l)}</td>
                        <td className="py-2">{l.lastFillSide ? `${l.lastFillSide}` : "—"}</td>
                        <td className={`py-2 ${l.profitUsd >= 0 ? "text-[#00FF88]" : "text-red-300"}`}>${fmtUsd(l.profitUsd)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-white/50">
                        Configure grid and start.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pt-3 text-xs text-white/50">
              Current: {lastPrice ? `$${fmtUsd(lastPrice)}` : "—"} • Levels: {config.gridLevels + 1}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">PERFORMANCE</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Total profit</div>
                <div className={`text-base font-semibold ${(state?.totalProfitUsd ?? 0) >= 0 ? "text-[#00FF88]" : "text-red-300"}`}>
                  ${fmtUsd(state?.totalProfitUsd ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Cycles completed</div>
                <div className="text-base font-semibold text-white">{state?.cyclesCompleted ?? 0}</div>
              </div>
            </div>
            <div className="pt-3 text-xs text-white/50">This page simulates fills from live price; live order placement is not wired here yet.</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">RECENT CYCLES</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Type</th>
                    <th className="py-2">Entry</th>
                    <th className="py-2">Exit</th>
                    <th className="py-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {(state?.cycles ?? []).length ? (
                    (state?.cycles ?? []).slice(0, 15).map((c) => (
                      <tr key={c.id} className="border-t border-white/10 text-white/80">
                        <td className="py-2 font-semibold">{c.fromSide === "BUY" ? "Buy→Sell" : "Sell→Buy"}</td>
                        <td className="py-2">${fmtUsd(c.entryPrice)}</td>
                        <td className="py-2">${fmtUsd(c.exitPrice)}</td>
                        <td className={`py-2 ${c.profitUsd >= 0 ? "text-[#00FF88]" : "text-red-300"}`}>${fmtUsd(c.profitUsd)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-white/50">
                        No cycles yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
