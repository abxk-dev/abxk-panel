"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { PUMP_THRESHOLDS, type PumpLevel } from "@/lib/pumpDetector"

type PumpHistoryState = {
  updatedAt: number
  openTrades?: Array<{
    id: string
    source?: "PUMP1" | "PUMP2"
    symbol: string
    pumpLevel: PumpLevel
    entryPrice: number
    currentPrice?: number
    pnlPercent?: number
    tpPrice?: number
    slPrice?: number
    leverage?: number
    margin?: number
    positionValue?: number
    phase?: string
    openedAt: number
    execMode: "paper" | "live"
  }>
  closedTrades?: Array<{
    id: string
    source?: "PUMP1" | "PUMP2"
    symbol: string
    pumpLevel: PumpLevel
    entryPrice: number
    closePrice?: number
    grossPnlUsd?: number
    netPnlUsd?: number
    feesUsd?: number
    reason?: string
    openedAt: number
    closedAt?: number
    execMode: "paper" | "live"
  }>
  history?: Array<{
    symbol: string
    level: PumpLevel
    priceChange1m?: number
    priceChange5m: number
    priceChange15m?: number
    volumeRatio: number
    confidence: number
    action: "ALERT" | "SHORT"
    detectedAt: number
  }>
}

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

function safeNum(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

function normalizeTsMs(v: unknown): number | undefined {
  const n = safeNum(v)
  if (n === undefined) return undefined
  if (n > 0 && n < 10_000_000_000) return n * 1000
  return n
}

function normalizePumpSource(raw: unknown): "PUMP1" | "PUMP2" {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, "")
  if (s === "PUMP2" || s === "PUMPALERT2" || s === "ALERT2") return "PUMP2"
  return "PUMP1"
}

function pnlClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-white/80"
  return n > 0 ? "text-[#00FF88]" : "text-red-400"
}

