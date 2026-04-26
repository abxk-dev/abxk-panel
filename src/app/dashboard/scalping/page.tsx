"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DEFAULT_SCALP_FILTERS, SCALP_FILTER_DEFS, type ScalpFilterCategory, type ScalpFilterId, type ScalpFilterState } from "@/lib/scalpEngine"

type ScalpTimeframe = "1m" | "3m" | "5m" | "15m" | "30m"
type ScalpMode = "paper" | "live" | "mirror"
type ScalpPatternMinStrength = "ANY" | "MODERATE" | "STRONG"
type ScalpPatternSettings = { enabled: boolean; minStrength: ScalpPatternMinStrength; blockOpposing: boolean }

type ScalpSettings = {
  enabled: boolean
  paused: boolean
  paperBalanceUsd: number
  maxDailyLossUsd: number
  tp1Amount: number
  tp2Amount: number
  slAmount: number
  filters: ScalpFilterState
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
}

type ScalpTrade = {
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

type ScalpLeaderboardRow = {
  symbol: string
  score: number
  direction: "LONG" | "SHORT"
  vwapOk: boolean
  rsiOk: boolean
  volRatio: number
  pattern?: { name: string; strength: "STRONG" | "MODERATE" | "WEAK" | "NONE"; reliability?: number; allowed: boolean }
}

type ScalpStateResponse = {
  ok: boolean
  data: {
    updatedAt?: number
    settings?: Partial<ScalpSettings>
    mode?: ScalpMode
    openTrades: ScalpTrade[]
    paperAccount?: {
      balance: number
      totalDeposited: number
      totalFeesPaid: number
      totalGrossPnl: number
      totalNetPnl: number
      today: { trades: number; gross: number; fees: number; net: number }
      openPositions: Array<{
        id: string
        symbol: string
        direction: "LONG" | "SHORT"
        entryPrice: number
        grossPnlUsd: number
        netPnlUsd: number
        fees?: { openFee: number; closeFee: number; fundingFee: number; totalFee: number }
        openedAt: number
      }>
      history: Array<{
        id: string
        symbol: string
        direction: "LONG" | "SHORT"
        entryPrice: number
        exitPrice: number
        grossPnlUsd: number
        fees?: { openFee: number; closeFee: number; fundingFee: number; totalFee: number }
        netPnlUsd: number
        reason: string
        openedAt: number
        closedAt: number
      }>
    }
    stats: {
      trades: number
      wins: number
      losses: number
      winRate: number
      totalPnl: number
      best?: { symbol: string; pnlUsd: number; reason?: string }
      worst?: { symbol: string; pnlUsd: number; reason?: string }
      allTime?: { trades: number; wins: number; losses: number; winRate: number; totalPnl: number }
    }
    leaderboard: ScalpLeaderboardRow[]
  }
}

const STORAGE_KEY = "scalping_settings"
const MODE_KEY = "scalping_mode"
const PATTERN_KEY = "scalp_pattern_settings"
const FILTERS_KEY = "scalp_enabled_filters"

const SCALP_COINS = [
  "BTC-USDT",
  "ETH-USDT",
  "BNB-USDT",
  "XRP-USDT",
  "ADA-USDT",
  "DOT-USDT",
  "MATIC-USDT",
  "LTC-USDT",
  "LINK-USDT",
  "XLM-USDT",
  "SOL-USDT",
  "SUI-USDT",
  "UNI-USDT",
  "BCH-USDT",
  "ETHFI-USDT",
  "INJ-USDT",
  "ETC-USDT",
  "COMP-USDT",
  "ONDO-USDT",
  "DYDX-USDT",
  "TAO-USDT"
] as const

const DEFAULT_SCALP_SETTINGS: ScalpSettings = {
  enabled: false,
  paused: false,
  paperBalanceUsd: 250,
  maxDailyLossUsd: 0,
  tp1Amount: 3,
  tp2Amount: 5,
  slAmount: 5,
  filters: DEFAULT_SCALP_FILTERS,
  trailingEnabled: true,
  lockAtTp1: 3,
  trailDistance: 1,
  leverage: 20,
  marginPerTrade: 10,
  maxConcurrent: 3,
  maxPerDay: 10,
  timeframe: "5m",
  minScore: 70,
  enabledCoins: [...SCALP_COINS]
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

function normalizeFilters(v: unknown): ScalpFilterState {
  if (!v || typeof v !== "object") return { ...DEFAULT_SCALP_FILTERS }
  const out: ScalpFilterState = { ...DEFAULT_SCALP_FILTERS }
  const allow = new Set<string>(Object.keys(out))
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!allow.has(k)) continue
    out[k as ScalpFilterId] = Boolean(raw)
  }
  return out
}

