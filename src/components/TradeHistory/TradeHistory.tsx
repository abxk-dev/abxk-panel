"use client"

import { useMemo, useState } from "react"
import { useBotStore } from "@/store/botStore"

export function TradeHistory() {
  const [tab, setTab] = useState<"paper" | "live">("paper")
  const paper = useBotStore((s) => s.paperTrades)
  const live = useBotStore((s) => s.liveTrades)
  const mode = useBotStore((s) => s.settings.mode)
  const settingsSymbol = useBotStore((s) => s.settings.symbol)

  const [testerSymbol, setTesterSymbol] = useState<string>(settingsSymbol)
  const [testerSide, setTesterSide] = useState<"LONG" | "SHORT">("LONG")
  const [testerQty, setTesterQty] = useState<number>(1)
  const [autoCloseSec, setAutoCloseSec] = useState<number>(5)
  const [busy, setBusy] = useState<boolean>(false)
  const [msg, setMsg] = useState<string>("")
  const [details, setDetails] = useState<string>("")
  const [minHint, setMinHint] = useState<string>("")

  const rows = useMemo(() => (tab === "paper" ? paper : live), [tab, paper, live])

  const canLive = mode === "live" || mode === "mirror"

  const showResult = (title: string, res: { status: number; body: unknown }) => {
    const pretty = safeStringify(res.body)
    setDetails(`${title}\nHTTP ${res.status}\n${pretty}`)
  }

  const place = async (intent: "OPEN" | "CLOSE"): Promise<boolean> => {
    setMsg("")
    setDetails("")
    if (!canLive) {
      setMsg("Switch mode to LIVE or MIRROR to test real BingX orders.")
      return false
    }
    const symbol = testerSymbol.trim() || settingsSymbol
    const quantity = Number(testerQty)
    if (!symbol) {
      setMsg("Symbol is required.")
      return false
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMsg("Quantity must be > 0.")
      return false
    }

    setBusy(true)
    const payload: any = {
      symbol,
      tradeSide: testerSide,
      orderType: "MARKET",
      quantity,
      intent
    }
    if (intent === "CLOSE") payload.reduceOnly = true

    const res = await fetch("/api/bingx/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => null)

    if (!res) {
      setMsg("Request failed (network).")
      setBusy(false)
      return false
    }

    const raw = await res.text()
    const json = parseMaybeJson(raw)
    const body = json ?? raw
    showResult(intent === "OPEN" ? "OPEN RESULT" : "CLOSE RESULT", { status: res.status, body })

    const routeError = json && typeof json === "object" && (json as any).ok === false
    const bingxCode =
      json && typeof json === "object" && typeof (json as any).code === "number" ? Number((json as any).code) : undefined
    if (!res.ok || routeError || (bingxCode !== undefined && bingxCode !== 0)) {
      const err =
        json && typeof json === "object"
          ? String((json as any).error ?? (json as any).msg ?? (json as any).message ?? "Order failed.")
          : "Order failed."
      setMsg(err)
      setBusy(false)
      return false
    }

    const orderId =
      json && typeof json === "object"
        ? ((json as any)?.data?.orderId ?? (json as any)?.data?.data?.orderId ?? (json as any)?.orderId ?? undefined)
        : undefined
    setMsg(intent === "OPEN" ? `Opened test trade${orderId ? ` (orderId ${orderId})` : ""}.` : "Closed test trade.")
    setBusy(false)
    return true
  }

  const checkKeys = async () => {
    setMsg("")
    setDetails("")
    setBusy(true)
    const res = await fetch("/api/bingx/balance", { cache: "no-store" }).catch(() => null)
    if (!res) {
      setMsg("Key check failed (network).")
      setBusy(false)
      return
    }
    const raw = await res.text()
    const json = parseMaybeJson(raw)
    const body = json ?? raw
    showResult("KEY CHECK (BALANCE)", { status: res.status, body })
    if (!res.ok) {
      setMsg("Key check failed.")
      setBusy(false)
      return
    }
    setMsg("Keys look OK (balance endpoint responded).")
    setBusy(false)
  }

  const suggestMinQty = async () => {
    setMinHint("")
    const symbol = testerSymbol.trim() || settingsSymbol
    if (!symbol) return
    const [contracts, price] = await Promise.all([
      fetch("/api/bingx/contracts", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)
    ])
    const rows: any[] = Array.isArray(contracts?.data?.data) ? contracts.data.data : Array.isArray(contracts?.data) ? contracts.data : []
    const row = rows.find((x) => String(x?.symbol) === symbol)
    const minQty = row ? Number(row.tradeMinQuantity ?? row.tradeMinQty ?? row.minQty) : undefined
    const minUsdt = row ? Number(row.tradeMinUSDT ?? row.tradeMinUsdt ?? row.minUsdt) : undefined
    const pRow = (price as any)?.data ?? price
    const last = Number(pRow?.price ?? pRow?.lastPrice ?? pRow?.data?.price)
    const priceOk = Number.isFinite(last) && last > 0 ? last : undefined
    const minFromUsdt = minUsdt && priceOk ? minUsdt / priceOk : undefined
    const hintParts: string[] = []
    if (Number.isFinite(minQty)) hintParts.push(`Min qty: ${minQty}`)
    if (Number.isFinite(minUsdt)) hintParts.push(`Min USDT: $${minUsdt}`)
    if (minFromUsdt !== undefined && Number.isFinite(minFromUsdt)) hintParts.push(`≈ qty ${minFromUsdt.toFixed(6)} at $${priceOk?.toFixed(4)}`)
    setMinHint(hintParts.length ? hintParts.join(" • ") : "Could not read min qty for this symbol.")
  }

  const openAndAutoClose = async () => {
    setMsg("")
    const ok = await place("OPEN")
    if (!ok) return
    const sec = Math.max(0, Math.floor(Number(autoCloseSec)))
    if (sec <= 0) return
    window.setTimeout(() => void place("CLOSE"), sec * 1000)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          className={tabButton(tab === "paper")}
          onClick={() => setTab("paper")}
        >
          Paper
        </button>
        <button
          className={tabButton(tab === "live")}
          onClick={() => setTab("live")}
        >
          Live
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Trade Tester (BingX)</div>
        <div className="grid gap-3 lg:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-white/60">Symbol</div>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={testerSymbol}
              onChange={(e) => setTesterSymbol(e.target.value)}
              placeholder={settingsSymbol}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Side</div>
            <select
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={testerSide}
              onChange={(e) => setTesterSide(e.target.value as any)}
            >
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Quantity</div>
            <input
              type="number"
              step="any"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={testerQty}
              onChange={(e) => setTesterQty(Number(e.target.value))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Auto-close (sec)</div>
            <input
              type="number"
              step="1"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={autoCloseSec}
              onChange={(e) => setAutoCloseSec(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-black hover:bg-brand/90 disabled:opacity-60"
            disabled={busy}
            onClick={() => void place("OPEN")}
          >
            Open
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/5 disabled:opacity-60"
            disabled={busy}
            onClick={() => void place("CLOSE")}
          >
            Close
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/5 disabled:opacity-60"
            disabled={busy}
            onClick={() => void openAndAutoClose()}
          >
            Open + Auto Close
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/5 disabled:opacity-60"
            disabled={busy}
            onClick={() => void checkKeys()}
          >
            Check Keys
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/5 disabled:opacity-60"
            disabled={busy}
            onClick={() => void suggestMinQty()}
          >
            Suggest Min Qty
          </button>
          <div className="flex items-center text-xs text-white/50">
            Mode: {mode.toUpperCase()} {canLive ? "" : "• not live"}
          </div>
        </div>
        {minHint ? <div className="mt-3 text-xs text-white/60">{minHint}</div> : null}
        {msg ? <div className="mt-3 text-xs text-white/70">{msg}</div> : null}
        {details ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
            {details}
          </pre>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/40 text-xs uppercase text-white/60">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Entry</th>
              <th className="px-3 py-2">SL</th>
              <th className="px-3 py-2">TP</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">PnL (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-black/20">
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 text-white/70">
                  {new Date(t.openedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-white/80">{t.symbol}</td>
                <td className="px-3 py-2">
                  <span className={t.side === "LONG" ? "text-emerald-400" : "text-rose-400"}>
                    {t.side}
                  </span>
                </td>
                <td className="px-3 py-2 text-white/80">{formatQty(t.quantity)}</td>
                <td className="px-3 py-2 text-white/80">{t.entryPrice}</td>
                <td className="px-3 py-2 text-white/80">{t.stopLossPrice}</td>
                <td className="px-3 py-2 text-white/80">{t.takeProfitPrice}</td>
                <td className="px-3 py-2 text-white/70">{t.status}</td>
                <td className="px-3 py-2">
                  {t.pnlUsd === undefined ? (
                    <span className="text-white/40">—</span>
                  ) : (
                    <span className={t.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {t.pnlUsd.toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-white/50" colSpan={9}>
                  No trades yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function tabButton(active: boolean): string {
  return active
    ? "rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-black"
    : "rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/5"
}

function formatQty(qty: number): string {
  if (qty >= 1) return qty.toFixed(4)
  if (qty >= 0.01) return qty.toFixed(6)
  return qty.toPrecision(4)
}

function parseMaybeJson(text: string): unknown | null {
  const t = text.trim()
  if (!t) return null
  if (!(t.startsWith("{") || t.startsWith("["))) return null
  try {
    return JSON.parse(t) as unknown
  } catch {
    return null
  }
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
