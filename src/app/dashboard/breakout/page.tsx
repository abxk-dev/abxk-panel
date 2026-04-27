"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Candle, ExecutionMode, Timeframe, TradeSide } from "@/types/bot"
import {
  BREAKOUT_COINS,
  DEFAULT_BREAKOUT_SETTINGS,
  calculateBreakoutLevels,
  confirmBreakoutWithCandle,
  detectBreakout,
  detectConsolidation,
  type BreakoutSignal,
  type BreakoutStrength,
  type BreakoutTradeSettings,
  type ConsolidationZone
} from "@/lib/breakoutEngine"

type BreakoutTrade = {
  id: string
  symbol: string
  timeframe: Timeframe
  mode: ExecutionMode
  side: TradeSide
  strength: BreakoutStrength
  entry: number
  tp1: number
  tp2: number
  sl: number
  rr: number
  openedAt: number
  status: "OPEN" | "CLOSED"
  closeReason?: "TP1" | "TP2" | "SL" | "MANUAL"
  closedAt?: number
  entryCandleTime?: number
  lastPrice?: number
  pnlPct?: number
}

type PendingConfirm = {
  key: string
  signal: BreakoutSignal
  firstSeenCandleTime: number
  createdAt: number
}

type SymbolSnapshot = {
  symbol: string
  zone?: ConsolidationZone
  lastCandleTime?: number
  lastClose?: number
  lastVolumeRatio?: number
  watching: boolean
  breakout?: BreakoutSignal
  confirmPending?: boolean
  error?: string
}

type FetchCandlesResult = { candles: Candle[]; lastCandleTime?: number }

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

async function fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<FetchCandlesResult> {
  const interval = timeframe.toLowerCase()
  const res = await fetch(`/api/chart-data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`, {
    cache: "no-store"
  })
  const json = (await res.json().catch(() => null)) as any
  const rows = Array.isArray(json?.candles) ? json.candles : []
  const candles: Candle[] = rows
    .map((c: any) => ({
      openTime: Number(c?.time ?? c?.openTime),
      open: Number(c?.open),
      high: Number(c?.high),
      low: Number(c?.low),
      close: Number(c?.close),
      volume: Number(c?.volume)
    }))
    .filter((c: Candle) => [c.openTime, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite))
    .sort((a: Candle, b: Candle) => a.openTime - b.openTime)

  return { candles, lastCandleTime: candles[candles.length - 1]?.openTime }
}

function calcPnlPct(side: TradeSide, entry: number, price: number): number {
  if (!Number.isFinite(entry) || entry <= 0) return 0
  const move = side === "LONG" ? price - entry : entry - price
  return (move / entry) * 100
}