function readStoredSettings(): ScalpSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCALP_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ScalpSettings>
    const allowed = new Set<string>(SCALP_COINS as unknown as string[])
    const enabledCoinsRaw = Array.isArray(parsed.enabledCoins) ? parsed.enabledCoins.map(String) : DEFAULT_SCALP_SETTINGS.enabledCoins
    const enabledCoinsFiltered = enabledCoinsRaw.filter((c) => allowed.has(c))
    const filtersLocal = (() => {
      const fromSettings = normalizeFilters((parsed as any).filters)
      if (fromSettings) return fromSettings
      const rawFilters = window.localStorage.getItem(FILTERS_KEY)
      if (!rawFilters) return { ...DEFAULT_SCALP_FILTERS }
      return normalizeFilters(JSON.parse(rawFilters))
    })()
    const tf = String(parsed.timeframe ?? DEFAULT_SCALP_SETTINGS.timeframe) as ScalpTimeframe
    const timeframe: ScalpTimeframe = (["1m", "3m", "5m", "15m", "30m"] as const).includes(tf) ? tf : DEFAULT_SCALP_SETTINGS.timeframe
    return {
      enabled: Boolean(parsed.enabled ?? DEFAULT_SCALP_SETTINGS.enabled),
      paused: Boolean(parsed.paused ?? DEFAULT_SCALP_SETTINGS.paused),
      paperBalanceUsd: Number(parsed.paperBalanceUsd ?? DEFAULT_SCALP_SETTINGS.paperBalanceUsd),
      maxDailyLossUsd: Number(parsed.maxDailyLossUsd ?? DEFAULT_SCALP_SETTINGS.maxDailyLossUsd),
      tp1Amount: Number(parsed.tp1Amount ?? DEFAULT_SCALP_SETTINGS.tp1Amount),
      tp2Amount: Number(parsed.tp2Amount ?? DEFAULT_SCALP_SETTINGS.tp2Amount),
      slAmount: Number(parsed.slAmount ?? DEFAULT_SCALP_SETTINGS.slAmount),
      filters: filtersLocal,
      trailingEnabled: Boolean(parsed.trailingEnabled ?? DEFAULT_SCALP_SETTINGS.trailingEnabled),
      lockAtTp1: Number(parsed.lockAtTp1 ?? DEFAULT_SCALP_SETTINGS.lockAtTp1),
      trailDistance: Number(parsed.trailDistance ?? DEFAULT_SCALP_SETTINGS.trailDistance),
      leverage: Number(parsed.leverage ?? DEFAULT_SCALP_SETTINGS.leverage),
      marginPerTrade: Number(parsed.marginPerTrade ?? DEFAULT_SCALP_SETTINGS.marginPerTrade),
      maxConcurrent: Number(parsed.maxConcurrent ?? DEFAULT_SCALP_SETTINGS.maxConcurrent),
      maxPerDay: Number(parsed.maxPerDay ?? DEFAULT_SCALP_SETTINGS.maxPerDay),
      timeframe,
      minScore: Number(parsed.minScore ?? DEFAULT_SCALP_SETTINGS.minScore),
      enabledCoins: enabledCoinsFiltered.length ? enabledCoinsFiltered : DEFAULT_SCALP_SETTINGS.enabledCoins
    }
  } catch {
    return DEFAULT_SCALP_SETTINGS
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
    if (!raw) return { enabled: true, minStrength: "MODERATE", blockOpposing: true }
    const parsed = JSON.parse(raw) as Partial<ScalpPatternSettings>
    const min = String(parsed.minStrength ?? "MODERATE").toUpperCase()
    const minStrength: ScalpPatternMinStrength = min === "ANY" ? "ANY" : min === "STRONG" ? "STRONG" : "MODERATE"
    return {
      enabled: Boolean(parsed.enabled ?? true),
      minStrength,
      blockOpposing: Boolean(parsed.blockOpposing ?? true)
    }
  } catch {
    return { enabled: true, minStrength: "MODERATE", blockOpposing: true }
  }
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