export default function PumpAlertHistoryPage() {
  const [state, setState] = useState<PumpHistoryState>({ updatedAt: Date.now() })
  const [loadingState, setLoadingState] = useState(true)
  const [refreshingState, setRefreshingState] = useState(false)
  const [source, setSource] = useState<"ALL" | "PUMP1" | "PUMP2">("ALL")
  const [view, setView] = useState<"ALL" | "ALERTS" | "OPEN" | "CLOSED">("ALL")
  const [level, setLevel] = useState<"ALL" | PumpLevel>("ALL")
  const [symbolQuery, setSymbolQuery] = useState("")
  const [pnlDay, setPnlDay] = useState<"TODAY" | "YESTERDAY">("TODAY")
  const [restartLoading, setRestartLoading] = useState(false)
  const [restartMsg, setRestartMsg] = useState<string | null>(null)

  const stateUpdatedAtRef = useRef(0)
  const refreshSeqRef = useRef(0)
  const refreshAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let mounted = true
    const tick = async () => {
      refreshSeqRef.current += 1
      const seq = refreshSeqRef.current
      refreshAbortRef.current?.abort()
      const ctrl = new AbortController()
      refreshAbortRef.current = ctrl
      setRefreshingState(true)
      try {
        const res = await fetch("/api/pump/state", { cache: "no-store", signal: ctrl.signal }).catch(() => null)
        if (!res) return
        const json = (await res.json().catch(() => null)) as any
        const data = json?.data
        if (seq !== refreshSeqRef.current || !data || typeof data !== "object") return
        if (!mounted) return

        const rawUpdatedAt = normalizeTsMs((data as any).updatedAt) ?? Date.now()
        if (rawUpdatedAt > 0 && rawUpdatedAt < stateUpdatedAtRef.current) return
        if (rawUpdatedAt > 0) stateUpdatedAtRef.current = rawUpdatedAt

        const normalizeOpenTrades = (raw: any[]): PumpHistoryState["openTrades"] => {
          return raw
            .filter((t) => t && typeof t === "object")
            .map((t) => {
              const execMode = t.execMode === "live" ? "live" : "paper"
              const source = normalizePumpSource(t.source)
              return {
                id: String(t.id),
                source,
                symbol: String(t.symbol ?? ""),
                pumpLevel: t.pumpLevel as PumpLevel,
                entryPrice: safeNum(t.entryPrice) ?? 0,
                currentPrice: safeNum(t.currentPrice),
                pnlPercent: safeNum(t.pnlPercent),
                tpPrice: safeNum(t.tpPrice),
                slPrice: safeNum(t.slPrice),
                leverage: safeNum(t.leverage),
                margin: safeNum(t.margin),
                positionValue: safeNum(t.positionValue),
                phase: typeof t.phase === "string" ? t.phase : undefined,
                openedAt: normalizeTsMs(t.openedAt) ?? 0,
                execMode
              }
            })
        }

      const normalizeClosedTrades = (raw: any[]): PumpHistoryState["closedTrades"] => {
        return raw
          .filter((t) => t && typeof t === "object")
          .map((t) => {
            const execMode = t.execMode === "live" ? "live" : "paper"
            const source = normalizePumpSource(t.source)
            const entryPrice = safeNum(t.entryPrice) ?? 0
            const closePrice = safeNum(t.closePrice)
            const positionValue = safeNum(t.positionValue)
            const gross =
              safeNum(t.grossPnlUsd) ??
              safeNum(t.grossPnl) ??
              safeNum(t.gross) ??
              (positionValue !== undefined && entryPrice > 0 && closePrice !== undefined
                ? positionValue * (((entryPrice - closePrice) / entryPrice) * 100 / 100)
                : undefined)
            const fees =
              safeNum(t.feesUsd) ??
              safeNum(t.feeUsd) ??
              safeNum(t.fees) ??
              safeNum(t.fee) ??
              (positionValue !== undefined ? positionValue * 0.001 : undefined)
            const net =
              safeNum(t.netPnlUsd) ??
              safeNum(t.netPnl) ??
              safeNum(t.pnlUsd) ??
              safeNum(t.pnl) ??
              (gross !== undefined && fees !== undefined ? gross - fees : undefined)
            const openedAt = normalizeTsMs(t.openedAt) ?? 0
            const closedAt =
              normalizeTsMs(t.closedAt) ??
              normalizeTsMs(t.closed_at) ??
              normalizeTsMs(t.closedTime) ??
              normalizeTsMs(t.timestamp) ??
              openedAt
            return {
              id: String(t.id),
              source,
              symbol: String(t.symbol ?? ""),
              pumpLevel: t.pumpLevel as PumpLevel,
              entryPrice,
              closePrice,
              grossPnlUsd: gross,
              netPnlUsd: net,
              feesUsd: fees,
              reason: typeof t.reason === "string" ? t.reason : typeof t.closeReason === "string" ? t.closeReason : undefined,
              openedAt,
              closedAt,
              execMode
            }
          })
      }

      const normalizeAlerts = (raw: any[]): PumpHistoryState["history"] => {
        return raw
          .filter((a) => a && typeof a === "object")
          .map((a) => ({
            symbol: String(a.symbol ?? ""),
            level: a.level as PumpLevel,
            priceChange1m: safeNum(a.priceChange1m),
            priceChange5m: safeNum(a.priceChange5m) ?? 0,
            priceChange15m: safeNum(a.priceChange15m),
            volumeRatio: safeNum(a.volumeRatio) ?? 0,
            confidence: safeNum(a.confidence) ?? 0,
            action: a.action === "SHORT" ? "SHORT" : "ALERT",
            detectedAt: normalizeTsMs(a.detectedAt) ?? 0
          }))
      }

        setState({
          updatedAt: rawUpdatedAt,
          openTrades: normalizeOpenTrades(Array.isArray(data.openTrades) ? data.openTrades : []),
          closedTrades: normalizeClosedTrades(Array.isArray(data.closedTrades) ? data.closedTrades : []),
          history: normalizeAlerts(Array.isArray(data.history) ? data.history : Array.isArray(data.recentPumps) ? data.recentPumps : [])
        })
        setLoadingState(false)
      } finally {
        if (seq === refreshSeqRef.current) setRefreshingState(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 3000)
    return () => {
      mounted = false
      refreshAbortRef.current?.abort()
      window.clearInterval(t)
    }
  }, [])

  const restart = async () => {
    setRestartLoading(true)
    setRestartMsg(null)
    try {
      const res = await fetch("/api/pump/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPumpLogs: true })
      })
      const json = (await res.json().catch(() => null)) as any
      if (!json?.ok) {
        setRestartMsg("Failed to restart history")
        return
      }
      setState((s) => ({ ...s, updatedAt: Date.now(), closedTrades: [], history: [] }))
      setRestartMsg("Restart requested. Logs will clear in a few seconds.")
    } catch {
      setRestartMsg("Failed to restart history")
    } finally {
      setRestartLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase()
    const sourceOk = (s?: string) => {
      if (source === "ALL") return true
      if (source === "PUMP1") return s === "PUMP1" || !s
      return s === "PUMP2"
    }
    const levelOk = (lv?: string) => level === "ALL" || lv === level

    const openTrades = (state.openTrades ?? [])
      .filter((t) => sourceOk(t.source))
      .filter((t) => levelOk(t.pumpLevel))
      .filter((t) => (!q ? true : String(t.symbol).toUpperCase().includes(q)))

    const closedTrades = (state.closedTrades ?? [])
      .filter((t) => sourceOk(t.source))
      .filter((t) => levelOk(t.pumpLevel))
      .filter((t) => (!q ? true : String(t.symbol).toUpperCase().includes(q)))

    const alerts = (state.history ?? [])
      .filter((a) => levelOk(a.level))
      .filter((a) => (!q ? true : String(a.symbol).toUpperCase().includes(q)))

    return { openTrades, closedTrades, alerts }
  }, [level, source, state.closedTrades, state.history, state.openTrades, symbolQuery])

  const tradeBySymbol = useMemo(() => {
    const m: Record<string, { status: "OPEN" | "CLOSED"; source?: "PUMP1" | "PUMP2"; ts: number }> = {}
    for (const t of filtered.closedTrades) {
      const sym = String(t.symbol)
      const ts = Number(t.closedAt ?? 0) || 0
      if (!m[sym] || ts > m[sym].ts) m[sym] = { status: "CLOSED", source: t.source, ts }
    }
    for (const t of filtered.openTrades) {
      const sym = String(t.symbol)
      const ts = Number(t.openedAt ?? 0) || 0
      m[sym] = { status: "OPEN", source: t.source, ts }
    }
    return m
  }, [filtered.closedTrades, filtered.openTrades])

  const pnlSummary = useMemo(() => {
    const dayKeyUtc = (ts: number): string => {
      const d = new Date(ts)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    }
    const todayKey = dayKeyUtc(Date.now())
    const yesterdayKey = dayKeyUtc(Date.now() - 24 * 60 * 60 * 1000)
    const targetKey = pnlDay === "YESTERDAY" ? yesterdayKey : todayKey

    let pump1 = 0
    let pump2 = 0
    let pump1Trades = 0
    let pump2Trades = 0

    for (const t of state.closedTrades ?? []) {
      const closedAt = typeof t.closedAt === "number" ? t.closedAt : NaN
      if (!Number.isFinite(closedAt)) continue
      if (dayKeyUtc(closedAt) !== targetKey) continue

      const gross = safeNum(t.grossPnlUsd)
      const fees = safeNum(t.feesUsd)
      const pnl = safeNum(t.netPnlUsd) ?? (gross !== undefined && fees !== undefined ? gross - fees : undefined)
      if (pnl === undefined) continue

      if (t.source === "PUMP2") {
        pump2 += pnl
        pump2Trades += 1
      } else {
        pump1 += pnl
        pump1Trades += 1
      }
    }

    return {
      key: targetKey,
      pump1,
      pump2,
      total: pump1 + pump2,
      pump1Trades,
      pump2Trades,
      totalTrades: pump1Trades + pump2Trades
    }
  }, [pnlDay, state.closedTrades])

  const showAlerts = view === "ALL" || view === "ALERTS"
  const showOpen = view === "ALL" || view === "OPEN"
  const showClosed = view === "ALL" || view === "CLOSED"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Pump Alert History</div>
          <div className="mt-1 text-xs text-white/40">
            {loadingState ? "Loading..." : refreshingState ? "Refreshing..." : `Updated: ${new Date(state.updatedAt).toLocaleTimeString()}`}
          </div>
          {restartMsg ? <div className="mt-1 text-xs text-white/60">{restartMsg}</div> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
            value={pnlDay}
            onChange={(e) => setPnlDay(e.target.value === "YESTERDAY" ? "YESTERDAY" : "TODAY")}
          >
            <option value="TODAY">PnL: Today</option>
            <option value="YESTERDAY">PnL: Yesterday</option>
          </select>
          <input
            className="w-[220px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
            placeholder="Search symbol..."
            value={symbolQuery}
            onChange={(e) => setSymbolQuery(e.target.value)}
          />
          <select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
            value={source}
            onChange={(e) => setSource(e.target.value === "PUMP2" ? "PUMP2" : e.target.value === "PUMP1" ? "PUMP1" : "ALL")}
          >
            <option value="ALL">All sources</option>
            <option value="PUMP1">Pump Alert 1</option>
            <option value="PUMP2">Pump Alert 2</option>
          </select>
          <select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
            value={view}
            onChange={(e) => {
              const v = e.target.value
              setView(v === "ALERTS" || v === "OPEN" || v === "CLOSED" ? v : "ALL")
            }}
          >
            <option value="ALL">All</option>
            <option value="ALERTS">Alerts</option>
            <option value="OPEN">Open trades</option>
            <option value="CLOSED">Closed trades</option>
          </select>
          <select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
            value={level}
            onChange={(e) => {
              const v = e.target.value
              setLevel(v === "LOW" || v === "MEDIUM" || v === "HIGH" || v === "EXTREME" ? (v as PumpLevel) : "ALL")
            }}
          >
            <option value="ALL">All levels</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="EXTREME">EXTREME</option>
          </select>
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${restartLoading ? "bg-white/10 text-white/50" : "bg-red-500 text-white"}`}
            onClick={() => void restart()}
            disabled={restartLoading}
          >
            Restart
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs text-white/50">PUMP1 PnL ({pnlDay === "YESTERDAY" ? "Yesterday" : "Today"})</div>
          <div className={`mt-1 text-lg font-semibold ${loadingState ? "text-white/60" : pnlClass(pnlSummary.pump1)}`}>
            {loadingState ? "Loading..." : `${pnlSummary.pump1 >= 0 ? "+" : ""}$${fmt(pnlSummary.pump1, 2)}`}
          </div>
          <div className="mt-1 text-xs text-white/40">Trades: {loadingState ? "—" : pnlSummary.pump1Trades}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs text-white/50">PUMP2 PnL ({pnlDay === "YESTERDAY" ? "Yesterday" : "Today"})</div>
          <div className={`mt-1 text-lg font-semibold ${loadingState ? "text-white/60" : pnlClass(pnlSummary.pump2)}`}>
            {loadingState ? "Loading..." : `${pnlSummary.pump2 >= 0 ? "+" : ""}$${fmt(pnlSummary.pump2, 2)}`}
          </div>
          <div className="mt-1 text-xs text-white/40">Trades: {loadingState ? "—" : pnlSummary.pump2Trades}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs text-white/50">TOTAL PnL ({pnlDay === "YESTERDAY" ? "Yesterday" : "Today"})</div>
          <div className={`mt-1 text-lg font-semibold ${loadingState ? "text-white/60" : pnlClass(pnlSummary.total)}`}>
            {loadingState ? "Loading..." : `${pnlSummary.total >= 0 ? "+" : ""}$${fmt(pnlSummary.total, 2)}`}
          </div>
          <div className="mt-1 text-xs text-white/40">Trades: {loadingState ? "—" : pnlSummary.totalTrades}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs text-white/50">UTC Day</div>
          <div className="mt-1 text-lg font-semibold text-white">{pnlSummary.key}</div>
          <div className="mt-1 text-xs text-white/40">Source: closed trades</div>
        </div>
      </div>

      {showOpen ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">OPEN POSITIONS</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[1240px] w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/50">
                <tr>
                  <th className="py-2">Symbol</th>
                  <th>Source</th>
                  <th>Level</th>
                  <th>Entry</th>
                  <th>Current</th>
                  <th>Lev</th>
                  <th>Margin</th>
                  <th>Position</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>PnL ($)</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.openTrades.length ? (
                  filtered.openTrades.map((t) => {
                    const entry = Number(t.entryPrice)
                    const pv = Number(t.positionValue ?? 0)
                    const pp = typeof t.pnlPercent === "number" ? t.pnlPercent : NaN
                    const pnlUsd = Number.isFinite(pv) && Number.isFinite(pp) ? pv * (pp / 100) : NaN
                    return (
                      <tr key={t.id} className="border-t border-white/5">
                        <td className="py-2">{t.symbol}</td>
                        <td>{t.source ?? "PUMP1"}</td>
                        <td>
                          {t.pumpLevel} {PUMP_THRESHOLDS[t.pumpLevel].color}
                        </td>
                        <td>{Number.isFinite(entry) ? `$${entry.toFixed(6)}` : "—"}</td>
                        <td>{typeof t.currentPrice === "number" ? `$${t.currentPrice.toFixed(6)}` : "—"}</td>
                        <td>{typeof t.leverage === "number" ? `${t.leverage}x` : "—"}</td>
                        <td>{typeof t.margin === "number" ? `$${fmt(t.margin, 2)}` : "—"}</td>
                        <td>{typeof t.positionValue === "number" ? `$${fmt(t.positionValue, 2)}` : "—"}</td>
                        <td>{typeof t.slPrice === "number" ? `$${t.slPrice.toFixed(6)}` : "—"}</td>
                        <td>{typeof t.tpPrice === "number" ? `$${t.tpPrice.toFixed(6)}` : "—"}</td>
                        <td>
                          {Number.isFinite(pnlUsd) ? (
                            <span className={pnlClass(pnlUsd)}>
                              {pnlUsd >= 0 ? "+" : ""}${fmt(pnlUsd, 2)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{new Date(t.openedAt).toLocaleTimeString()}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td className="py-2 text-white/50" colSpan={12}>
                      {loadingState ? "Loading..." : "No open positions"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showClosed ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">CLOSED TRADES</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[1240px] w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/50">
                <tr>
                  <th className="py-2">Symbol</th>
                  <th>Source</th>
                  <th>Level</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Gross</th>
                  <th>Fees</th>
                  <th>Net</th>
                  <th>Reason</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {filtered.closedTrades.length ? (
                  filtered.closedTrades.map((t) => (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="py-2">{t.symbol}</td>
                      <td>{t.source ?? "PUMP1"}</td>
                      <td>
                        {t.pumpLevel} {PUMP_THRESHOLDS[t.pumpLevel].color}
                      </td>
                      <td>{Number.isFinite(Number(t.entryPrice)) ? `$${Number(t.entryPrice).toFixed(6)}` : "—"}</td>
                      <td>{typeof t.closePrice === "number" ? `$${t.closePrice.toFixed(6)}` : "—"}</td>
                      <td>
                        {typeof t.grossPnlUsd === "number" ? (
                          <span className={pnlClass(t.grossPnlUsd)}>
                            {t.grossPnlUsd >= 0 ? "+" : ""}${fmt(t.grossPnlUsd, 2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={typeof t.feesUsd === "number" && Math.abs(t.feesUsd) > 0 ? "text-red-400" : "text-white/80"}>
                        {typeof t.feesUsd === "number" ? `-$${fmt(Math.abs(t.feesUsd), 2)}` : "—"}
                      </td>
                      <td>
                        {typeof t.netPnlUsd === "number" ? (
                          <span className={pnlClass(t.netPnlUsd)}>
                            {t.netPnlUsd >= 0 ? "+" : ""}$${fmt(t.netPnlUsd, 2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{t.reason ?? "—"}</td>
                      <td>{new Date(t.openedAt).toLocaleTimeString()}</td>
                      <td>{typeof t.closedAt === "number" ? new Date(t.closedAt).toLocaleTimeString() : "—"}</td>
                      <td>{t.execMode.toUpperCase()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2 text-white/50" colSpan={12}>
                      {loadingState ? "Loading..." : "No closed trades"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showAlerts ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">PUMP ALERT HISTORY</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[1120px] w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/50">
                <tr>
                  <th className="py-2">Symbol</th>
                  <th>Level</th>
                  <th>Move 1m</th>
                  <th>Move 5m</th>
                  <th>Move 15m</th>
                  <th>VolX</th>
                  <th>Conf</th>
                  <th>Trade</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.alerts.length ? (
                  filtered.alerts.slice(0, 500).map((a) => {
                    const last = tradeBySymbol[a.symbol]
                    const status = last ? `${last.status}${last.source ? ` (${last.source})` : ""}` : "—"
                    return (
                      <tr key={`${a.symbol}-${a.detectedAt}`} className="border-t border-white/5">
                        <td className="py-2">{a.symbol}</td>
                        <td>
                          {a.level} {PUMP_THRESHOLDS[a.level].color}
                        </td>
                        <td>{typeof a.priceChange1m === "number" ? `+${fmt(a.priceChange1m, 2)}%` : "—"}</td>
                        <td>+{fmt(a.priceChange5m, 2)}%</td>
                        <td>{typeof a.priceChange15m === "number" ? `+${fmt(a.priceChange15m, 2)}%` : "—"}</td>
                        <td>{fmt(a.volumeRatio, 2)}x</td>
                        <td>{fmt(a.confidence, 0)}</td>
                        <td>{a.action}</td>
                        <td>{status}</td>
                        <td>{new Date(a.detectedAt).toLocaleTimeString()}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td className="py-2 text-white/50" colSpan={10}>
                      {loadingState ? "Loading..." : "No history"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
