"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PumpLevel } from "@/lib/pumpDetector"

type Pump2LevelConfig = {
  enabled: boolean
  pct: number
  timeframeMin: number
  volX: number
}

type Pump2Settings = {
  enabled: boolean
  minVolumeUsd: number
  debounceMinutes: number
  minPriceChangeAbs: number
  mtcEnabled: boolean
  mtcTimeframes: number[]
  mtcMinConfirmations: number
  levels: Record<PumpLevel, Pump2LevelConfig>
  trade: {
    enabled: boolean
    mode: "paper" | "live" | "mirror"
    leverage: number
    marginUsd: number
    stopLoss: { mode: "PCT" | "USD"; value: number }
    takeProfit: { mode: "PCT" | "USD"; value: number }
    trailingStop: { enabled: boolean; activateAtUsd: number; distanceUsd: number }
  }
}

type Pump2StateResponse = {
  ok: boolean
  data: {
    updatedAt: number
    settings: Pump2Settings | null
    pairsCount: number
    lastCheckAt: number | null
    alerts: Array<{
      id: string
      symbol: string
      confidence: PumpLevel
      price: number
      pctChange: number
      volumeMultiplier: number
      rsi: number | null
      chg5m: number | null
      chg10m: number | null
      chg1h: number | null
      chg4h: number | null
      chg12h: number | null
      mtcScore: number | null
      timestamp: number
    }>
  }
}

const DEFAULT_SETTINGS: Pump2Settings = {
  enabled: false,
  minVolumeUsd: 1_000_000,
  debounceMinutes: 20,
  minPriceChangeAbs: 0.01,
  mtcEnabled: true,
  mtcTimeframes: [5, 10, 15],
  mtcMinConfirmations: 2,
  levels: {
    LOW: { enabled: true, pct: 1.5, timeframeMin: 5, volX: 2.0 },
    MEDIUM: { enabled: true, pct: 3.0, timeframeMin: 5, volX: 3.0 },
    HIGH: { enabled: true, pct: 5.0, timeframeMin: 5, volX: 5.0 },
    EXTREME: { enabled: true, pct: 10.0, timeframeMin: 5, volX: 10.0 }
  },
  trade: {
    enabled: false,
    mode: "paper",
    leverage: 10,
    marginUsd: 10,
    stopLoss: { mode: "PCT", value: 2 },
    takeProfit: { mode: "PCT", value: 1.5 },
    trailingStop: { enabled: true, activateAtUsd: 2, distanceUsd: 1 }
  }
}

const STORAGE_KEY = "pump_alert_2_settings"

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function fmt(n: number, dp = 2) {
  if (!Number.isFinite(n)) return "0"
  return n.toFixed(dp)
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function pnlClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-white/80"
  return n > 0 ? "text-[#00FF88]" : "text-red-400"
}

