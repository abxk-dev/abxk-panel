"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { SCALP_COINS } from "@/lib/scalpEngine"
import { DEFAULT_SCALPING3_SETTINGS } from "@/lib/scalping3/settings"
import type { Scalping3Mode, Scalping3Settings, Scalping3Timeframe } from "@/lib/scalping3/types"

type Scalp3Trade = {
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
  tpPrice?: number
  tp1Price?: number
  tp2Price?: number
  tpStage?: 1 | 2
  slPrice?: number
  rr?: number
  openedAt: number
}

type Scalp3StateResponse = {
  ok: boolean
  data: {
    updatedAt?: number
    settings?: Partial<Scalping3Settings>
    mode?: Scalping3Mode
    openTrades: Scalp3Trade[]
    stats?: { trades: number; wins: number; losses: number; winRate: number; totalPnl: number }
    paperAccount?: {
      balance: number
      totalDeposited: number
      totalFeesPaid: number
      totalGrossPnl: number
      totalNetPnl: number
      today?: { trades: number; gross: number; fees: number; net: number }
    }
    lastScan?: { at: number; session: string; scanned: number; smcValid: number; volumeConfirmed: number; reason: string }
    pending?: { createdAt: number; dueAt: number; signal: any }
  }
}

const STORAGE_KEY = "scalping3_settings"

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function clampNum(n: number, min: number, max: number) {
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

function readStoredSettings(): Scalping3Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCALPING3_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Scalping3Settings>
    const tf = String(parsed.timeframe ?? DEFAULT_SCALPING3_SETTINGS.timeframe) as Scalping3Timeframe
    const timeframe: Scalping3Timeframe = (["1m", "3m", "5m", "15m"] as const).includes(tf) ? tf : DEFAULT_SCALPING3_SETTINGS.timeframe
    const modeRaw = String(parsed.mode ?? DEFAULT_SCALPING3_SETTINGS.mode).toLowerCase()
    const mode: Scalping3Mode = modeRaw === "live" ? "live" : modeRaw === "mirror" ? "mirror" : "paper"
    const allowed = new Set<string>(SCALP_COINS as unknown as string[])
    const enabledSymbolsRaw = Array.isArray(parsed.enabledSymbols) ? parsed.enabledSymbols.map(String) : DEFAULT_SCALPING3_SETTINGS.enabledSymbols
    const enabledSymbols = enabledSymbolsRaw.filter((s) => allowed.has(s))
    return {
      enabled: Boolean(parsed.enabled ?? DEFAULT_SCALPING3_SETTINGS.enabled),
      paused: Boolean(parsed.paused ?? DEFAULT_SCALPING3_SETTINGS.paused),
      mode,
      timeframe,
      minSmcScore: clampInt(Number(parsed.minSmcScore ?? DEFAULT_SCALPING3_SETTINGS.minSmcScore), 0, 100),
      minVolumeRatio: clampNum(Number(parsed.minVolumeRatio ?? DEFAULT_SCALPING3_SETTINGS.minVolumeRatio), 0.1, 50),
      marginPerTrade: clampNum(Number(parsed.marginPerTrade ?? DEFAULT_SCALPING3_SETTINGS.marginPerTrade), 0, 10_000),
      leverage: clampInt(Number(parsed.leverage ?? DEFAULT_SCALPING3_SETTINGS.leverage), 1, 50),
      minRR: clampNum(Number(parsed.minRR ?? DEFAULT_SCALPING3_SETTINGS.minRR), 0.1, 50),
      useGlobalTargets: Boolean(parsed.useGlobalTargets ?? DEFAULT_SCALPING3_SETTINGS.useGlobalTargets),
      globalSlPct: clampNum(Number(parsed.globalSlPct ?? DEFAULT_SCALPING3_SETTINGS.globalSlPct), 0, 50),
      globalTp1Pct: clampNum(Number(parsed.globalTp1Pct ?? DEFAULT_SCALPING3_SETTINGS.globalTp1Pct), 0, 50),
      globalTp2Pct: clampNum(Number(parsed.globalTp2Pct ?? DEFAULT_SCALPING3_SETTINGS.globalTp2Pct), 0, 50),
      maxPerDay: clampInt(Number(parsed.maxPerDay ?? DEFAULT_SCALPING3_SETTINGS.maxPerDay), 1, 200),
      enabledSymbols: enabledSymbols.length ? enabledSymbols : DEFAULT_SCALPING3_SETTINGS.enabledSymbols
    }
  } catch {
    return DEFAULT_SCALPING3_SETTINGS
  }
}