export default function ScalpingPage() {
  const [settings, setSettings] = useState<ScalpSettings>(() => (typeof window === "undefined" ? DEFAULT_SCALP_SETTINGS : readStoredSettings()))
  const [mode, setMode] = useState<ScalpMode>(() => (typeof window === "undefined" ? "paper" : readStoredMode()))
  const [pattern, setPattern] = useState<ScalpPatternSettings>(() => (typeof window === "undefined" ? { enabled: true, minStrength: "MODERATE", blockOpposing: true } : readStoredPatternSettings()))
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState(false)
  const [actionLoading, setActionLoading] = useState<{ restart: boolean; reset: boolean; closeId: string | null }>({
    restart: false,
    reset: false,
    closeId: null
  })
  const [state, setState] = useState<ScalpStateResponse["data"]>({
    openTrades: [],
    stats: { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 },
    leaderboard: []
  })

  const tfButtons = useMemo(
    () =>
      [
        { label: "1M", value: "1m" as const },
        { label: "3M", value: "3m" as const },
        { label: "5M", value: "5m" as const },
        { label: "15M", value: "15m" as const },
        { label: "30M", value: "30m" as const }
      ] as const,
    []
  )

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
      const res = await fetch("/api/scalping/settings", { cache: "no-store" }).catch(() => null)
      if (!res) return
      const json = (await res.json().catch(() => null)) as any
      const data = json?.data
      if (!data || typeof data !== "object") return

      const restoredSettings: ScalpSettings = {
        enabled: Boolean(data.enabled ?? DEFAULT_SCALP_SETTINGS.enabled),
        paused: Boolean(data.paused ?? DEFAULT_SCALP_SETTINGS.paused),
        paperBalanceUsd: Number((data as any).paperBalanceUsd ?? DEFAULT_SCALP_SETTINGS.paperBalanceUsd),
        maxDailyLossUsd: Number((data as any).maxDailyLossUsd ?? DEFAULT_SCALP_SETTINGS.maxDailyLossUsd),
        tp1Amount: Number(data.tp1Amount ?? DEFAULT_SCALP_SETTINGS.tp1Amount),
        tp2Amount: Number(data.tp2Amount ?? DEFAULT_SCALP_SETTINGS.tp2Amount),
        slAmount: Number(data.slAmount ?? DEFAULT_SCALP_SETTINGS.slAmount),
        filters: normalizeFilters(data.filters),
        trailingEnabled: Boolean(data.trailingEnabled ?? DEFAULT_SCALP_SETTINGS.trailingEnabled),
        lockAtTp1: Number(data.lockAtTp1 ?? DEFAULT_SCALP_SETTINGS.lockAtTp1),
        trailDistance: Number(data.trailDistance ?? DEFAULT_SCALP_SETTINGS.trailDistance),
        leverage: Number(data.leverage ?? DEFAULT_SCALP_SETTINGS.leverage),
        marginPerTrade: Number(data.marginPerTrade ?? DEFAULT_SCALP_SETTINGS.marginPerTrade),
        maxConcurrent: Number(data.maxConcurrent ?? DEFAULT_SCALP_SETTINGS.maxConcurrent),
        maxPerDay: Number(data.maxPerDay ?? DEFAULT_SCALP_SETTINGS.maxPerDay),
        timeframe: (["1m", "3m", "5m", "15m", "30m"] as const).includes(String(data.timeframe ?? "5m") as any)
          ? (String(data.timeframe ?? "5m") as ScalpTimeframe)
          : DEFAULT_SCALP_SETTINGS.timeframe,
        minScore: Number(data.minScore ?? DEFAULT_SCALP_SETTINGS.minScore),
        enabledCoins: Array.isArray(data.enabledCoins) ? data.enabledCoins.map(String) : DEFAULT_SCALP_SETTINGS.enabledCoins
      }

      const restoredMode: ScalpMode = String(data.mode ?? "paper") === "live" ? "live" : String(data.mode ?? "paper") === "mirror" ? "mirror" : "paper"
      const restoredPattern: ScalpPatternSettings = {
        enabled: Boolean(data.patternRequired ?? true),
        minStrength:
          String(data.patternMinStrength ?? "MODERATE").toUpperCase() === "ANY"
            ? "ANY"
            : String(data.patternMinStrength ?? "MODERATE").toUpperCase() === "STRONG"
              ? "STRONG"
              : "MODERATE",
        blockOpposing: Boolean(data.patternBlockOpposing ?? true)
      }

      setSettings(restoredSettings)
      setMode(restoredMode)
      setPattern(restoredPattern)

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(restoredSettings))
      window.localStorage.setItem(MODE_KEY, restoredMode)
      window.localStorage.setItem(PATTERN_KEY, JSON.stringify(restoredPattern))
      window.localStorage.setItem(FILTERS_KEY, JSON.stringify(restoredSettings.filters))
    }

    void restore()
  }, [])

  const refreshState = useCallback(async () => {
    setLoadingState(true)
    try {
      const res = await fetch("/api/scalping/state", { cache: "no-store" })
      const json = (await res.json()) as ScalpStateResponse
      if (json?.ok && json.data) setState(json.data)
    } catch {
      return
    } finally {
      setLoadingState(false)
    }
  }, [])

  useEffect(() => {
    void refreshState()
    const t = window.setInterval(() => void refreshState(), 5000)
    return () => window.clearInterval(t)
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

  const save = async () => {
    const cleaned: ScalpSettings = {
      enabled: Boolean(settings.enabled),
      paused: Boolean(settings.paused),
      paperBalanceUsd: clamp(Number(settings.paperBalanceUsd), 1, 1_000_000),
      maxDailyLossUsd: clamp(Number(settings.maxDailyLossUsd), 0, 1_000_000),
      tp1Amount: clamp(Number(settings.tp1Amount), 0, 9999),
      tp2Amount: clamp(Number(settings.tp2Amount), 0, 9999),
      slAmount: clamp(Number(settings.slAmount), 0, 9999),
      filters: normalizeFilters(settings.filters),
      trailingEnabled: Boolean(settings.trailingEnabled),
      lockAtTp1: clamp(Number(settings.lockAtTp1), 0, 9999),
      trailDistance: clamp(Number(settings.trailDistance), 0, 9999),
      leverage: clamp(Number(settings.leverage), 1, 50),
      marginPerTrade: clamp(Number(settings.marginPerTrade), 1, 9999),
      maxConcurrent: clamp(Number(settings.maxConcurrent), 1, 20),
      maxPerDay: clamp(Number(settings.maxPerDay), 1, 100),
      timeframe: settings.timeframe,
      minScore: clamp(Number(settings.minScore), 0, 100),
      enabledCoins: settings.enabledCoins.length ? settings.enabledCoins : []
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
    window.localStorage.setItem(MODE_KEY, mode)
    window.localStorage.setItem(PATTERN_KEY, JSON.stringify(pattern))
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(cleaned.filters))
    setSettings(cleaned)
    setSavedMsg("Saved to localStorage ✅")

    try {
      const res = await fetch("/api/scalping/settings", {
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
      const res = await fetch("/api/scalping/command", {
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

  const restartScalping = async () => {
    if (actionLoading.restart) return
    setActionLoading((s) => ({ ...s, restart: true }))
    setActionMsg(null)
    try {
      const res = await fetch("/api/scalping/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartScalping: true })
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
      const res = await fetch("/api/scalping/command", {
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
        <div className="mb-1 text-lg font-semibold text-white">⚡ SCALPING MODULE</div>
        <div className="text-sm text-white/60">Fast trades on top 20 coins</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Module ON/OFF</div>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, enabled: !s.enabled }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  settings.enabled ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                }`}
              >
                {settings.enabled ? "ON" : "OFF"}
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Status</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs ${
                    settings.enabled && !settings.paused ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                  }`}
                  onClick={() => setSettings((s) => ({ ...s, paused: false, enabled: true }))}
                >
                  ACTIVE
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs ${
                    settings.enabled && settings.paused ? "bg-orange-500/20 text-orange-300" : "bg-white/5 text-white/60"
                  }`}
                  onClick={() => setSettings((s) => ({ ...s, paused: true, enabled: true }))}
                >
                  PAUSED
                </button>
              </div>
            </div>

            <div className="text-xs text-white/50">
              Engine: {loadingState ? "syncing..." : "ready"} • Open scalps: {state.openTrades.length}
              {actionMsg ? <span className="ml-2 text-white/60">• {actionMsg}</span> : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold ${
                  actionLoading.restart ? "text-white/40" : "text-white/70 hover:text-white"
                }`}
                onClick={() => void restartScalping()}
                disabled={actionLoading.restart}
              >
                {actionLoading.restart ? "RESTARTING..." : "RESTART ENGINE"}
              </button>
              <button
                type="button"
                className={`rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold ${
                  actionLoading.reset ? "text-white/40" : "text-white/70 hover:text-white"
                }`}
                onClick={() => void resetPaperAccount()}
                disabled={actionLoading.reset}
              >
                {actionLoading.reset ? "RESETTING..." : "RESET PAPER"}
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/60">
              <div className="font-semibold text-white/70">Button usage</div>
              <div className="mt-1">
                RESTART ENGINE = reloads scalping settings + restarts the scan/update loops (use after changing settings or if the engine gets stuck).
              </div>
              <div className="mt-1">
                RESET PAPER = resets the PAPER account balance to the configured amount and clears paper-only trade history (does not touch live positions).
              </div>
            </div>
          </div>

          <Section title="EXECUTION MODE">
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
            <div className="text-xs text-white/50">
              PAPER = Simulate only • LIVE = Real BingX trades • MIRROR = Both simultaneously
            </div>
          </Section>

          <Section title="RISK LIMITS">
            <MoneyInput
              label="Paper account balance (USD)"
              value={settings.paperBalanceUsd}
              onChange={(v) => setSettings((s) => ({ ...s, paperBalanceUsd: v }))}
            />
            <MoneyInput
              label="Max daily loss limit (USD)"
              value={settings.maxDailyLossUsd}
              onChange={(v) => setSettings((s) => ({ ...s, maxDailyLossUsd: v }))}
            />
            <div className="text-xs text-white/50">If hit, scalping pauses until the next UTC day.</div>
          </Section>

          <Section title="🕯 CANDLESTICK PATTERN FILTER">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/80">Require pattern to open trade</div>
              <button
                type="button"
                onClick={() => setPattern((p) => ({ ...p, enabled: !p.enabled }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  pattern.enabled ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                }`}
              >
                {pattern.enabled ? "ON ✅" : "OFF"}
              </button>
            </div>

            <div className="text-xs text-white/50">Minimum pattern strength</div>
            <div className="grid gap-2">
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
                <div>Any (Weak/Moderate/Strong)</div>
                <input
                  type="radio"
                  name="pattern_strength"
                  checked={pattern.minStrength === "ANY"}
                  onChange={() => setPattern((p) => ({ ...p, minStrength: "ANY" }))}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
                <div>Moderate or Strong (recommended)</div>
                <input
                  type="radio"
                  name="pattern_strength"
                  checked={pattern.minStrength === "MODERATE"}
                  onChange={() => setPattern((p) => ({ ...p, minStrength: "MODERATE" }))}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
                <div>Strong only (fewer but better)</div>
                <input
                  type="radio"
                  name="pattern_strength"
                  checked={pattern.minStrength === "STRONG"}
                  onChange={() => setPattern((p) => ({ ...p, minStrength: "STRONG" }))}
                />
              </label>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-sm text-white/80">Block opposing patterns</div>
              <button
                type="button"
                onClick={() => setPattern((p) => ({ ...p, blockOpposing: !p.blockOpposing }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  pattern.blockOpposing ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                }`}
              >
                {pattern.blockOpposing ? "ON ✅" : "OFF"}
              </button>
            </div>
          </Section>

          <Section title="🧠 SMART FILTERS">
            <div className="mb-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
              <div className="flex items-center justify-between text-white/70">
                <div>Active</div>
                <div className="font-semibold text-white">
                  {Object.values(settings.filters).filter(Boolean).length}/{SCALP_FILTER_DEFS.length}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-white/70">
                <div>Max score</div>
                <div className="font-semibold text-[#00FF88]">
                  {SCALP_FILTER_DEFS.filter((f) => settings.filters[f.id]).reduce((s, f) => s + f.weight, 0)}/100
                </div>
              </div>
              <div className="mt-1 text-white/50">Min to trade: {settings.minScore}/100</div>
            </div>

            {(
              Array.from(new Set(SCALP_FILTER_DEFS.map((f) => f.category))) as unknown as ScalpFilterCategory[]
            ).map((cat) => (
              <div key={cat} className="mb-4">
                <div className="mb-2 text-[10px] font-semibold tracking-[0.25em] text-white/40">{cat}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCALP_FILTER_DEFS.filter((f) => f.category === cat).map((filter) => {
                    const on = Boolean(settings.filters[filter.id])
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => {
                          setSettings((s) => {
                            const next = { ...s, filters: { ...s.filters, [filter.id]: !Boolean(s.filters[filter.id]) } }
                            window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next.filters))
                            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
                            return next
                          })
                        }}
                        className={`rounded-lg border px-3 py-2 text-left text-xs ${
                          on ? "border-[#00FF88]/30 bg-[#00FF88]/10 text-white" : "border-white/10 bg-black/30 text-white/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">{filter.name}</div>
                          <div className={`rounded px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/40"}`}>
                            {on ? "ON" : "OFF"}
                          </div>
                        </div>
                        {filter.weight > 0 && <div className="mt-1 text-[10px] text-white/40">+{filter.weight} pts</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </Section>

          <Section title="PROFIT & LOSS">
            <MoneyInput label="Take Profit 1" value={settings.tp1Amount} onChange={(v) => setSettings((s) => ({ ...s, tp1Amount: v }))} />
            <MoneyInput label="Take Profit 2" value={settings.tp2Amount} onChange={(v) => setSettings((s) => ({ ...s, tp2Amount: v }))} />
            <MoneyInput label="Stop Loss" value={settings.slAmount} onChange={(v) => setSettings((s) => ({ ...s, slAmount: v }))} />
            <div className="pt-2 text-xs text-white/50">Min score to trade: {settings.minScore}/100</div>
            <input
              type="range"
              min={50}
              max={95}
              value={settings.minScore}
              onChange={(e) => setSettings((s) => ({ ...s, minScore: Number(e.target.value) }))}
              className="w-full"
            />
          </Section>

          <Section title="TRAILING STOP">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/80">Enable trailing</div>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, trailingEnabled: !s.trailingEnabled }))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  settings.trailingEnabled ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                }`}
              >
                {settings.trailingEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <MoneyInput label="Lock profit at TP1" value={settings.lockAtTp1} onChange={(v) => setSettings((s) => ({ ...s, lockAtTp1: v }))} />
            <MoneyInput
              label="Trail distance"
              value={settings.trailDistance}
              onChange={(v) => setSettings((s) => ({ ...s, trailDistance: v }))}
            />
            <div className="text-xs text-white/50">Final target (TP2): ${fmtUsd(settings.tp2Amount)}</div>
          </Section>

          <Section title="POSITION SETTINGS">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/80">Leverage</div>
              <div className="text-sm font-semibold text-white">{Math.round(settings.leverage)}x</div>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={settings.leverage}
              onChange={(e) => setSettings((s) => ({ ...s, leverage: Number(e.target.value) }))}
              className="w-full"
            />
            <MoneyInput
              label="Margin per trade"
              value={settings.marginPerTrade}
              onChange={(v) => setSettings((s) => ({ ...s, marginPerTrade: v }))}
            />
            <NumberInput
              label="Max concurrent trades"
              value={settings.maxConcurrent}
              onChange={(v) => setSettings((s) => ({ ...s, maxConcurrent: v }))}
            />
            <NumberInput label="Max trades per day" value={settings.maxPerDay} onChange={(v) => setSettings((s) => ({ ...s, maxPerDay: v }))} />
          </Section>

          <Section title="TIMEFRAME">
            <div className="flex flex-wrap gap-2">
              {tfButtons.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs ${
                    settings.timeframe === b.value ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
                  }`}
                  onClick={() => setSettings((s) => ({ ...s, timeframe: b.value }))}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="pt-2 text-xs text-white/50">Selected: {settings.timeframe.toUpperCase()}</div>
          </Section>

          <Section title="COINS TO SCALP">
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                onClick={selectAll}
              >
                Select All
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                onClick={deselectAll}
              >
                Deselect All
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {SCALP_COINS.map((sym) => {
                const checked = settings.enabledCoins.includes(sym)
                return (
                  <label key={sym} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-2">
                    <input type="checkbox" checked={checked} onChange={() => toggleCoin(sym)} />
                    <span className="text-sm text-white/80">{sym}</span>
                  </label>
                )
              })}
            </div>
          </Section>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <button type="button" onClick={save} className="w-full rounded-lg bg-[#00FF88] px-4 py-2 text-sm font-semibold text-black">
              Save Settings
            </button>
            {savedMsg ? <div className="mt-2 text-xs text-white/60">{savedMsg}</div> : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">LIVE SCALP TRADES</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-white/70">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">Symbol</th>
                    <th>Dir</th>
                    <th>Entry</th>
                    <th>PnL</th>
                    <th>Phase</th>
                    <th>Mode</th>
                    <th>Opened (IST)</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.openTrades.length ? (
                    state.openTrades.map((t) => (
                      <tr key={t.id} className="border-t border-white/10">
                        <td className="py-2">{t.symbol}</td>
                        <td>{t.direction}</td>
                        <td>${t.entryPrice.toFixed(6)}</td>
                        <td className={t.pnlUsd !== undefined && t.pnlUsd >= 0 ? "text-[#00FF88]" : "text-red-400"}>
                          {t.pnlUsd === undefined ? "—" : `${t.pnlUsd >= 0 ? "+" : ""}$${fmtUsd(t.pnlUsd)}`}
                        </td>
                        <td>{t.phase ?? "—"}</td>
                        <td className="text-xs">{(t.execMode ?? "live").toUpperCase()}</td>
                        <td className="text-xs text-white/50">{fmtIst(t.openedAt)}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => void closeTrade(t.id)}
                            className={`rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs ${
                              actionLoading.closeId === t.id ? "text-white/40" : "text-white/70 hover:bg-white/10 hover:text-white"
                            }`}
                            disabled={Boolean(actionLoading.closeId)}
                          >
                            {actionLoading.closeId === t.id ? "Closing..." : "Close"}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-3 text-xs text-white/40" colSpan={8}>
                        No open scalps
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {state.paperAccount ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-sm font-semibold text-white">📄 PAPER SCALP ACCOUNT</div>
              <div className="grid gap-2 text-sm text-white/70">
                <Line label="Balance" value={`$${fmtUsd(state.paperAccount.balance)}`} />
                <Line label="Gross PnL" value={`${state.paperAccount.totalGrossPnl >= 0 ? "+" : ""}$${fmtUsd(state.paperAccount.totalGrossPnl)}`} />
                <Line label="Total Fees" value={`-$${fmtUsd(state.paperAccount.totalFeesPaid)}`} />
                <Line label="NET PnL" value={`${state.paperAccount.totalNetPnl >= 0 ? "+" : ""}$${fmtUsd(state.paperAccount.totalNetPnl)}`} />
                <Line label="Fee Rate" value="0.1% per trade" />
              </div>

              <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="mb-2 text-xs font-semibold text-white/70">Today</div>
                <div className="grid gap-2 text-sm text-white/70">
                  <Line label="Trades" value={`${state.paperAccount.today.trades}`} />
                  <Line label="Gross" value={`${state.paperAccount.today.gross >= 0 ? "+" : ""}$${fmtUsd(state.paperAccount.today.gross)}`} />
                  <Line label="Fees" value={`-$${fmtUsd(state.paperAccount.today.fees)}`} />
                  <Line label="Net" value={`${state.paperAccount.today.net >= 0 ? "+" : ""}$${fmtUsd(state.paperAccount.today.net)}`} />
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-white/70">OPEN POSITIONS</div>
                {state.paperAccount.openPositions.length ? (
                  <div className="space-y-2">
                    {state.paperAccount.openPositions.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/70">
                        <div className="min-w-0">
                          <div className="font-mono">
                            {p.symbol} {p.direction}
                          </div>
                          <div className="text-[11px] text-white/40">{fmtIst(p.openedAt)} IST</div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className={p.netPnlUsd >= 0 ? "text-[#00FF88]" : "text-red-400"}>
                            {p.netPnlUsd >= 0 ? "+" : ""}$${fmtUsd(p.netPnlUsd)}
                          </div>
                          <div className="text-xs text-white/40">fees: -${fmtUsd(p.fees?.openFee ?? 0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-white/40">No paper positions</div>
                )}
              </div>
            </div>
          ) : null}

          {state.paperAccount ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-sm font-semibold text-white">PAPER TRADE HISTORY</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-white/70">
                  <thead className="text-xs text-white/50">
                    <tr>
                      <th className="py-2">Closed (IST)</th>
                      <th className="py-2">Symbol</th>
                      <th>Dir</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Gross</th>
                      <th>Fees</th>
                      <th>NET</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.paperAccount.history.length ? (
                      state.paperAccount.history.map((h) => (
                        <tr key={h.id} className="border-t border-white/10">
                          <td className="py-2 text-xs text-white/50">{fmtIst(h.closedAt)}</td>
                          <td className="py-2">{h.symbol}</td>
                          <td>{h.direction}</td>
                          <td>${h.entryPrice.toFixed(6)}</td>
                          <td>${h.exitPrice.toFixed(6)}</td>
                          <td className={h.grossPnlUsd >= 0 ? "text-[#00FF88]" : "text-red-400"}>
                            {h.grossPnlUsd >= 0 ? "+" : ""}$${fmtUsd(h.grossPnlUsd)}
                          </td>
                          <td className="text-white/50">-${fmtUsd(h.fees?.totalFee ?? 0)}</td>
                          <td className={h.netPnlUsd >= 0 ? "text-[#00FF88]" : "text-red-400"}>
                            {h.netPnlUsd >= 0 ? "+" : ""}$${fmtUsd(h.netPnlUsd)}
                          </td>
                          <td className="text-xs text-white/50">{h.reason}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-3 text-xs text-white/40" colSpan={9}>
                          No paper trade history yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">TODAY&apos;S SCALP STATS</div>
            <div className="grid gap-2 text-sm text-white/70">
              <Line label="Trades" value={`${state.stats.trades}`} />
              <Line label="Wins" value={`${state.stats.wins}`} />
              <Line label="Losses" value={`${state.stats.losses}`} />
              <Line label="Win Rate (Accuracy)" value={`${fmtUsd(state.stats.winRate)}%`} />
              <Line label="Total PnL" value={`${state.stats.totalPnl >= 0 ? "+" : ""}$${fmtUsd(state.stats.totalPnl)}`} />
              <Line
                label="Best"
                value={state.stats.best ? `${state.stats.best.symbol} ${state.stats.best.pnlUsd >= 0 ? "+" : ""}$${fmtUsd(state.stats.best.pnlUsd)}` : "—"}
              />
              <Line
                label="Worst"
                value={state.stats.worst ? `${state.stats.worst.symbol} ${state.stats.worst.pnlUsd >= 0 ? "+" : ""}$${fmtUsd(state.stats.worst.pnlUsd)}` : "—"}
              />
            </div>
          </div>

          {state.stats.allTime ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-sm font-semibold text-white">ALL-TIME SCALP STATS</div>
              <div className="grid gap-2 text-sm text-white/70">
                <Line label="Trades" value={`${state.stats.allTime.trades}`} />
                <Line label="Wins" value={`${state.stats.allTime.wins}`} />
                <Line label="Losses" value={`${state.stats.allTime.losses}`} />
                <Line label="Win Rate (Accuracy)" value={`${fmtUsd(state.stats.allTime.winRate)}%`} />
                <Line
                  label="Total PnL"
                  value={`${state.stats.allTime.totalPnl >= 0 ? "+" : ""}$${fmtUsd(state.stats.allTime.totalPnl)}`}
                />
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">SCANNER LEADERBOARD</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-white/70">
                <thead className="text-xs text-white/50">
                  <tr>
                    <th className="py-2">#</th>
                    <th>Symbol</th>
                    <th>Score</th>
                    <th>Dir</th>
                    <th>Pattern</th>
                    <th>Strength</th>
                    <th>VWAP</th>
                    <th>RSI</th>
                    <th>Vol</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.leaderboard.length ? (
                    state.leaderboard.slice(0, 10).map((r, idx) => (
                      <tr key={`${r.symbol}-${idx}`} className="border-t border-white/10">
                        <td className="py-2">{idx + 1}</td>
                        <td>{r.symbol}</td>
                        <td>{r.score}</td>
                        <td>{r.direction}</td>
                        <td className="text-xs">{r.pattern?.name ?? "No Pattern"}</td>
                        <td className="text-xs">
                          {r.pattern?.strength === "STRONG"
                            ? "🔥 STRONG"
                            : r.pattern?.strength === "MODERATE"
                              ? "✅ MODERATE"
                              : r.pattern?.strength === "WEAK"
                                ? "⚡ WEAK"
                                : "❌ None"}
                        </td>
                        <td>{r.vwapOk ? "✅" : "—"}</td>
                        <td>{r.rsiOk ? "✅" : "—"}</td>
                        <td>{r.volRatio.toFixed(1)}x</td>
                        <td className="text-xs">
                          {r.score >= settings.minScore && r.pattern?.allowed ? (
                            <span className="text-[#00FF88]">TRADE</span>
                          ) : (
                            <span className="text-white/50">SKIP</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-3 text-xs text-white/40" colSpan={10}>
                        No scans yet
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white/80">── {title} ──</div>
      <div className="grid gap-3">{children}</div>
    </div>
  )
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-white/70">{label}</div>
      <div className="flex items-center gap-1">
        <div className="text-white/40">$</div>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-sm text-white outline-none focus:border-[#00FF88]/50"
        />
      </div>
    </div>
  )
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-white/70">{label}</div>
      <input
        type="number"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-sm text-white outline-none focus:border-[#00FF88]/50"
      />
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-white/60">{label}</div>
      <div className="text-white/90">{value}</div>
    </div>
  )
}