function computeCloseReason(trade: BreakoutTrade, price: number): BreakoutTrade["closeReason"] | undefined {
  if (trade.status !== "OPEN") return trade.closeReason
  if (trade.side === "LONG") {
    if (price <= trade.sl) return "SL"
    if (price >= trade.tp2) return "TP2"
    if (price >= trade.tp1) return "TP1"
    return undefined
  }
  if (price >= trade.sl) return "SL"
  if (price <= trade.tp2) return "TP2"
  if (price <= trade.tp1) return "TP1"
  return undefined
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
  suffix?: string
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs text-white/50">
        <span>{props.label}</span>
        {props.suffix ? <span>{props.suffix}</span> : null}
      </div>
      <input
        type="number"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
        value={Number.isFinite(props.value) ? String(props.value) : ""}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

export default function BreakoutPage() {
  const [running, setRunning] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_BREAKOUT_SETTINGS.mode)
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_BREAKOUT_SETTINGS.timeframe)
  const [coinsMode, setCoinsMode] = useState<"ALL" | "ONE">("ALL")
  const [singleCoin, setSingleCoin] = useState<string>(String(BREAKOUT_COINS[0] ?? "BTC-USDT"))

  const [consolidationCandles, setConsolidationCandles] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.detection.consolidationCandles)
  const [maxRangePct, setMaxRangePct] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.detection.maxRangePct)
  const [volumeConfirm, setVolumeConfirm] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.detection.volumeConfirm)
  const [minBreakoutPct, setMinBreakoutPct] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.detection.minBreakoutPct)

  const [tpMultiplier, setTpMultiplier] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.trade.tpMultiplier)
  const [leverage, setLeverage] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.trade.leverage)
  const [marginUsd, setMarginUsd] = useState<number>(DEFAULT_BREAKOUT_SETTINGS.trade.marginUsd)

  const [snapshots, setSnapshots] = useState<Record<string, SymbolSnapshot>>({})
  const [pending, setPending] = useState<Record<string, PendingConfirm>>({})
  const [trades, setTrades] = useState<BreakoutTrade[]>([])
  const [falseBreakouts, setFalseBreakouts] = useState<number>(0)
  const [confirmedBreakouts, setConfirmedBreakouts] = useState<number>(0)

  const scanLockRef = useRef(false)
  const settingsRef = useRef({
    consolidationCandles,
    maxRangePct,
    volumeConfirm,
    minBreakoutPct,
    tpMultiplier,
    leverage,
    marginUsd
  })

  useEffect(() => {
    settingsRef.current = {
      consolidationCandles,
      maxRangePct,
      volumeConfirm,
      minBreakoutPct,
      tpMultiplier,
      leverage,
      marginUsd
    }
  }, [consolidationCandles, maxRangePct, volumeConfirm, minBreakoutPct, tpMultiplier, leverage, marginUsd])

  const symbols = useMemo(() => {
    if (coinsMode === "ONE") return [singleCoin]
    return [...BREAKOUT_COINS]
  }, [coinsMode, singleCoin])

  const tradeSettings = useMemo((): BreakoutTradeSettings => {
    return {
      tpMultiplier: clampNumber(tpMultiplier, 0.5, 20),
      slMode: "inside",
      leverage: clampInt(leverage, 1, 50),
      marginUsd: clampNumber(marginUsd, 1, 10_000)
    }
  }, [tpMultiplier, leverage, marginUsd])

  const stats = useMemo(() => {
    const total = confirmedBreakouts + falseBreakouts
    const falseRate = total ? (falseBreakouts / total) * 100 : 0
    const open = trades.filter((t) => t.status === "OPEN").length
    const closed = trades.filter((t) => t.status === "CLOSED").length
    const wins = trades.filter((t) => t.status === "CLOSED" && (t.closeReason === "TP1" || t.closeReason === "TP2")).length
    const winRate = closed ? (wins / closed) * 100 : 0
    return { open, closed, wins, winRate, falseRate }
  }, [confirmedBreakouts, falseBreakouts, trades])

  const runScanOnce = async () => {
    if (scanLockRef.current) return
    scanLockRef.current = true
    setScanLoading(true)
    try {
    const s = settingsRef.current
    const lookback = clampInt(s.consolidationCandles, 3, 200)
    const limit = Math.max(lookback + 5, 60)
    const updated: Record<string, SymbolSnapshot> = {}
    const pendingNext: Record<string, PendingConfirm> = { ...pending }

    for (const sym of symbols) {
      try {
        const { candles, lastCandleTime } = await fetchCandles(sym, timeframe, limit)
        if (candles.length < lookback + 2) {
          updated[sym] = { symbol: sym, watching: false, error: "Not enough candles" }
          continue
        }

        const zone = detectConsolidation({
          symbol: sym,
          timeframe,
          candles,
          lookback,
          maxRangePct: clampNumber(s.maxRangePct, 0.1, 20)
        })

        const last = candles[candles.length - 1]
        const snapshotPrev = snapshots[sym]

        const breakout =
          zone &&
          detectBreakout({
            candles,
            zone,
            volumeConfirm: clampNumber(s.volumeConfirm, 1, 50),
            minBreakoutPct: clampNumber(s.minBreakoutPct, 0.01, 20)
          })

        if (breakout && zone && lastCandleTime) {
          const key = `${sym}-${timeframe}-${lastCandleTime}`
          if (!pendingNext[key]) {
            pendingNext[key] = {
              key,
              signal: breakout,
              firstSeenCandleTime: lastCandleTime,
              createdAt: Date.now()
            }
          }
        }

        for (const key of Object.keys(pendingNext)) {
          const p = pendingNext[key]
          if (p.signal.symbol !== sym || p.signal.timeframe !== timeframe) continue
          if (!lastCandleTime || lastCandleTime === p.firstSeenCandleTime) continue
          const ok = confirmBreakoutWithCandle({ breakout: p.signal, zone: p.signal.zone, confirmCandle: last })
          delete pendingNext[key]
          if (!ok) {
            setFalseBreakouts((x) => x + 1)
            continue
          }
          setConfirmedBreakouts((x) => x + 1)

          const levels = calculateBreakoutLevels({ breakout: p.signal, tpMultiplier: tradeSettings.tpMultiplier, slMode: "inside" })
          const trade: BreakoutTrade = {
            id: `${p.signal.symbol}-${p.signal.timeframe}-${p.firstSeenCandleTime}`,
            symbol: p.signal.symbol,
            timeframe: p.signal.timeframe,
            mode,
            side: levels.side,
            strength: p.signal.strength,
            entry: levels.entry,
            tp1: levels.tp1,
            tp2: levels.tp2,
            sl: levels.sl,
            rr: levels.rr,
            openedAt: Date.now(),
            status: "OPEN",
            entryCandleTime: p.firstSeenCandleTime,
            lastPrice: last.close,
            pnlPct: calcPnlPct(levels.side, levels.entry, last.close)
          }

          setTrades((prev) => {
            const exists = prev.some((t) => t.id === trade.id)
            if (exists) return prev
            return [trade, ...prev].slice(0, 50)
          })
        }

        const volumeRatio =
          zone && zone.avgVolume > 0 ? Number(last.volume) / zone.avgVolume : snapshotPrev?.lastVolumeRatio ?? undefined

        updated[sym] = {
          symbol: sym,
          zone: zone ?? snapshotPrev?.zone,
          lastCandleTime,
          lastClose: last?.close,
          lastVolumeRatio: Number.isFinite(volumeRatio as number) ? (volumeRatio as number) : undefined,
          watching: Boolean(zone),
          breakout: breakout ?? undefined,
          confirmPending: Object.values(pendingNext).some((p) => p.signal.symbol === sym && p.signal.timeframe === timeframe),
          error: undefined
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Fetch failed"
        updated[sym] = { symbol: sym, watching: false, error: msg }
      }
    }

    setPending(pendingNext)
    setSnapshots((prev) => ({ ...prev, ...updated }))

    setTrades((prev) => {
      const next = prev.map((t) => {
        if (t.status !== "OPEN") return t
        const snap = updated[t.symbol]
        const price = snap?.lastClose
        if (!price || !Number.isFinite(price)) return t
        const closeReason = computeCloseReason(t, price)
        if (!closeReason) {
          return { ...t, lastPrice: price, pnlPct: calcPnlPct(t.side, t.entry, price) }
        }
        return {
          ...t,
          lastPrice: price,
          pnlPct: calcPnlPct(t.side, t.entry, price),
          status: "CLOSED" as const,
          closeReason,
          closedAt: Date.now()
        }
      })
      return next
    })
    } finally {
      setScanLoading(false)
      scanLockRef.current = false
    }
  }

  const runScanOnceRef = useRef(runScanOnce)
  useEffect(() => {
    runScanOnceRef.current = runScanOnce
  })

  useEffect(() => {
    if (!running) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      await runScanOnceRef.current()
    }
    void tick()
    const t = window.setInterval(() => void tick(), 30_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [running, timeframe, symbols])

  const consolidatedRows = useMemo(() => {
    return symbols
      .map((sym) => snapshots[sym])
      .filter(Boolean)
      .sort((a, b) => (a?.watching === b?.watching ? 0 : a?.watching ? -1 : 1))
  }, [symbols, snapshots])

  const activeTrades = useMemo(() => trades.filter((t) => t.status === "OPEN"), [trades])
  const closedTrades = useMemo(() => trades.filter((t) => t.status === "CLOSED"), [trades])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">💥 BREAKOUT HUNTER</div>
        <div className="text-sm text-white/60">Detect tight consolidation and enter on volume breakout</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="CONTROL">
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  running ? "bg-white/5 text-white/60 hover:text-white" : "bg-[#00FF88]/20 text-[#00FF88]"
                }`}
                disabled={running}
                onClick={() => setRunning(true)}
              >
                Start Hunting
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  running ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={() => setRunning(false)}
              >
                Stop
              </button>
            </div>
            <div className="text-xs text-white/50">
              Status: {scanLoading ? "SCANNING…" : running ? "HUNTING" : "IDLE"} • Watching:{" "}
              {Object.values(snapshots).filter((s) => s.watching).length} • Open trades: {stats.open}
            </div>
          </Section>

          <Section title="COINS">
            <Select
              label="Coins"
              value={coinsMode}
              onChange={(v) => setCoinsMode(v === "ONE" ? "ONE" : "ALL")}
              options={[
                { value: "ALL", label: `All ${BREAKOUT_COINS.length}` },
                { value: "ONE", label: "Single coin" }
              ]}
            />
            {coinsMode === "ONE" ? (
              <Select
                label="Symbol"
                value={singleCoin}
                onChange={(v) => setSingleCoin(v)}
                options={[...BREAKOUT_COINS].map((s) => ({ value: s, label: s }))}
              />
            ) : null}
          </Section>

          <Section title="TIMEFRAME & MODE">
            <Select
              label="Timeframe"
              value={timeframe}
              onChange={(v) => setTimeframe(v as Timeframe)}
              options={[
                { value: "15m", label: "15M" },
                { value: "1h", label: "1H" },
                { value: "4h", label: "4H" },
                { value: "1d", label: "1D" }
              ]}
            />
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
          </Section>

          <Section title="DETECTION SETTINGS">
            <NumberInput
              label="Consolidation candles"
              value={consolidationCandles}
              min={3}
              max={50}
              onChange={(v) => setConsolidationCandles(clampInt(v, 3, 50))}
            />
            <NumberInput
              label="Max range %"
              value={maxRangePct}
              min={0.2}
              max={10}
              step={0.1}
              onChange={(v) => setMaxRangePct(clampNumber(v, 0.2, 10))}
              suffix="%"
            />
            <NumberInput
              label="Volume confirm"
              value={volumeConfirm}
              min={1}
              max={10}
              step={0.1}
              onChange={(v) => setVolumeConfirm(clampNumber(v, 1, 10))}
              suffix="x"
            />
            <NumberInput
              label="Min breakout %"
              value={minBreakoutPct}
              min={0.1}
              max={5}
              step={0.1}
              onChange={(v) => setMinBreakoutPct(clampNumber(v, 0.1, 5))}
              suffix="%"
            />
          </Section>

          <Section title="TRADE SETTINGS">
            <NumberInput
              label="TP multiplier"
              value={tpMultiplier}
              min={0.5}
              max={10}
              step={0.5}
              onChange={(v) => setTpMultiplier(clampNumber(v, 0.5, 10))}
              suffix="x range"
            />
            <div className="text-xs text-white/50">SL: inside consolidation zone</div>
            <NumberInput
              label="Leverage"
              value={leverage}
              min={1}
              max={50}
              onChange={(v) => setLeverage(clampInt(v, 1, 50))}
              suffix="x"
            />
            <NumberInput
              label="Margin"
              value={marginUsd}
              min={1}
              max={10_000}
              step={1}
              onChange={(v) => setMarginUsd(clampNumber(v, 1, 10_000))}
              suffix="$"
            />
          </Section>

          <Section title="STATS">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">False breakout rate</div>
                <div className="text-base font-semibold text-white">{fmtPct(stats.falseRate)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Win rate (closed)</div>
                <div className="text-base font-semibold text-white">{fmtPct(stats.winRate)}</div>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">LIVE CONSOLIDATION ZONES</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th className="py-2">Range</th>
                    <th className="py-2">Strength</th>
                    <th className="py-2">Volume</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidatedRows.length ? (
                    consolidatedRows.map((row) => {
                      const zone = row.zone
                      const range = zone ? `${fmtUsd(zone.lowPrice)} - ${fmtUsd(zone.highPrice)} (${fmtPct(zone.rangePercent)})` : "—"
                      const vol = row.lastVolumeRatio ? `${row.lastVolumeRatio.toFixed(2)}x` : "—"
                      const status = row.error
                        ? `Error: ${row.error}`
                        : row.breakout
                          ? `💥 ${row.breakout.type} breakout (${fmtPct(row.breakout.breakoutPercent)})`
                          : row.confirmPending
                            ? "Confirming…"
                            : row.watching
                              ? "Watching"
                              : "—"
                      return (
                        <tr key={row.symbol} className="border-t border-white/10 text-white/80">
                          <td className="py-2 font-semibold">{row.symbol}</td>
                          <td className="py-2">{range}</td>
                          <td className="py-2">{zone?.strength ?? "—"}</td>
                          <td className="py-2">{vol}</td>
                          <td className="py-2">{status}</td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-white/50">
                        No data yet. Start hunting.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">ACTIVE BREAKOUT TRADES</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th className="py-2">Side</th>
                    <th className="py-2">Entry</th>
                    <th className="py-2">PnL</th>
                    <th className="py-2">Strength</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTrades.length ? (
                    activeTrades.map((t) => (
                      <tr key={t.id} className="border-t border-white/10 text-white/80">
                        <td className="py-2 font-semibold">{t.symbol}</td>
                        <td className="py-2">{t.side}</td>
                        <td className="py-2">${fmtUsd(t.entry)}</td>
                        <td className={`py-2 ${t.pnlPct !== undefined && t.pnlPct >= 0 ? "text-[#00FF88]" : "text-red-300"}`}>
                          {t.pnlPct !== undefined ? fmtPct(t.pnlPct) : "—"}
                        </td>
                        <td className="py-2">{t.strength}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white"
                            onClick={() =>
                              setTrades((prev) =>
                                prev.map((x) =>
                                  x.id === t.id && x.status === "OPEN"
                                    ? { ...x, status: "CLOSED", closeReason: "MANUAL", closedAt: Date.now() }
                                    : x
                                )
                              )
                            }
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-white/50">
                        No active trades
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pt-3 text-xs text-white/50">
              Mode: {mode.toUpperCase()} • TP: {tradeSettings.tpMultiplier}x range • Lev: {tradeSettings.leverage}x • Margin: ${tradeSettings.marginUsd}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">RECENT CLOSED</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th className="py-2">Side</th>
                    <th className="py-2">Result</th>
                    <th className="py-2">PnL</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.length ? (
                    closedTrades.slice(0, 15).map((t) => (
                      <tr key={t.id} className="border-t border-white/10 text-white/80">
                        <td className="py-2 font-semibold">{t.symbol}</td>
                        <td className="py-2">{t.side}</td>
                        <td className="py-2">{t.closeReason === "SL" ? "LOSS" : "WIN"}</td>
                        <td className={`py-2 ${t.pnlPct !== undefined && t.pnlPct >= 0 ? "text-[#00FF88]" : "text-red-300"}`}>
                          {t.pnlPct !== undefined ? fmtPct(t.pnlPct) : "—"}
                        </td>
                        <td className="py-2">{t.closeReason ?? "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-white/50">
                        No closed trades yet
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