export default function PumpAlert2Page() {
  const [settings, setSettings] = useState<Pump2Settings>(() => (typeof window === "undefined" ? DEFAULT_SETTINGS : readStoredSettings()))
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pump2StateLoading, setPump2StateLoading] = useState(true)
  const [pump2StateRefreshing, setPump2StateRefreshing] = useState(false)
  const [state, setState] = useState<Pump2StateResponse["data"]>({
    updatedAt: Date.now(),
    settings: null,
    pairsCount: 0,
    lastCheckAt: null,
    alerts: []
  })
  const [pumpLive, setPumpLive] = useState<{
    updatedAt: number
    openTrades: Array<{
      id: string
      source: "PUMP1" | "PUMP2"
      symbol: string
      pumpLevel: PumpLevel
      entryPrice: number
      currentPrice?: number
      pnlPercent?: number
      tpPrice?: number
      slPrice?: number
      leverage?: number
      margin?: number
      positionValue: number
      execMode: "paper" | "live"
      phase?: string
      openedAt: number
    }>
    closedTrades: Array<{
      id: string
      source: "PUMP1" | "PUMP2"
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
  }>({ updatedAt: Date.now(), openTrades: [], closedTrades: [] })
  const [pumpLiveLoading, setPumpLiveLoading] = useState(true)
  const [pumpLiveRefreshing, setPumpLiveRefreshing] = useState(false)

  const pump2UpdatedAtRef = useRef(0)
  const pump2SeqRef = useRef(0)
  const pump2AbortRef = useRef<AbortController | null>(null)

  const pumpLiveUpdatedAtRef = useRef(0)
  const pumpLiveSeqRef = useRef(0)
  const pumpLiveAbortRef = useRef<AbortController | null>(null)

  const levels = useMemo(() => ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const, [])
  const [showHistory, setShowHistory] = useState(true)
  const [historySource, setHistorySource] = useState<"ALL" | "PUMP1" | "PUMP2">("ALL")

  useEffect(() => {
    if (typeof window === "undefined") return
    setSettings(readStoredSettings())

    const restore = async () => {
      const res = await fetch("/api/pump2/settings", { cache: "no-store" }).catch(() => null)
      if (!res) return
      const json = (await res.json().catch(() => null)) as any
      const data = json?.data
      if (!data || typeof data !== "object") return
      const restored = normalizeSettings(data)
      setSettings(restored)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(restored))
    }
    void restore()
  }, [])

  useEffect(() => {
    const tick = async () => {
      pump2SeqRef.current += 1
      const seq = pump2SeqRef.current
      pump2AbortRef.current?.abort()
      const ctrl = new AbortController()
      pump2AbortRef.current = ctrl
      setPump2StateRefreshing(true)
      try {
        const res = await fetch("/api/pump2/state", { cache: "no-store", signal: ctrl.signal }).catch(() => null)
        if (!res) return
        const json = (await res.json().catch(() => null)) as Pump2StateResponse | null
        if (seq !== pump2SeqRef.current || !json?.data) return

        const rawUpdatedAt = Number((json.data as any).updatedAt ?? 0)
        const nextUpdatedAt = rawUpdatedAt > 0 && rawUpdatedAt < 10_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 && nextUpdatedAt < pump2UpdatedAtRef.current) return
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0) pump2UpdatedAtRef.current = nextUpdatedAt

        setState(json.data)
        setPump2StateLoading(false)
      } finally {
        if (seq === pump2SeqRef.current) setPump2StateRefreshing(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 3000)
    return () => {
      window.clearInterval(t)
      pump2AbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const tick = async () => {
      pumpLiveSeqRef.current += 1
      const seq = pumpLiveSeqRef.current
      pumpLiveAbortRef.current?.abort()
      const ctrl = new AbortController()
      pumpLiveAbortRef.current = ctrl
      setPumpLiveRefreshing(true)
      try {
        const res = await fetch("/api/pump/state", { cache: "no-store", signal: ctrl.signal }).catch(() => null)
        if (!res) return
        const json = (await res.json().catch(() => null)) as any
        const data = json?.data
        if (seq !== pumpLiveSeqRef.current || !data) return

        const rawUpdatedAt = Number((data as any).updatedAt ?? 0)
        const nextUpdatedAt = rawUpdatedAt > 0 && rawUpdatedAt < 10_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 && nextUpdatedAt < pumpLiveUpdatedAtRef.current) return
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0) pumpLiveUpdatedAtRef.current = nextUpdatedAt

        const openTrades: any[] = Array.isArray(data?.openTrades) ? data.openTrades : []
        const closedTrades: any[] = Array.isArray(data?.closedTrades) ? data.closedTrades : []
        setPumpLive({
          updatedAt: Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 ? nextUpdatedAt : Date.now(),
          openTrades: openTrades
            .map((t) => ({
              id: String(t.id),
              source: t.source === "PUMP2" ? "PUMP2" : "PUMP1",
              symbol: String(t.symbol),
              pumpLevel: t.pumpLevel as PumpLevel,
              entryPrice: Number(t.entryPrice),
              currentPrice: typeof t.currentPrice === "number" ? t.currentPrice : undefined,
              pnlPercent: typeof t.pnlPercent === "number" ? t.pnlPercent : undefined,
              tpPrice: typeof t.tpPrice === "number" ? t.tpPrice : undefined,
              slPrice: typeof t.slPrice === "number" ? t.slPrice : undefined,
              leverage: typeof t.leverage === "number" ? t.leverage : undefined,
              margin: typeof t.margin === "number" ? t.margin : undefined,
              positionValue: Number(t.positionValue),
              execMode: t.execMode === "live" ? "live" : "paper",
              phase: typeof t.phase === "string" ? t.phase : undefined,
              openedAt: Number(t.openedAt)
            })),
          closedTrades: closedTrades
            .map((t) => ({
              id: String(t.id),
              source: t.source === "PUMP2" ? "PUMP2" : "PUMP1",
              symbol: String(t.symbol),
              pumpLevel: t.pumpLevel as PumpLevel,
              entryPrice: Number(t.entryPrice),
              closePrice: typeof t.closePrice === "number" ? t.closePrice : undefined,
              grossPnlUsd: typeof t.grossPnlUsd === "number" ? t.grossPnlUsd : undefined,
              netPnlUsd: typeof t.netPnlUsd === "number" ? t.netPnlUsd : undefined,
              feesUsd: typeof t.feesUsd === "number" ? t.feesUsd : undefined,
              reason: typeof t.reason === "string" ? t.reason : undefined,
              openedAt: Number(t.openedAt),
              closedAt: typeof t.closedAt === "number" ? t.closedAt : undefined,
              execMode: t.execMode === "live" ? "live" : "paper"
            }))
        })
        setPumpLiveLoading(false)
      } finally {
        if (seq === pumpLiveSeqRef.current) setPumpLiveRefreshing(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 3000)
    return () => {
      window.clearInterval(t)
      pumpLiveAbortRef.current?.abort()
    }
  }, [])

  const live = useMemo(() => {
    const trades = pumpLive.openTrades.filter((t) => t.source === "PUMP2")
    const pnlUsd = trades.reduce((sum, t) => {
      const pv = Number(t.positionValue)
      const pp = Number(t.pnlPercent)
      if (!Number.isFinite(pv) || !Number.isFinite(pp)) return sum
      return sum + pv * (pp / 100)
    }, 0)
    return { trades, pnlUsd }
  }, [pumpLive.openTrades])

  const historyClosedTrades = useMemo(() => {
    const list = pumpLive.closedTrades
    if (historySource === "ALL") return list
    return list.filter((t) => t.source === historySource)
  }, [historySource, pumpLive.closedTrades])

  const save = useCallback(async () => {
    setLoading(true)
    setSavedMsg(null)
    try {
      const cleaned = normalizeSettings(settings)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
      setSettings(cleaned)
      await fetch("/api/pump2/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned)
      })
      setSavedMsg("Saved ✅")
    } catch {
      setSavedMsg("Save failed ❌")
    } finally {
      setLoading(false)
      window.setTimeout(() => setSavedMsg(null), 2500)
    }
  }, [settings])

  const updateLevel = useCallback(
    (level: PumpLevel, patch: Partial<Pump2LevelConfig>) => {
      setSettings((s) => ({ ...s, levels: { ...s.levels, [level]: { ...s.levels[level], ...patch } } }))
    },
    [setSettings]
  )

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-white">🚨 PUMP ALERT 2</div>
        <div className="text-sm text-white/60">Crypto_abxk-style realtime pump detection (levels + MTC)</div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm font-semibold text-white">MODULE STATUS</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <Stat label="Enabled" value={settings.enabled ? "ON" : "OFF"} />
          <Stat label="Pairs watched" value={String(state.pairsCount)} />
          <Stat label="Last tick" value={state.lastCheckAt ? new Date(state.lastCheckAt).toLocaleTimeString() : "—"} />
          <Stat label="Min vol (USDT)" value={fmtUsd(settings.minVolumeUsd)} />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <Stat label="Auto-trade" value={settings.trade.enabled ? "ON" : "OFF"} />
          <Stat label="Trade mode" value={settings.trade.mode.toUpperCase()} />
          <Stat label="Open trades" value={String(live.trades.length)} />
          <Stat label="Live PnL" value={`${live.pnlUsd >= 0 ? "+" : ""}$${fmt(live.pnlUsd, 2)}`} />
        </div>
        <div className="mt-2 text-xs text-white/40">
          {pump2StateLoading ? "Loading..." : pump2StateRefreshing ? "Refreshing..." : `Updated: ${new Date(state.updatedAt).toLocaleTimeString()}`}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">SETTINGS</div>
                <div className="text-xs text-white/50">Saved into .env.local (no restart needed)</div>
              </div>
              <button
                type="button"
                onClick={() => void save()}
                disabled={loading}
                className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-black hover:bg-brand/90 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
            {savedMsg ? <div className="text-xs text-white/70">{savedMsg}</div> : null}

            <Field label="Enabled">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
                />
                Pump Alert 2 enabled
              </label>
            </Field>

            <Field label={`Min 24h quote volume (USDT) (${fmtUsd(settings.minVolumeUsd)})`}>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                type="number"
                value={settings.minVolumeUsd}
                onChange={(e) => setSettings((s) => ({ ...s, minVolumeUsd: clamp(Number(e.target.value), 0, 1_000_000_000) }))}
              />
            </Field>

            <Field label={`Debounce (minutes) (${settings.debounceMinutes})`}>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                type="number"
                value={settings.debounceMinutes}
                onChange={(e) => setSettings((s) => ({ ...s, debounceMinutes: clamp(Number(e.target.value), 0, 3600) }))}
              />
            </Field>

            <Field label={`Min price change abs (%): ${fmt(settings.minPriceChangeAbs, 2)}`}>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                type="number"
                step="0.01"
                value={settings.minPriceChangeAbs}
                onChange={(e) => setSettings((s) => ({ ...s, minPriceChangeAbs: clamp(Number(e.target.value), 0, 100) }))}
              />
            </Field>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="text-xs font-semibold text-white/80">MTC (Multi-timeframe confirmation)</div>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={settings.mtcEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, mtcEnabled: e.target.checked }))}
                />
                Enable MTC
              </label>

              <Field label="MTC timeframes (minutes) e.g. 5,10,15">
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  value={settings.mtcTimeframes.join(",")}
                  onChange={(e) => {
                    const list = e.target.value
                      .split(",")
                      .map((x) => Number(x.trim()))
                      .filter((n) => Number.isFinite(n) && n > 0)
                    setSettings((s) => ({ ...s, mtcTimeframes: list.length ? list : s.mtcTimeframes }))
                  }}
                />
              </Field>

              <Field label={`MTC min confirmations (${settings.mtcMinConfirmations})`}>
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  type="number"
                  value={settings.mtcMinConfirmations}
                  onChange={(e) => setSettings((s) => ({ ...s, mtcMinConfirmations: clamp(Number(e.target.value), 0, 20) }))}
                />
              </Field>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="text-xs font-semibold text-white/80">AUTO TRADE (SHORT)</div>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={settings.trade.enabled}
                  onChange={(e) => setSettings((s) => ({ ...s, trade: { ...s.trade, enabled: e.target.checked } }))}
                />
                Enable auto-trade on alert
              </label>

              <Field label="Mode">
                <div className="flex flex-wrap gap-2">
                  {(["paper", "live", "mirror"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${settings.trade.mode === m ? "bg-white text-black" : "bg-white/10 text-white/80"}`}
                      onClick={() => setSettings((s) => ({ ...s, trade: { ...s.trade, mode: m } }))}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Leverage (x)">
                  <input
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    type="number"
                    value={settings.trade.leverage}
                    onChange={(e) => setSettings((s) => ({ ...s, trade: { ...s.trade, leverage: clamp(Number(e.target.value), 1, 50) } }))}
                  />
                </Field>
                <Field label="Margin (USDT)">
                  <input
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    type="number"
                    value={settings.trade.marginUsd}
                    onChange={(e) => setSettings((s) => ({ ...s, trade: { ...s.trade, marginUsd: clamp(Number(e.target.value), 0, 1_000_000_000) } }))}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Stop Loss mode">
                  <select
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    value={settings.trade.stopLoss.mode}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        trade: { ...s.trade, stopLoss: { ...s.trade.stopLoss, mode: e.target.value === "USD" ? "USD" : "PCT" } }
                      }))
                    }
                  >
                    <option value="PCT">%</option>
                    <option value="USD">$</option>
                  </select>
                </Field>
                <Field label={`Stop Loss value (${settings.trade.stopLoss.mode === "USD" ? "$" : "%"})`}>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    type="number"
                    step="0.01"
                    value={settings.trade.stopLoss.value}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        trade: { ...s.trade, stopLoss: { ...s.trade.stopLoss, value: clamp(Number(e.target.value), 0, 1_000_000_000) } }
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Take Profit mode">
                  <select
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    value={settings.trade.takeProfit.mode}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        trade: { ...s.trade, takeProfit: { ...s.trade.takeProfit, mode: e.target.value === "USD" ? "USD" : "PCT" } }
                      }))
                    }
                  >
                    <option value="PCT">%</option>
                    <option value="USD">$</option>
                  </select>
                </Field>
                <Field label={`Take Profit value (${settings.trade.takeProfit.mode === "USD" ? "$" : "%"})`}>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                    type="number"
                    step="0.01"
                    value={settings.trade.takeProfit.value}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        trade: { ...s.trade, takeProfit: { ...s.trade.takeProfit, value: clamp(Number(e.target.value), 0, 1_000_000_000) } }
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                <div className="text-xs font-semibold text-white/80">Trailing stop (PnL in $)</div>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={settings.trade.trailingStop.enabled}
                    onChange={(e) => setSettings((s) => ({ ...s, trade: { ...s.trade, trailingStop: { ...s.trade.trailingStop, enabled: e.target.checked } } }))}
                  />
                  Enable trailing stop
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Activate at ($)">
                    <input
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                      type="number"
                      step="0.01"
                      value={settings.trade.trailingStop.activateAtUsd}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          trade: { ...s.trade, trailingStop: { ...s.trade.trailingStop, activateAtUsd: clamp(Number(e.target.value), 0, 1_000_000_000) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Distance ($)">
                    <input
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                      type="number"
                      step="0.01"
                      value={settings.trade.trailingStop.distanceUsd}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          trade: { ...s.trade, trailingStop: { ...s.trade.trailingStop, distanceUsd: clamp(Number(e.target.value), 0, 1_000_000_000) } }
                        }))
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="text-sm font-semibold text-white">LEVELS</div>
            <div className="space-y-3">
              {levels.map((lvl) => (
                <div key={lvl} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">{lvl}</div>
                    <label className="flex items-center gap-2 text-xs text-white/70">
                      <input type="checkbox" checked={settings.levels[lvl].enabled} onChange={(e) => updateLevel(lvl, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="% change">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                        type="number"
                        step="0.1"
                        value={settings.levels[lvl].pct}
                        onChange={(e) => updateLevel(lvl, { pct: clamp(Number(e.target.value), 0, 100) })}
                      />
                    </Field>
                    <Field label="TF (min)">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                        type="number"
                        value={settings.levels[lvl].timeframeMin}
                        onChange={(e) => updateLevel(lvl, { timeframeMin: clamp(Number(e.target.value), 1, 720) })}
                      />
                    </Field>
                    <Field label="Vol X">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                        type="number"
                        step="0.1"
                        value={settings.levels[lvl].volX}
                        onChange={(e) => updateLevel(lvl, { volX: clamp(Number(e.target.value), 0, 1_000_000) })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/80">OPEN POSITIONS (PUMP ALERT 2)</div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-sm text-white/80">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th>Lev</th>
                    <th>Margin</th>
                    <th>Position</th>
                    <th>Phase</th>
                    <th>Mode</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>PnL ($)</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {live.trades.length ? (
                    live.trades.map((t) => {
                      const pv = Number(t.positionValue)
                      const pp = typeof t.pnlPercent === "number" ? t.pnlPercent : NaN
                      const pnlUsd = Number.isFinite(pv) && Number.isFinite(pp) ? pv * (pp / 100) : NaN
                      return (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="py-2">{t.symbol}</td>
                          <td>{typeof t.leverage === "number" ? `${t.leverage}x` : "—"}</td>
                          <td>{typeof t.margin === "number" ? `$${fmt(t.margin, 2)}` : "—"}</td>
                          <td>${fmt(pv, 2)}</td>
                          <td>{t.phase ?? "—"}</td>
                          <td>{t.execMode.toUpperCase()}</td>
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
                          <td>{Number.isFinite(t.openedAt) ? new Date(t.openedAt).toLocaleTimeString() : "—"}</td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td className="py-2 text-white/50" colSpan={10}>
                        {pumpLiveLoading ? "Loading..." : "No open positions"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-white/40">
              {pumpLiveLoading ? "Loading..." : pumpLiveRefreshing ? "Refreshing..." : `Updated: ${new Date(pumpLive.updatedAt).toLocaleTimeString()}`}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white/80">HISTORY (PUMP ALERT 1 + 2)</div>
              <div className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70"
                  value={historySource}
                  onChange={(e) =>
                    setHistorySource(e.target.value === "PUMP2" ? "PUMP2" : e.target.value === "PUMP1" ? "PUMP1" : "ALL")
                  }
                >
                  <option value="ALL">All</option>
                  <option value="PUMP1">Pump Alert 1</option>
                  <option value="PUMP2">Pump Alert 2</option>
                </select>
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70 hover:text-white"
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? "Hide" : "Show"}
              </button>
              </div>
            </div>
            {showHistory ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[1120px] w-full text-left text-sm text-white/80">
                  <thead className="text-xs text-white/50">
                    <tr>
                      <th className="py-2">Symbol</th>
                      <th>Source</th>
                      <th>Level</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Net</th>
                      <th>Fees</th>
                      <th>Reason</th>
                      <th>Opened</th>
                      <th>Closed</th>
                      <th>Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyClosedTrades.length ? (
                      historyClosedTrades.slice(0, 60).map((t) => (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="py-2">{t.symbol}</td>
                          <td>{t.source}</td>
                          <td>{t.pumpLevel}</td>
                          <td>{Number.isFinite(Number(t.entryPrice)) ? `$${Number(t.entryPrice).toFixed(6)}` : "—"}</td>
                          <td>{typeof t.closePrice === "number" ? `$${t.closePrice.toFixed(6)}` : "—"}</td>
                          <td>
                            {typeof t.netPnlUsd === "number" ? (
                              <span className={pnlClass(t.netPnlUsd)}>
                                {t.netPnlUsd >= 0 ? "+" : ""}${fmt(t.netPnlUsd, 2)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={typeof t.feesUsd === "number" && Math.abs(t.feesUsd) > 0 ? "text-red-400" : "text-white/80"}>
                            {typeof t.feesUsd === "number" ? `-$${fmt(Math.abs(t.feesUsd), 2)}` : "—"}
                          </td>
                          <td>{t.reason ?? "—"}</td>
                          <td>{Number.isFinite(t.openedAt) ? new Date(t.openedAt).toLocaleTimeString() : "—"}</td>
                          <td>{typeof t.closedAt === "number" ? new Date(t.closedAt).toLocaleTimeString() : "—"}</td>
                          <td>{t.execMode.toUpperCase()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-2 text-white/50" colSpan={11}>
                          {pumpLiveLoading ? "Loading..." : "No history yet"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="mt-2 text-xs text-white/40">Showing: {showHistory ? Math.min(60, historyClosedTrades.length) : 0} / {historyClosedTrades.length}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/80">PUMP2 ALERTS</div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm text-white/80">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th>Level</th>
                    <th>Move%</th>
                    <th>VolX</th>
                    <th>RSI</th>
                    <th>MTC</th>
                    <th>5m</th>
                    <th>10m</th>
                    <th>1h</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {state.alerts.length ? (
                    state.alerts.slice(0, 200).map((a) => (
                      <tr key={a.id} className="border-t border-white/5">
                        <td className="py-2">{a.symbol}</td>
                        <td>{a.confidence}</td>
                        <td>+{fmt(a.pctChange, 2)}%</td>
                        <td>{fmt(a.volumeMultiplier, 2)}x</td>
                        <td>{typeof a.rsi === "number" ? fmt(a.rsi, 1) : "—"}</td>
                        <td>{typeof a.mtcScore === "number" ? String(a.mtcScore) : "—"}</td>
                        <td>{typeof a.chg5m === "number" ? `+${fmt(a.chg5m, 2)}%` : "—"}</td>
                        <td>{typeof a.chg10m === "number" ? `+${fmt(a.chg10m, 2)}%` : "—"}</td>
                        <td>{typeof a.chg1h === "number" ? `+${fmt(a.chg1h, 2)}%` : "—"}</td>
                        <td>{new Date(a.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-2 text-white/50" colSpan={10}>
                        No alerts yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-white/40">Alerts shown: {Math.min(200, state.alerts.length)} / {state.alerts.length}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold text-white">BOT SETTINGS (ACTIVE)</div>
            <div className="mt-2 text-xs text-white/50">
              {state.settings ? "Loaded from engine (.env.local)" : "No PUMP2_* found in .env.local yet"}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Stat label="Enabled" value={state.settings?.enabled ? "ON" : "OFF"} />
              <Stat label="Debounce (min)" value={state.settings ? String(state.settings.debounceMinutes) : "—"} />
              <Stat label="MTC" value={state.settings?.mtcEnabled ? "ON" : "OFF"} />
              <Stat label="MTC min conf" value={state.settings ? String(state.settings.mtcMinConfirmations) : "—"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-white/60">{props.label}</div>
      {props.children}
    </div>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="text-xs text-white/50">{props.label}</div>
      <div className="mt-1 text-base font-semibold text-white">{props.value}</div>
    </div>
  )
}

function readStoredSettings(): Pump2Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Pump2Settings>
    return normalizeSettings(parsed)
  } catch {
    return DEFAULT_SETTINGS
  }
}

function normalizeSettings(raw: Partial<Pump2Settings>): Pump2Settings {
  const v = (raw ?? {}) as any
  const base = DEFAULT_SETTINGS
  const levelsIn = (v.levels ?? {}) as any
  const fixLevel = (level: PumpLevel): Pump2LevelConfig => {
    const fb = base.levels[level]
    const lv = (levelsIn as any)[level] ?? {}
    return {
      enabled: Boolean(lv.enabled ?? fb.enabled),
      pct: clamp(Number(lv.pct ?? fb.pct), 0, 100),
      timeframeMin: clamp(Number(lv.timeframeMin ?? fb.timeframeMin), 1, 720),
      volX: clamp(Number(lv.volX ?? fb.volX), 0, 1_000_000)
    }
  }

  const mtcTimeframes =
    Array.isArray(v.mtcTimeframes) ? v.mtcTimeframes.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : base.mtcTimeframes
  const slModeRaw = String(v?.trade?.stopLoss?.mode ?? base.trade.stopLoss.mode).toUpperCase()
  const slMode = slModeRaw === "USD" ? "USD" : "PCT"
  const tpModeRaw = String(v?.trade?.takeProfit?.mode ?? base.trade.takeProfit.mode).toUpperCase()
  const tpMode = tpModeRaw === "USD" ? "USD" : "PCT"
  return {
    enabled: Boolean(v.enabled ?? base.enabled),
    minVolumeUsd: clamp(Number(v.minVolumeUsd ?? base.minVolumeUsd), 0, 1_000_000_000),
    debounceMinutes: clamp(Number(v.debounceMinutes ?? base.debounceMinutes), 0, 3600),
    minPriceChangeAbs: clamp(Number(v.minPriceChangeAbs ?? base.minPriceChangeAbs), 0, 100),
    mtcEnabled: Boolean(v.mtcEnabled ?? base.mtcEnabled),
    mtcTimeframes: mtcTimeframes.length ? mtcTimeframes : base.mtcTimeframes,
    mtcMinConfirmations: clamp(Number(v.mtcMinConfirmations ?? base.mtcMinConfirmations), 0, 20),
    levels: {
      LOW: fixLevel("LOW"),
      MEDIUM: fixLevel("MEDIUM"),
      HIGH: fixLevel("HIGH"),
      EXTREME: fixLevel("EXTREME")
    },
    trade: {
      enabled: Boolean(v?.trade?.enabled ?? base.trade.enabled),
      mode:
        String(v?.trade?.mode ?? base.trade.mode).toLowerCase() === "live"
          ? "live"
          : String(v?.trade?.mode ?? base.trade.mode).toLowerCase() === "mirror"
            ? "mirror"
            : "paper",
      leverage: clamp(Number(v?.trade?.leverage ?? base.trade.leverage), 1, 50),
      marginUsd: clamp(Number(v?.trade?.marginUsd ?? base.trade.marginUsd), 0, 1_000_000_000),
      stopLoss: { mode: slMode, value: clamp(Number(v?.trade?.stopLoss?.value ?? base.trade.stopLoss.value), 0, 1_000_000_000) },
      takeProfit: { mode: tpMode, value: clamp(Number(v?.trade?.takeProfit?.value ?? base.trade.takeProfit.value), 0, 1_000_000_000) },
      trailingStop: {
        enabled: Boolean(v?.trade?.trailingStop?.enabled ?? base.trade.trailingStop.enabled),
        activateAtUsd: clamp(Number(v?.trade?.trailingStop?.activateAtUsd ?? base.trade.trailingStop.activateAtUsd), 0, 1_000_000_000),
        distanceUsd: clamp(Number(v?.trade?.trailingStop?.distanceUsd ?? base.trade.trailingStop.distanceUsd), 0, 1_000_000_000)
      }
    }
  }
}
