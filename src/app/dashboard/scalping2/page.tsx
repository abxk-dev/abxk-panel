"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_SCALP2_FILTERS,
  SCALP2_FILTER_DEFS,
  SCALP_COINS,
  type Scalp2FilterId,
  type Scalp2FilterState,
  type ScalpFilterCategory
} from "@/lib/scalpEngine"

type ScalpTimeframe = "1m" | "3m" | "5m" | "15m" | "30m"
type ScalpMode = "paper" | "live" | "mirror"
type ScalpPatternMinStrength = "ANY" | "MODERATE" | "STRONG"
type ScalpPatternSettings = { enabled: boolean; minStrength: ScalpPatternMinStrength; blockOpposing: boolean }

type Scalp2Settings = {
  enabled: boolean
  paused: boolean
  paperBalanceUsd: number
  maxDailyLossUsd: number
  tp1Amount: number
  tp2Amount: number
  slAmount: number
  trailingEnabled: boolean
  lockAtTp1: number
  trailDistance: number
  leverage: number
  marginPerTrade: number
  maxConcurrent: number
  maxPerDay: number
  timeframe: ScalpTimeframe
  minScore: number
  enabledCoins: string[]
  filters: Scalp2FilterState
}

type Scalp2Trade = {
  id: string
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  quantity: number
  pnlUsd?: number
  execMode?: "paper" | "live"
  grossPnlUsd?: number
  netPnlUsd?: number
  fees?: { openFee: number; closeFee: number; fundingFee: number; totalFee: number }
  phase?: string
  openedAt: number
}

type Scalp2LeaderboardRow = {
  symbol: string
  score: number
  direction: "LONG" | "SHORT"
  vwapOk: boolean
  rsiOk: boolean
  volRatio: number
  pattern?: { name: string; strength: "STRONG" | "MODERATE" | "WEAK" | "NONE"; reliability?: number; allowed: boolean }
}

type Scalp2StateResponse = {
  ok: boolean
  data: {
    updatedAt?: number
    settings?: Partial<Scalp2Settings> & {
      mode?: ScalpMode
      patternRequired?: boolean
      patternMinStrength?: ScalpPatternMinStrength
      patternBlockOpposing?: boolean
    }
    mode?: ScalpMode
    openTrades: Scalp2Trade[]
    paperAccount?: {
      balance: number
      totalDeposited: number
      totalFeesPaid: number
      totalGrossPnl: number
      totalNetPnl: number
      today?: { trades: number; gross: number; fees: number; net: number }
    }
    stats?: {
      trades: number
      wins: number
      losses: number
      winRate: number
      totalPnl: number
      best?: { symbol: string; pnlUsd: number; reason?: string }
      worst?: { symbol: string; pnlUsd: number; reason?: string }
      allTime?: { trades: number; wins: number; losses: number; winRate: number; totalPnl: number }
    }
    leaderboard: Scalp2LeaderboardRow[]
  }
}

const STORAGE_KEY = "scalping2_settings"
const MODE_KEY = "scalping2_mode"
const PATTERN_KEY = "scalp2_pattern_settings"
const FILTERS_KEY = "scalp2_enabled_filters"

const DEFAULT_SETTINGS: Scalp2Settings = {
  enabled: false,
  paused: false,
  paperBalanceUsd: 250,
  maxDailyLossUsd: 0,
  tp1Amount: 3,
  tp2Amount: 5,
  slAmount: 5,
  trailingEnabled: true,
  lockAtTp1: 3,
  trailDistance: 1,
  leverage: 20,
  marginPerTrade: 10,
  maxConcurrent: 3,
  maxPerDay: 10,
  timeframe: "3m",
  minScore: 100,
  enabledCoins: [...SCALP_COINS],
  filters: DEFAULT_SCALP2_FILTERS
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function fmtIst(ts?: number) {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return "—"
  try {
    return new Date(ts).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    })
  } catch {
    return "—"
  }
}

function normalizeFilters(v: unknown): Scalp2FilterState {
  if (!v || typeof v !== "object") return { ...DEFAULT_SCALP2_FILTERS }
  const out: Scalp2FilterState = { ...DEFAULT_SCALP2_FILTERS }
  const allow = new Set<string>(Object.keys(out))
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!allow.has(k)) continue
    out[k as Scalp2FilterId] = Boolean(raw)
  }
  return out
}

