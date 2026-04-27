"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { applyPriceTrigger, evaluatePriceAlert, type AlertTrigger, type PriceAlert } from "@/lib/alertsEngine"

const STORAGE_ALERTS = "smart_alerts"
const STORAGE_HISTORY = "smart_alerts_history"

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

async function sendTelegram(message: string) {
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  })
}

function loadAlerts(): PriceAlert[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_ALERTS)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((a: any): PriceAlert | null => {
        if (a?.type !== "PRICE") return null
        const id = String(a?.id ?? "").trim()
        const symbol = String(a?.symbol ?? "").trim()
        const condition = String(a?.condition ?? "ABOVE").toUpperCase()
        const price = Number(a?.price ?? 0)
        const message = String(a?.message ?? "")
        const recurring = Boolean(a?.recurring ?? false)
        const createdAt = Number(a?.createdAt ?? Date.now())
        const lastTriggeredAt = a?.lastTriggeredAt ? Number(a.lastTriggeredAt) : undefined
        if (!id || !symbol || !Number.isFinite(price)) return null
        const c: PriceAlert["condition"] = condition === "BELOW" ? "BELOW" : condition === "CROSSES" ? "CROSSES" : "ABOVE"
        return { id, type: "PRICE", symbol, condition: c, price, message, recurring, createdAt, lastTriggeredAt }
      })
      .filter(Boolean) as PriceAlert[]
  } catch {
    return []
  }
}

