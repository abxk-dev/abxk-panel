"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type Holding = {
  id: string
  symbol: string
  quantity: number
  avgPrice: number
}

const STORAGE_KEY = "portfolio_holdings"

function nowId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

function loadHoldings(): Holding[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((h: any): Holding | null => {
        const id = String(h?.id ?? "").trim()
        const symbol = String(h?.symbol ?? "").trim()
        const quantity = Number(h?.quantity ?? 0)
        const avgPrice = Number(h?.avgPrice ?? 0)
        if (!id || !symbol) return null
        if (!Number.isFinite(quantity) || !Number.isFinite(avgPrice)) return null
        return { id, symbol, quantity, avgPrice }
      })
      .filter(Boolean) as Holding[]
  } catch {
    return []
  }
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [error, setError] = useState("")

  const [symbol, setSymbol] = useState("BTC-USDT")
  const [qty, setQty] = useState(0.05)
  const [avg, setAvg] = useState(78_000)

  const [botSnap, setBotSnap] = useState<any>(null)
  const [scalpState, setScalpState] = useState<any>(null)

  useEffect(() => {
    setHoldings(loadHoldings())
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings.slice(0, 200)))
  }, [holdings])

  const symbols = useMemo(() => Array.from(new Set(holdings.map((h) => h.symbol))), [holdings])
  const symbolsKey = useMemo(() => symbols.join("|"), [symbols])

  const refresh = async () => {
    setError("")
    try {
      const next: Record<string, number> = {}
      for (const sym of symbols) {
        const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" })
        const json = (await res.json()) as any
        const raw = json?.data?.price
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
        if (Number.isFinite(n)) next[sym] = n
      }
      setPrices(next)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Price refresh failed"
      setError(msg)
    }

    fetch("/api/bot/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBotSnap(j?.data ?? null))
      .catch(() => undefined)

    fetch("/api/scalping/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setScalpState(j?.data ?? null))
      .catch(() => undefined)
  }

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    void refreshRef.current()
    const t = window.setInterval(() => void refreshRef.current(), 15_000)
    return () => window.clearInterval(t)
  }, [symbolsKey])

  const rows = useMemo(() => {
    return holdings.map((h) => {
      const cur = prices[h.symbol]
      const invested = h.quantity * h.avgPrice
      const value = cur ? h.quantity * cur : 0
      const pnl = value - invested
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0
      return { ...h, cur, invested, value, pnl, pnlPct }
    })
  }, [holdings, prices])

  const totals = useMemo(() => {
    const invested = rows.reduce((s, r) => s + r.invested, 0)
    const value = rows.reduce((s, r) => s + r.value, 0)
    const pnl = value - invested
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0
    return { invested, value, pnl, pnlPct }
  }, [rows])

  const addHolding = () => {
    if (!symbol.trim()) return
    const q = clampNumber(qty, 0, 1_000_000_000)
    const a = clampNumber(avg, 0, 1_000_000_000)
    if (q <= 0 || a <= 0) return
    setHoldings((prev) => [{ id: nowId(), symbol: symbol.trim(), quantity: q, avgPrice: a }, ...prev])
  }

  const removeHolding = (id: string) => setHoldings((prev) => prev.filter((h) => h.id !== id))

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">💼 PORTFOLIO TRACKER</div>
        <div className="text-sm text-white/60">Manual holdings + live valuation</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="SUMMARY">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Total Value</div>
                <div className="text-lg font-semibold text-white">${totals.value.toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Invested</div>
                <div className="text-lg font-semibold text-white">${totals.invested.toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Total PnL</div>
                <div className={`text-lg font-semibold ${totals.pnl >= 0 ? "text-[#00FF88]" : "text-red-400"}`}>
                  {totals.pnl >= 0 ? "+" : ""}
                  ${totals.pnl.toFixed(2)} ({totals.pnl >= 0 ? "+" : ""}
                  {totals.pnlPct.toFixed(2)}%)
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Holdings</div>
                <div className="text-lg font-semibold text-white">{holdings.length}</div>
              </div>
            </div>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void refresh()}
            >
              Refresh Now
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>

          <Section title="ADD HOLDING">
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Symbol</div>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Quantity</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={qty}
                onChange={(e) => setQty(clampNumber(Number(e.target.value), 0, 1_000_000_000))}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Avg Price</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={avg}
                onChange={(e) => setAvg(clampNumber(Number(e.target.value), 0, 1_000_000_000))}
              />
            </label>
            <button
              type="button"
              className="w-full rounded-lg bg-[#00FF88]/20 px-3 py-2 text-xs font-semibold text-[#00FF88]"
              onClick={addHolding}
            >
              + Add
            </button>
          </Section>

          <Section title="BOT PERFORMANCE">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
              <div>Compounding: level {botSnap?.level ?? "—"} • equity ${botSnap?.equity ?? "—"} • dailyPnL ${botSnap?.dailyPnlUsd ?? "—"}</div>
              <div className="mt-1">Scalping: trades {scalpState?.stats?.trades ?? 0} • winRate {scalpState?.stats?.winRate ?? 0}% • totalPnL {scalpState?.stats?.totalPnl ?? 0}</div>
              <div className="mt-1">Grid / Breakout: connect their state sources to include here.</div>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="HOLDINGS">
            {rows.length ? (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">{r.symbol}</div>
                      <button
                        type="button"
                        className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white"
                        onClick={() => removeHolding(r.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-white/70">
                      <div>Qty: {r.quantity}</div>
                      <div>Avg: ${r.avgPrice.toFixed(2)}</div>
                      <div>Now: {r.cur ? `$${r.cur.toFixed(2)}` : "—"}</div>
                      <div>
                        PnL: <span className={r.pnl >= 0 ? "text-[#00FF88]" : "text-red-400"}>{r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)} ({r.pnl >= 0 ? "+" : ""}{r.pnlPct.toFixed(2)}%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No holdings added yet.</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