function readStoredSettings(): Scalp2Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Scalp2Settings>
    const allowed = new Set<string>(SCALP_COINS as unknown as string[])
    const enabledCoinsRaw = Array.isArray(parsed.enabledCoins) ? parsed.enabledCoins.map(String) : DEFAULT_SETTINGS.enabledCoins
    const enabledCoinsFiltered = enabledCoinsRaw.filter((c) => allowed.has(c))
    const filtersLocal = (() => {
      const fromSettings = normalizeFilters((parsed as any).filters)
      if (fromSettings) return fromSettings
      const rawFilters = window.localStorage.getItem(FILTERS_KEY)
      if (!rawFilters) return { ...DEFAULT_SCALP2_FILTERS }
      return normalizeFilters(JSON.parse(rawFilters))
    })()
    const tf = String(parsed.timeframe ?? DEFAULT_SETTINGS.timeframe) as ScalpTimeframe
    const timeframe: ScalpTimeframe = (["1m", "3m", "5m", "15m", "30m"] as const).includes(tf) ? tf : DEFAULT_SETTINGS.timeframe
    return {
      enabled: Boolean(parsed.enabled ?? DEFAULT_SETTINGS.enabled),
      paused: Boolean(parsed.paused ?? DEFAULT_SETTINGS.paused),
      paperBalanceUsd: Number(parsed.paperBalanceUsd ?? DEFAULT_SETTINGS.paperBalanceUsd),
      maxDailyLossUsd: Number(parsed.maxDailyLossUsd ?? DEFAULT_SETTINGS.maxDailyLossUsd),
      tp1Amount: Number(parsed.tp1Amount ?? DEFAULT_SETTINGS.tp1Amount),
      tp2Amount: Number(parsed.tp2Amount ?? DEFAULT_SETTINGS.tp2Amount),
      slAmount: Number(parsed.slAmount ?? DEFAULT_SETTINGS.slAmount),
      trailingEnabled: Boolean(parsed.trailingEnabled ?? DEFAULT_SETTINGS.trailingEnabled),
      lockAtTp1: Number(parsed.lockAtTp1 ?? DEFAULT_SETTINGS.lockAtTp1),
      trailDistance: Number(parsed.trailDistance ?? DEFAULT_SETTINGS.trailDistance),
      leverage: Number(parsed.leverage ?? DEFAULT_SETTINGS.leverage),
      marginPerTrade: Number(parsed.marginPerTrade ?? DEFAULT_SETTINGS.marginPerTrade),
      maxConcurrent: Number(parsed.maxConcurrent ?? DEFAULT_SETTINGS.maxConcurrent),
      maxPerDay: Number(parsed.maxPerDay ?? DEFAULT_SETTINGS.maxPerDay),
      timeframe,
      minScore: Number(parsed.minScore ?? DEFAULT_SETTINGS.minScore),
      enabledCoins: enabledCoinsFiltered.length ? enabledCoinsFiltered : DEFAULT_SETTINGS.enabledCoins,
      filters: filtersLocal
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function readStoredMode(): ScalpMode {
  try {
    const raw = window.localStorage.getItem(MODE_KEY)
    const v = String(raw ?? "paper").toLowerCase()
    if (v === "live") return "live"
    if (v === "mirror") return "mirror"
    return "paper"
  } catch {
    return "paper"
  }
}

function readStoredPatternSettings(): ScalpPatternSettings {
  try {
    const raw = window.localStorage.getItem(PATTERN_KEY)
    if (!raw) return { enabled: false, minStrength: "MODERATE", blockOpposing: true }
    const parsed = JSON.parse(raw) as Partial<ScalpPatternSettings>
    const min = String(parsed.minStrength ?? "MODERATE").toUpperCase()
    const minStrength: ScalpPatternMinStrength = min === "ANY" ? "ANY" : min === "STRONG" ? "STRONG" : "MODERATE"
    return {
      enabled: Boolean(parsed.enabled ?? false),
      minStrength,
      blockOpposing: Boolean(parsed.blockOpposing ?? true)
    }
  } catch {
    return { enabled: false, minStrength: "MODERATE", blockOpposing: true }
  }
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

export default function Scalping2Page() {
  const [settings, setSettings] = useState<Scalp2Settings>(() => (typeof window === "undefined" ? DEFAULT_SETTINGS : readStoredSettings()))
  const [mode, setMode] = useState<ScalpMode>(() => (typeof window === "undefined" ? "paper" : readStoredMode()))
  const [pattern, setPattern] = useState<ScalpPatternSettings>(() =>
    typeof window === "undefined" ? { enabled: false, minStrength: "MODERATE", blockOpposing: true } : readStoredPatternSettings()
  )
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState(false)
  const [actionLoading, setActionLoading] = useState<{ restart: boolean; reset: boolean; closeId: string | null }>({
    restart: false,
    reset: false,
    closeId: null
  })
  const [state, setState] = useState<Scalp2StateResponse["data"]>({
    openTrades: [],
    leaderboard: []
  })

  const stateUpdatedAtRef = useRef(0)
  const refreshSeqRef = useRef(0)
  const refreshAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    setSettings(readStoredSettings())
    setMode(readStoredMode())
    setPattern(readStoredPatternSettings())
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const hasLocal = Boolean(window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(MODE_KEY) || window.localStorage.getItem(PATTERN_KEY))
    if (hasLocal) return

    const restore = async () => {
      const res = await fetch("/api/scalping2/settings", { cache: "no-store" }).catch(() => null)
      if (!res) return
      const json = (await res.json().catch(() => null)) as any
      const data = json?.data
      if (!data || typeof data !== "object") return

      const restored: Scalp2Settings = {
        enabled: Boolean(data.enabled ?? DEFAULT_SETTINGS.enabled),
        paused: Boolean(data.paused ?? DEFAULT_SETTINGS.paused),
        paperBalanceUsd: Number((data as any).paperBalanceUsd ?? DEFAULT_SETTINGS.paperBalanceUsd),
        maxDailyLossUsd: Number((data as any).maxDailyLossUsd ?? DEFAULT_SETTINGS.maxDailyLossUsd),
        tp1Amount: Number(data.tp1Amount ?? DEFAULT_SETTINGS.tp1Amount),
        tp2Amount: Number(data.tp2Amount ?? DEFAULT_SETTINGS.tp2Amount),
        slAmount: Number(data.slAmount ?? DEFAULT_SETTINGS.slAmount),
        trailingEnabled: Boolean(data.trailingEnabled ?? DEFAULT_SETTINGS.trailingEnabled),
        lockAtTp1: Number(data.lockAtTp1 ?? DEFAULT_SETTINGS.lockAtTp1),
        trailDistance: Number(data.trailDistance ?? DEFAULT_SETTINGS.trailDistance),
        leverage: Number(data.leverage ?? DEFAULT_SETTINGS.leverage),
        marginPerTrade: Number(data.marginPerTrade ?? DEFAULT_SETTINGS.marginPerTrade),
        maxConcurrent: Number(data.maxConcurrent ?? DEFAULT_SETTINGS.maxConcurrent),
        maxPerDay: Number(data.maxPerDay ?? DEFAULT_SETTINGS.maxPerDay),
        timeframe: (["1m", "3m", "5m", "15m", "30m"] as const).includes(String(data.timeframe ?? "3m") as any)
          ? (String(data.timeframe ?? "3m") as ScalpTimeframe)
          : DEFAULT_SETTINGS.timeframe,
        minScore: Number(data.minScore ?? DEFAULT_SETTINGS.minScore),
        enabledCoins: Array.isArray(data.enabledCoins) ? data.enabledCoins.map(String) : DEFAULT_SETTINGS.enabledCoins,
        filters: normalizeFilters(data.filters)
      }

      const restoredMode: ScalpMode = String(data.mode ?? "paper") === "live" ? "live" : String(data.mode ?? "paper") === "mirror" ? "mirror" : "paper"
      const restoredPattern: ScalpPatternSettings = {
        enabled: Boolean(data.patternRequired ?? false),
        minStrength:
          String(data.patternMinStrength ?? "MODERATE").toUpperCase() === "ANY"
            ? "ANY"
            : String(data.patternMinStrength ?? "MODERATE").toUpperCase() === "STRONG"
              ? "STRONG"
              : "MODERATE",
        blockOpposing: Boolean(data.patternBlockOpposing ?? true)
      }

      setSettings(restored)
      setMode(restoredMode)
      setPattern(restoredPattern)

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(restored))
      window.localStorage.setItem(MODE_KEY, restoredMode)
      window.localStorage.setItem(PATTERN_KEY, JSON.stringify(restoredPattern))
      window.localStorage.setItem(FILTERS_KEY, JSON.stringify(restored.filters))
    }

    void restore()
  }, [])

  const refreshState = useCallback(async () => {
    refreshSeqRef.current += 1
    const seq = refreshSeqRef.current
    refreshAbortRef.current?.abort()
    const ctrl = new AbortController()
    refreshAbortRef.current = ctrl
    setLoadingState(true)
    try {
      const res = await fetch("/api/scalping2/state", { cache: "no-store", signal: ctrl.signal })
      const json = (await res.json().catch(() => null)) as Scalp2StateResponse | null
      if (seq !== refreshSeqRef.current) return
      if (!json?.ok || !json.data) return

      const rawUpdatedAt = Number((json.data as any).updatedAt ?? 0)
      const nextUpdatedAt = rawUpdatedAt > 0 && rawUpdatedAt < 10_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt
      if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 && nextUpdatedAt < stateUpdatedAtRef.current) return
      if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0) stateUpdatedAtRef.current = nextUpdatedAt

      setState((prev) => ({ ...prev, ...json.data }))
    } catch {
      return
    } finally {
      if (seq === refreshSeqRef.current) setLoadingState(false)
    }
  }, [])

  useEffect(() => {
    void refreshState()
    const t = window.setInterval(() => void refreshState(), 5000)
    return () => {
      window.clearInterval(t)
      refreshAbortRef.current?.abort()
    }
  }, [refreshState])

  const toggleCoin = (symbol: string) => {
    setSettings((s) => {
      const set = new Set(s.enabledCoins)
      if (set.has(symbol)) set.delete(symbol)
      else set.add(symbol)
      return { ...s, enabledCoins: Array.from(set) }
    })
  }

  const selectAll = () => setSettings((s) => ({ ...s, enabledCoins: [...SCALP_COINS] }))
  const deselectAll = () => setSettings((s) => ({ ...s, enabledCoins: [] }))

  const groupedFilters = useMemo(() => {
    const groups = new Map<ScalpFilterCategory, Array<(typeof SCALP2_FILTER_DEFS)[number]>>()
    for (const def of SCALP2_FILTER_DEFS) {
      const prev = groups.get(def.category) ?? []
      groups.set(def.category, [...prev, def])
    }
    return Array.from(groups.entries())
  }, [])

  const save = async () => {
    const cleaned: Scalp2Settings = {
      enabled: Boolean(settings.enabled),
      paused: Boolean(settings.paused),
      paperBalanceUsd: clamp(Number(settings.paperBalanceUsd), 1, 1_000_000),
      maxDailyLossUsd: clamp(Number(settings.maxDailyLossUsd), 0, 1_000_000),
      tp1Amount: clamp(Number(settings.tp1Amount), 0, 9999),
      tp2Amount: clamp(Number(settings.tp2Amount), 0, 9999),
      slAmount: clamp(Number(settings.slAmount), 0, 9999),
      trailingEnabled: Boolean(settings.trailingEnabled),
      lockAtTp1: clamp(Number(settings.lockAtTp1), 0, 9999),
      trailDistance: clamp(Number(settings.trailDistance), 0, 9999),
      leverage: clamp(Number(settings.leverage), 1, 50),
      marginPerTrade: clamp(Number(settings.marginPerTrade), 1, 9999),
      maxConcurrent: clamp(Number(settings.maxConcurrent), 1, 20),
      maxPerDay: clamp(Number(settings.maxPerDay), 1, 100),
      timeframe: settings.timeframe,
      minScore: clamp(Number(settings.minScore), 0, 100),
      enabledCoins: settings.enabledCoins.length ? settings.enabledCoins : [],
      filters: normalizeFilters(settings.filters)
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
    window.localStorage.setItem(MODE_KEY, mode)
    window.localStorage.setItem(PATTERN_KEY, JSON.stringify(pattern))
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(cleaned.filters))
    setSettings(cleaned)
    setSavedMsg("Saved to localStorage ✅")

    try {
      const res = await fetch("/api/scalping2/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cleaned,
          mode,
          patternRequired: pattern.enabled,
          patternMinStrength: pattern.minStrength,
          patternBlockOpposing: pattern.blockOpposing
        })
      })
      const ok = res.ok
      const text = await res.text()
      if (!ok) {
        setSavedMsg(`Saved locally, env sync failed: ${text}`)
        return
      }
      setSavedMsg("Saved to localStorage + .env ✅")
    } catch {
      setSavedMsg("Saved locally, env sync failed (network)")
    }
  }

  const closeTrade = async (id: string) => {
    if (actionLoading.closeId) return
    setActionLoading((s) => ({ ...s, closeId: id }))
    setActionMsg(null)
    try {
      const res = await fetch("/api/scalping2/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeTradeId: id })
      })
      if (!res.ok) {
        setActionMsg(`Close failed: ${await res.text()}`)
        return
      }
      setActionMsg("Close command sent ✅")
      void refreshState()
    } catch {
      setActionMsg("Close failed (network)")
    } finally {
      setActionLoading((s) => ({ ...s, closeId: null }))
    }
  }

  const restartScalping2 = async () => {
    if (actionLoading.restart) return
    setActionLoading((s) => ({ ...s, restart: true }))
    setActionMsg(null)
    try {
      const res = await fetch("/api/scalping2/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartScalping2: true })
      })
      if (!res.ok) {
        setActionMsg(`Restart failed: ${await res.text()}`)
        return
      }
      setActionMsg("Restart command sent ✅")
      void refreshState()
    } catch {
      setActionMsg("Restart failed (network)")
    } finally {
      setActionLoading((s) => ({ ...s, restart: false }))
    }
  }

  const resetPaperAccount = async () => {
    if (actionLoading.reset) return
    setActionLoading((s) => ({ ...s, reset: true }))
    setActionMsg(null)
    try {
      const res = await fetch("/api/scalping2/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPaperAccountUsd: clamp(Number(settings.paperBalanceUsd), 1, 1_000_000) })
      })
      if (!res.ok) {
        setActionMsg(`Reset failed: ${await res.text()}`)
        return
      }
      setActionMsg("Paper reset command sent ✅")
      void refreshState()
    } catch {
      setActionMsg("Reset failed (network)")
    } finally {
      setActionLoading((s) => ({ ...s, reset: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">⚡ SCALPING 2 MODULE</div>
        <div className="text-sm text-white/60">Checklist-based entries (EMA 9/15 + RSI 15/85 + MACD + BB + VWAP + Volume)</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Module ON/OFF</div>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, enabled: !s.enabled }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${settings.enabled ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"}`}
              >
                {settings.enabled ? "ON" : "OFF"}
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Status</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs ${settings.enabled && !settings.paused ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"}`}
                  onClick={() => setSettings((s) => ({ ...s, paused: false, enabled: true }))}
                >
                  ACTIVE
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs ${settings.paused ? "bg-yellow-400/20 text-yellow-300" : "bg-white/5 text-white/60"}`}
                  onClick={() => setSettings((s) => ({ ...s, paused: true }))}
                >
                  PAUSED
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Mode</div>
              <div className="flex gap-2">
                {(["paper", "live", "mirror"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`rounded-lg px-3 py-1 text-xs ${mode === m ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"}`}
                    onClick={() => setMode(m)}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Trade Config</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Margin / Trade ($)" value={settings.marginPerTrade} onChange={(v) => setSettings((s) => ({ ...s, marginPerTrade: v }))} />
              <Field label="Leverage (x)" value={settings.leverage} onChange={(v) => setSettings((s) => ({ ...s, leverage: v }))} />
              <Field label="Max Concurrent" value={settings.maxConcurrent} onChange={(v) => setSettings((s) => ({ ...s, maxConcurrent: v }))} />
              <Field label="Max / Day" value={settings.maxPerDay} onChange={(v) => setSettings((s) => ({ ...s, maxPerDay: v }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Targets & Trailing</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="TP1 ($)" value={settings.tp1Amount} onChange={(v) => setSettings((s) => ({ ...s, tp1Amount: v }))} />
              <Field label="TP2 ($)" value={settings.tp2Amount} onChange={(v) => setSettings((s) => ({ ...s, tp2Amount: v }))} />
              <Field label="SL ($)" value={settings.slAmount} onChange={(v) => setSettings((s) => ({ ...s, slAmount: v }))} />
              <Field label="Trail Distance ($)" value={settings.trailDistance} onChange={(v) => setSettings((s) => ({ ...s, trailDistance: v }))} />
              <Field label="Lock at TP1 ($)" value={settings.lockAtTp1} onChange={(v) => setSettings((s) => ({ ...s, lockAtTp1: v }))} />
              <Toggle label="Trailing Enabled" on={settings.trailingEnabled} onToggle={() => setSettings((s) => ({ ...s, trailingEnabled: !s.trailingEnabled }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Scanner</div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Timeframe"
                value={settings.timeframe}
                onChange={(v) => setSettings((s) => ({ ...s, timeframe: v as ScalpTimeframe }))}
                options={["1m", "3m", "5m", "15m", "30m"]}
              />
              <Field label="Min Score (0-100)" value={settings.minScore} onChange={(v) => setSettings((s) => ({ ...s, minScore: v }))} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Pattern Filter (Optional)</div>
            <div className="grid grid-cols-2 gap-3">
              <Toggle label="Require Pattern" on={pattern.enabled} onToggle={() => setPattern((p) => ({ ...p, enabled: !p.enabled }))} />
              <Select
                label="Min Strength"
                value={pattern.minStrength}
                onChange={(v) => setPattern((p) => ({ ...p, minStrength: v as ScalpPatternMinStrength }))}
                options={["ANY", "MODERATE", "STRONG"]}
              />
              <Toggle label="Block Opposing" on={pattern.blockOpposing} onToggle={() => setPattern((p) => ({ ...p, blockOpposing: !p.blockOpposing }))} />
              <div />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Filters</div>
              <button type="button" className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70" onClick={() => setSettings((s) => ({ ...s, filters: { ...DEFAULT_SCALP2_FILTERS } }))}>
                Reset
              </button>
            </div>
            <div className="space-y-3">
              {groupedFilters.map(([cat, defs]) => (
                <div key={cat} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-xs font-semibold text-white/70">{cat}</div>
                  <div className="grid grid-cols-1 gap-2">
                    {defs.map((d) => (
                      <label key={d.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                        <span className="text-xs text-white/80">{d.name}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(settings.filters[d.id])}
                          onChange={() => setSettings((s) => ({ ...s, filters: { ...s.filters, [d.id]: !s.filters[d.id] } }))}
                          className="h-4 w-4 accent-[#00FF88]"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Coins</div>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70" onClick={selectAll}>
                  Select all
                </button>
                <button type="button" className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70" onClick={deselectAll}>
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SCALP_COINS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`rounded-lg px-3 py-2 text-xs ${settings.enabledCoins.includes(c) ? "bg-[#00FF88]/15 text-[#00FF88]" : "bg-white/5 text-white/60"}`}
                  onClick={() => toggleCoin(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Paper Account</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starting Balance ($)" value={settings.paperBalanceUsd} onChange={(v) => setSettings((s) => ({ ...s, paperBalanceUsd: v }))} />
              <Field label="Max Daily Loss ($)" value={settings.maxDailyLossUsd} onChange={(v) => setSettings((s) => ({ ...s, maxDailyLossUsd: v }))} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={resetPaperAccount}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${actionLoading.reset ? "bg-white/5 text-white/40" : "bg-white/5 text-white/70"}`}
              >
                {actionLoading.reset ? "Sending..." : "Reset Paper"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} className="rounded-lg bg-[#00FF88]/20 px-4 py-2 text-sm font-semibold text-[#00FF88]">
              Save
            </button>
            <button
              type="button"
              onClick={restartScalping2}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${actionLoading.restart ? "bg-white/5 text-white/40" : "bg-white/5 text-white/70"}`}
            >
              {actionLoading.restart ? "Sending..." : "Restart Engine"}
            </button>
            {savedMsg ? <span className="text-xs text-white/60">{savedMsg}</span> : null}
            {actionMsg ? <span className="text-xs text-white/60">{actionMsg}</span> : null}
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Live State</div>
              <button type="button" onClick={refreshState} className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70">
                {loadingState ? "Loading..." : "Refresh"}
              </button>
            </div>
            <div className="mt-2 text-xs text-white/60">Updated: {state.updatedAt ? fmtIst(state.updatedAt) : "—"}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-2 text-sm font-semibold text-white">Today</div>
              <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
                <Stat label="Trades" value={String(state.stats?.trades ?? 0)} />
                <Stat label="Win Rate" value={`${fmtUsd(state.stats?.winRate ?? 0)}%`} />
                <Stat label="Wins" value={String(state.stats?.wins ?? 0)} />
                <Stat label="Losses" value={String(state.stats?.losses ?? 0)} />
                <Stat label="PnL" value={`${(state.stats?.totalPnl ?? 0) >= 0 ? "+" : ""}$${fmtUsd(state.stats?.totalPnl ?? 0)}`} />
                <Stat label="Best" value={state.stats?.best ? `${state.stats.best.symbol} (${(state.stats.best.pnlUsd ?? 0) >= 0 ? "+" : ""}$${fmtUsd(state.stats.best.pnlUsd ?? 0)})` : "—"} />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-2 text-sm font-semibold text-white">Paper</div>
              <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
                <Stat label="Balance" value={`$${fmtUsd(state.paperAccount?.balance ?? 0)}`} />
                <Stat label="Today Net" value={`$${fmtUsd(state.paperAccount?.today?.net ?? 0)}`} />
                <Stat label="Total Net" value={`$${fmtUsd(state.paperAccount?.totalNetPnl ?? 0)}`} />
                <Stat label="Fees Paid" value={`$${fmtUsd(state.paperAccount?.totalFeesPaid ?? 0)}`} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">OPEN POSITIONS</div>
            {state.openTrades?.length ? (
              <div className="space-y-3">
                {state.openTrades.map((t) => {
                  const pnl = typeof t.pnlUsd === "number" ? t.pnlUsd : typeof t.netPnlUsd === "number" ? t.netPnlUsd : typeof t.grossPnlUsd === "number" ? t.grossPnlUsd : null
                  const fees = typeof t.fees?.totalFee === "number" ? t.fees.totalFee : null
                  const pnlColor = pnl !== null && pnl < 0 ? "text-red-400" : "text-[#00FF88]"
                  return (
                    <div key={t.id} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {t.symbol} <span className="text-white/60">{t.direction}</span>
                          </div>
                          <div className="mt-1 text-xs text-white/50">{fmtIst(t.openedAt)}</div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <div className="text-right">
                            <div className={`text-sm font-semibold ${pnlColor}`}>
                              {pnl !== null ? `${pnl >= 0 ? "+" : ""}$${fmtUsd(pnl)}` : "—"}
                            </div>
                            <div className="mt-1 text-xs text-white/50">{fees !== null ? `fees: -$${fmtUsd(Math.abs(fees))}` : "fees: —"}</div>
                          </div>

                          <div className="text-right text-xs text-white/60 hidden sm:block">
                            <div>{(t.execMode ?? "—").toUpperCase()}</div>
                            <div className="mt-1">{t.phase ?? "—"}</div>
                          </div>

                          <button
                            type="button"
                            onClick={() => closeTrade(t.id)}
                            className={`rounded-lg px-3 py-1 text-xs ${actionLoading.closeId === t.id ? "bg-white/5 text-white/40" : "bg-red-500/20 text-red-200"}`}
                          >
                            {actionLoading.closeId === t.id ? "..." : "Close"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs text-white/60">No open trades</div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Leaderboard</div>
            {state.leaderboard?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-white/60">
                      <th className="py-2">Symbol</th>
                      <th className="py-2">Dir</th>
                      <th className="py-2">Score</th>
                      <th className="py-2">VWAP</th>
                      <th className="py-2">RSI</th>
                      <th className="py-2">Vol</th>
                      <th className="py-2">Pattern</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.leaderboard.slice(0, 20).map((r) => (
                      <tr key={`${r.symbol}-${r.direction}`} className="border-t border-white/5 text-white/80">
                        <td className="py-2">{r.symbol}</td>
                        <td className="py-2">{r.direction}</td>
                        <td className="py-2">{Number(r.score).toFixed(0)}</td>
                        <td className="py-2">{r.vwapOk ? "✅" : "❌"}</td>
                        <td className="py-2">{r.rsiOk ? "✅" : "❌"}</td>
                        <td className="py-2">{Number(r.volRatio).toFixed(2)}x</td>
                        <td className="py-2">
                          {r.pattern ? `${r.pattern.name} (${r.pattern.strength}) ${r.pattern.allowed ? "✅" : "❌"}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-white/60">No data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold text-white/60">{label}</div>
      <input
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        inputMode="decimal"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-[#00FF88]/40"
      />
    </label>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold text-white/60">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-[#00FF88]/40"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-xs ${
        on ? "bg-[#00FF88]/15 text-[#00FF88]" : "bg-black/30 text-white/60"
      }`}
    >
      <span>{label}</span>
      <span className="font-semibold">{on ? "ON" : "OFF"}</span>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="text-[11px] font-semibold text-white/60">{label}</div>
      <div className="mt-1 text-xs font-semibold text-white">{value}</div>
    </div>
  )
}