function loadHistory(): AlertTrigger[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_HISTORY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((h: any): AlertTrigger | null => {
        const alertId = String(h?.alertId ?? "").trim()
        const triggeredAt = Number(h?.triggeredAt ?? 0)
        const title = String(h?.title ?? "").trim()
        const message = String(h?.message ?? "").trim()
        const symbol = h?.symbol ? String(h.symbol) : undefined
        const currentPrice = h?.currentPrice !== undefined ? Number(h.currentPrice) : undefined
        if (!alertId || !triggeredAt || !title || !message) return null
        return { alertId, triggeredAt, title, message, symbol, currentPrice }
      })
      .filter(Boolean) as AlertTrigger[]
  } catch {
    return []
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [history, setHistory] = useState<AlertTrigger[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const [tickLoading, setTickLoading] = useState(false)

  const [symbol, setSymbol] = useState("BTC-USDT")
  const [condition, setCondition] = useState<PriceAlert["condition"]>("ABOVE")
  const [price, setPrice] = useState(85_000)
  const [message, setMessage] = useState("Key level")
  const [recurring, setRecurring] = useState(false)

  const [contracts, setContracts] = useState<Array<{ symbol: string; asset?: string; currency?: string }>>([])
  const [contractsLoading, setContractsLoading] = useState(false)
  const [symbolQuery, setSymbolQuery] = useState("")

  const lastPriceRef = useRef<Record<string, number>>({})
  const tickLockRef = useRef(false)

  useEffect(() => {
    setAlerts(loadAlerts())
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    let mounted = true
    setContractsLoading(true)
    fetch("/api/bingx/contracts", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: any) => {
        if (!mounted) return
        const rows = Array.isArray(json?.data?.data) ? json.data.data : Array.isArray(json?.data) ? json.data : []
        const allowedCurrency = new Set(["USDT", "USDC", "USD"])
        const candidates: Array<{ symbol: string; asset?: string; currency?: string; status: number; apiStateOpen: string }> = rows.map(
          (c: any) => ({
            symbol: String(c?.symbol ?? "").trim(),
            asset: c?.asset ? String(c.asset) : undefined,
            currency: c?.currency ? String(c.currency) : undefined,
            status: Number(c?.status ?? 0),
            apiStateOpen: String(c?.apiStateOpen ?? "").toLowerCase()
          })
        )
        const list: Array<{ symbol: string; asset?: string; currency?: string }> = candidates
          .filter((c) => c.symbol && c.symbol.includes("-") && !c.symbol.includes("_"))
          .filter((c) => c.status === 1 && c.apiStateOpen === "true")
          .filter((c) => allowedCurrency.has(String(c.currency ?? "").toUpperCase()))
          .map((c) => ({ symbol: c.symbol.toUpperCase(), asset: c.asset, currency: c.currency }))
          .sort((a, b) => a.symbol.localeCompare(b.symbol))
        setContracts(list)
        if (list.length && !list.some((x) => x.symbol === symbol)) setSymbol(list[0]!.symbol)
      })
      .catch(() => {
        if (!mounted) return
        setContracts([])
      })
      .finally(() => {
        if (!mounted) return
        setContractsLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [symbol])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_ALERTS, JSON.stringify(alerts))
  }, [alerts])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(0, 200)))
  }, [history])

  const symbols = useMemo(() => Array.from(new Set(alerts.map((a) => a.symbol))), [alerts])

  const addPriceAlert = () => {
    setError("")
    if (!symbol.trim()) return
    if (contracts.length) {
      const ok = contracts.some((c) => c.symbol === symbol.trim().toUpperCase())
      if (!ok) {
        setError("Symbol must be a USD-M perpetual futures contract (from the list).")
        return
      }
    }
    const p = clampNumber(price, 0, 1_000_000_000)
    if (p <= 0) return
    const a: PriceAlert = {
      id: nowId(),
      type: "PRICE",
      symbol: symbol.trim(),
      condition,
      price: p,
      message: message.trim(),
      recurring,
      createdAt: Date.now()
    }
    setAlerts((prev) => [a, ...prev].slice(0, 100))
  }

  const removeAlert = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id))

  const testAlert = async (a: PriceAlert) => {
    const msg = `🔔 <b>PRICE ALERT TEST</b>
━━━━━━━━━━━━━━
${a.symbol} ${a.condition} $${a.price.toFixed(2)}
Note: ${a.message || "—"}`
    await sendTelegram(msg).catch(() => undefined)
  }

  const tick = async () => {
    setError("")
    if (tickLockRef.current) return
    tickLockRef.current = true
    setTickLoading(true)
    try {
      const prices: Record<string, number> = {}
      for (const sym of symbols) {
        const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" })
        const json = (await res.json()) as any
        const raw = json?.data?.price
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
        if (Number.isFinite(n)) prices[sym] = n
      }

      const triggers: AlertTrigger[] = []
      const nextAlerts = alerts.map((a) => {
        const cur = prices[a.symbol]
        if (!cur || !Number.isFinite(cur)) return a
        const prev = lastPriceRef.current[a.symbol]
        const tr = evaluatePriceAlert({ alert: a, currentPrice: cur, prevPrice: prev, now: Date.now() })
        if (!tr) return a
        triggers.push(tr)
        return applyPriceTrigger(a, tr)
      })

      for (const sym of Object.keys(prices)) lastPriceRef.current[sym] = prices[sym]

      if (triggers.length) {
        setAlerts(nextAlerts)
        setHistory((prev) => [...triggers, ...prev].slice(0, 200))
        for (const tr of triggers) {
          const msg = `🔔 <b>${tr.title}</b>
━━━━━━━━━━━━━━
${tr.message}`
          await sendTelegram(msg).catch(() => undefined)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tick failed"
      setError(msg)
    } finally {
      setTickLoading(false)
      tickLockRef.current = false
    }
  }

  const tickRef = useRef(tick)
  useEffect(() => {
    tickRef.current = tick
  })

  useEffect(() => {
    if (!running) return
    let stopped = false
    const run = async () => {
      if (stopped) return
      await tickRef.current()
    }
    void run()
    const t = window.setInterval(() => void run(), 5_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [running])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">🔔 SMART ALERTS</div>
        <div className="text-sm text-white/60">Price alerts are live; indicator/pattern/PnL alerts can be added next.</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Section title="NEW PRICE ALERT">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/60">
              Symbols here are restricted to futures contracts (USD-M Perp).
            </div>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Symbol</div>
              <div className="space-y-2">
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  placeholder={contractsLoading ? "Loading futures symbols..." : "Search (e.g., BTC, ETH, SOL)"}
                  value={symbolQuery}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                />
                <select
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {(symbolQuery.trim()
                    ? contracts.filter((c) => c.symbol.toUpperCase().includes(symbolQuery.trim().toUpperCase()))
                    : contracts
                  )
                    .slice(0, 500)
                    .map((c) => (
                      <option key={c.symbol} value={c.symbol}>
                        {c.symbol}
                      </option>
                    ))}
                </select>
              </div>
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Condition</div>
              <select
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={condition}
                onChange={(e) => setCondition(e.target.value as PriceAlert["condition"])}
              >
                <option value="ABOVE">ABOVE</option>
                <option value="BELOW">BELOW</option>
                <option value="CROSSES">CROSSES</option>
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Price</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={price}
                onChange={(e) => setPrice(clampNumber(Number(e.target.value), 0, 1_000_000_000))}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Message</div>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-sm text-white/80">Recurring</div>
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            </label>
            <button
              type="button"
              className="w-full rounded-lg bg-[#00FF88]/20 px-3 py-2 text-xs font-semibold text-[#00FF88]"
              onClick={addPriceAlert}
            >
              + New Alert
            </button>
          </Section>

          <Section title="RUNNER">
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              disabled={tickLoading}
              onClick={() => void tick()}
            >
              {tickLoading ? "Checking…" : "Check Now"}
            </button>
            <button
              type="button"
              className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${running ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/70 hover:text-white"}`}
              disabled={tickLoading}
              onClick={() => setRunning((v) => !v)}
            >
              {tickLoading ? "Checking…" : running ? "Running ✅ (5s)" : "Start (5s)"}
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>
        </div>

        <div className="min-w-0 space-y-6">
          <Section title={`ACTIVE ALERTS (${alerts.length})`}>
            {alerts.length ? (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">
                        {a.symbol} {a.condition} ${a.price.toFixed(2)}
                      </div>
                      <div className="text-xs text-white/50">{a.recurring ? "Recurring" : "One-shot"}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/60">{a.message || "—"}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
                        onClick={() => void testAlert(a)}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
                        onClick={() => removeAlert(a.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No alerts yet.</div>
            )}
          </Section>

          <Section title={`ALERT HISTORY (${history.length})`}>
            {history.length ? (
              <div className="space-y-2">
                {history.slice(0, 30).map((h) => (
                  <div key={`${h.alertId}_${h.triggeredAt}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{h.title}</div>
                      <div className="text-xs text-white/50">{new Date(h.triggeredAt).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/70 whitespace-pre-line">{h.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No alerts fired yet.</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