export default function Scalping3Page() {
  const [settings, setSettings] = useState<Scalping3Settings>(() => (typeof window === "undefined" ? DEFAULT_SCALPING3_SETTINGS : readStoredSettings()))
  const [state, setState] = useState<Scalp3StateResponse["data"]>({ openTrades: [] })
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingState, setLoadingState] = useState(false)

  const stateUpdatedAtRef = useRef(0)
  const refreshSeqRef = useRef(0)
  const refreshAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    setSettings(readStoredSettings())
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const res = await fetch("/api/scalping3/settings", { cache: "no-store" }).catch(() => null)
      const json = (await res?.json().catch(() => null)) as any
      const data = json?.data ?? null
      if (!mounted) return
      if (data && typeof data === "object") setSettings((prev) => ({ ...prev, ...(data as Partial<Scalping3Settings>) }))
    }
    void load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const tick = async () => {
      refreshSeqRef.current += 1
      const seq = refreshSeqRef.current
      refreshAbortRef.current?.abort()
      const ctrl = new AbortController()
      refreshAbortRef.current = ctrl
      setLoadingState(true)
      try {
        const res = await fetch("/api/scalping3/state", { cache: "no-store", signal: ctrl.signal }).catch(() => null)
        const json = (await res?.json().catch(() => null)) as Scalp3StateResponse | null
        if (!mounted || seq !== refreshSeqRef.current || !json?.data) return

        const rawUpdatedAt = Number((json.data as any).updatedAt ?? 0)
        const nextUpdatedAt = rawUpdatedAt > 0 && rawUpdatedAt < 10_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 && nextUpdatedAt < stateUpdatedAtRef.current) return
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0) stateUpdatedAtRef.current = nextUpdatedAt

        setState(json.data)
      } finally {
        if (mounted && seq === refreshSeqRef.current) setLoadingState(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 2500)
    return () => {
      mounted = false
      refreshAbortRef.current?.abort()
      window.clearInterval(t)
    }
  }, [])

  const enabledSet = useMemo(() => new Set(settings.enabledSymbols), [settings.enabledSymbols])
  const openTrades = state.openTrades ?? []

  const postCommand = async (patch: Record<string, unknown>) => {
    const res = await fetch("/api/scalping3/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).catch(() => null)
    return (await res?.json().catch(() => null)) as any
  }

  const saveSettings = async () => {
    setSaving(true)
    setSavedMsg(null)
    try {
      const res = await fetch("/api/scalping3/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      }).catch(() => null)
      const json = (await res?.json().catch(() => null)) as any
      if (json?.ok) setSavedMsg("Saved.")
      else setSavedMsg("Save failed.")
      setTimeout(() => setSavedMsg(null), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-white">Scalping 3</div>
          <div className="text-xs text-white/60">SMC + Volume scanner with 5-minute delayed entry.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-black/50 disabled:opacity-50"
            disabled={saving}
            onClick={() => void saveSettings()}
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
          <button
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-black/50"
            onClick={() =>
              void postCommand({ restartScalping3: true }).then(() => {
                setActionMsg("Restart requested.")
                setTimeout(() => setActionMsg(null), 2500)
              })
            }
          >
            Restart
          </button>
          <button
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-black/50"
            onClick={() =>
              void postCommand({ skipOnce: true }).then(() => {
                setActionMsg("Skip requested.")
                setTimeout(() => setActionMsg(null), 2500)
              })
            }
          >
            Skip once
          </button>
          <button
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-black/50"
            onClick={() =>
              void postCommand({ resetPaperAccountUsd: 250 }).then(() => {
                setActionMsg("Paper reset requested.")
                setTimeout(() => setActionMsg(null), 2500)
              })
            }
          >
            Reset paper $250
          </button>
        </div>
      </div>

      {savedMsg ? <div className="text-sm text-white/80">{savedMsg}</div> : null}
      {actionMsg ? <div className="text-sm text-white/80">{actionMsg}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">Settings</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={settings.paused}
                onChange={(e) => setSettings((s) => ({ ...s, paused: e.target.checked }))}
              />
              Paused
            </label>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={settings.useGlobalTargets}
                onChange={(e) => setSettings((s) => ({ ...s, useGlobalTargets: e.target.checked }))}
              />
              Global SL/TP
            </label>
            <div />

            <label className="text-sm text-white/80">
              Mode
              <select
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                value={settings.mode}
                onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as Scalping3Mode }))}
              >
                <option value="paper">paper</option>
                <option value="live">live</option>
                <option value="mirror">mirror</option>
              </select>
            </label>

            <label className="text-sm text-white/80">
              Timeframe
              <select
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                value={settings.timeframe}
                onChange={(e) => setSettings((s) => ({ ...s, timeframe: e.target.value as Scalping3Timeframe }))}
              >
                <option value="1m">1m</option>
                <option value="3m">3m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
              </select>
            </label>

            <label className="text-sm text-white/80">
              Min SMC score
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                value={settings.minSmcScore}
                onChange={(e) => setSettings((s) => ({ ...s, minSmcScore: clampInt(Number(e.target.value), 0, 100) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Min volume ratio
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                step="0.1"
                value={settings.minVolumeRatio}
                onChange={(e) => setSettings((s) => ({ ...s, minVolumeRatio: clampNum(Number(e.target.value), 0.1, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Margin / trade ($)
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                value={settings.marginPerTrade}
                onChange={(e) => setSettings((s) => ({ ...s, marginPerTrade: clampNum(Number(e.target.value), 0, 10_000) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Leverage
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                value={settings.leverage}
                onChange={(e) => setSettings((s) => ({ ...s, leverage: clampInt(Number(e.target.value), 1, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Min RR
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                step="0.1"
                value={settings.minRR}
                onChange={(e) => setSettings((s) => ({ ...s, minRR: clampNum(Number(e.target.value), 0.1, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Global SL (%)
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                step="0.01"
                value={settings.globalSlPct}
                onChange={(e) => setSettings((s) => ({ ...s, globalSlPct: clampNum(Number(e.target.value), 0, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Global TP1 (%)
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                step="0.01"
                value={settings.globalTp1Pct}
                onChange={(e) => setSettings((s) => ({ ...s, globalTp1Pct: clampNum(Number(e.target.value), 0, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Global TP2 (%)
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                step="0.01"
                value={settings.globalTp2Pct}
                onChange={(e) => setSettings((s) => ({ ...s, globalTp2Pct: clampNum(Number(e.target.value), 0, 50) }))}
              />
            </label>

            <label className="text-sm text-white/80">
              Max trades / day
              <input
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-white"
                type="number"
                value={settings.maxPerDay}
                onChange={(e) => setSettings((s) => ({ ...s, maxPerDay: clampInt(Number(e.target.value), 1, 200) }))}
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">Runtime</div>
          <div className="grid gap-2 text-sm text-white/80">
            <div>Updated: {fmtIst(state.updatedAt)}</div>
            <div>Last scan: {state.lastScan ? `${fmtIst(state.lastScan.at)} — ${state.lastScan.reason}` : "—"}</div>
            <div>
              Pending:{" "}
              {state.pending?.dueAt
                ? `${fmtIst(state.pending.dueAt)} — ${String(state.pending?.signal?.symbol ?? "").trim()}`
                : "—"}
            </div>
            <div>
              Stats (today):{" "}
              {state.stats ? `Trades ${state.stats.trades} | W ${state.stats.wins} L ${state.stats.losses} | PnL $${(state.stats.totalPnl ?? 0).toFixed(2)}` : "—"}
            </div>
            <div>
              Paper:{" "}
              {state.paperAccount
                ? `Balance $${state.paperAccount.balance.toFixed(2)} | Fees $${state.paperAccount.totalFeesPaid.toFixed(2)} | Net $${state.paperAccount.totalNetPnl.toFixed(2)}`
                : "—"}
            </div>
            {loadingState ? <div className="text-xs text-white/50">Refreshing...</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Enabled Symbols</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(SCALP_COINS as unknown as string[]).map((sym) => {
            const checked = enabledSet.has(sym)
            return (
              <label key={sym} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setSettings((s) => {
                      const set = new Set(s.enabledSymbols)
                      if (e.target.checked) set.add(sym)
                      else set.delete(sym)
                      return { ...s, enabledSymbols: Array.from(set) }
                    })
                  }}
                />
                {sym}
              </label>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Open Trades</div>
        {!openTrades.length ? (
          <div className="text-sm text-white/60">No open trades.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/60">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Dir</th>
                  <th className="py-2 pr-3">Entry</th>
                  <th className="py-2 pr-3">PnL</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((t) => (
                  <tr key={t.id} className="border-t border-white/10">
                    <td className="py-2 pr-3">{t.symbol}</td>
                    <td className="py-2 pr-3">{t.direction}</td>
                    <td className="py-2 pr-3">${Number(t.entryPrice ?? 0).toFixed(6)}</td>
                    <td className="py-2 pr-3">
                      {Number(t.pnlUsd ?? 0) >= 0 ? "+" : ""}
                      ${Number(t.pnlUsd ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2 pr-3">{t.execMode ?? "—"}</td>
                    <td className="py-2 pr-3">{fmtIst(t.openedAt)}</td>
                    <td className="py-2 pr-3">
                      <button
                        className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white hover:bg-black/50"
                        onClick={() =>
                          void postCommand({ closeTradeId: t.id }).then(() => {
                            setActionMsg(`Close requested for ${t.symbol}.`)
                            setTimeout(() => setActionMsg(null), 2500)
                          })
                        }
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
