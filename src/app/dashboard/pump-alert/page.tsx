"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_PUMP_SETTINGS, PUMP_THRESHOLDS, type PumpAlertSettings, type PumpLevel } from "@/lib/pumpDetector"

type PumpStateResponse = {
  ok: boolean
  data: {
    updatedAt: number
    settings: PumpAlertSettings | null
    recentPumps: Array<{
      symbol: string
      level: PumpLevel
      priceChange5m: number
      volumeRatio: number
      confidence: number
      action: "ALERT" | "SHORT"
      detectedAt: number
    }>
    openTrades: Array<{
      id: string
      symbol: string
      pumpLevel: PumpLevel
      entryPrice: number
      currentPrice?: number
      pnlPercent?: number
      phase: "OPEN" | "TRAIL"
      tpPrice: number
      slPrice: number
      margin: number
      leverage: number
      positionValue: number
      openedAt: number
      execMode: "paper" | "live"
    }>
    stats: { pumpsDetected: number; traded: number; wins: number; losses: number; winRate: number; todayPnl: number }
  }
}

const STORAGE_KEY = "pump_alert_settings"

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

function pnlClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-white/80"
  return n > 0 ? "text-[#00FF88]" : "text-red-400"
}

export default function PumpAlertPage() {
  const [settings, setSettings] = useState<PumpAlertSettings>(() => (typeof window === "undefined" ? DEFAULT_PUMP_SETTINGS : readStoredSettings()))
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [stateLoading, setStateLoading] = useState(true)
  const [stateRefreshing, setStateRefreshing] = useState(false)
  const [state, setState] = useState<PumpStateResponse["data"]>({
    updatedAt: Date.now(),
    settings: null,
    recentPumps: [],
    openTrades: [],
    stats: { pumpsDetected: 0, traded: 0, wins: 0, losses: 0, winRate: 0, todayPnl: 0 }
  })
  const [expanded, setExpanded] = useState<Record<PumpLevel, boolean>>({ LOW: false, MEDIUM: true, HIGH: true, EXTREME: true })
  const [contractsCount, setContractsCount] = useState<number | null>(null)
  const [contractsLoading, setContractsLoading] = useState(true)
  const [blacklistInput, setBlacklistInput] = useState("")
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const stateUpdatedAtRef = useRef(0)
  const stateSeqRef = useRef(0)
  const stateAbortRef = useRef<AbortController | null>(null)

  const levelList = useMemo(() => ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    setSettings(readStoredSettings())

    const restore = async () => {
      const res = await fetch("/api/pump/settings", { cache: "no-store" }).catch(() => null)
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
      stateSeqRef.current += 1
      const seq = stateSeqRef.current
      stateAbortRef.current?.abort()
      const ctrl = new AbortController()
      stateAbortRef.current = ctrl
      setStateRefreshing(true)
      try {
        const res = await fetch("/api/pump/state", { cache: "no-store", signal: ctrl.signal }).catch(() => null)
        if (!res) return
        const json = (await res.json().catch(() => null)) as PumpStateResponse | null
        if (seq !== stateSeqRef.current || !json?.data) return

        const rawUpdatedAt = Number((json.data as any).updatedAt ?? 0)
        const nextUpdatedAt = rawUpdatedAt > 0 && rawUpdatedAt < 10_000_000_000 ? rawUpdatedAt * 1000 : rawUpdatedAt
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0 && nextUpdatedAt < stateUpdatedAtRef.current) return
        if (Number.isFinite(nextUpdatedAt) && nextUpdatedAt > 0) stateUpdatedAtRef.current = nextUpdatedAt

        setState(json.data)
        setStateLoading(false)
      } finally {
        if (seq === stateSeqRef.current) setStateRefreshing(false)
      }
    }
    void tick()
    const t = window.setInterval(() => void tick(), 3000)
    return () => {
      window.clearInterval(t)
      stateAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const tick = async () => {
      setContractsLoading(true)
      try {
        const res = await fetch("/api/bingx/contracts", { cache: "no-store" }).catch(() => null)
        if (!res) return
        const json = (await res.json().catch(() => null)) as any
        const rows: any[] = Array.isArray(json?.data?.data) ? json.data.data : Array.isArray(json?.data) ? json.data : []
        const active = rows.filter((r) => r?.status === 1).length
        if (Number.isFinite(active)) setContractsCount(active)
      } finally {
        setContractsLoading(false)
      }
    }
    void tick()
  }, [])

  const save = useCallback(async () => {
    setLoading(true)
    setSavedMsg(null)
    setActionMsg(null)
    try {
      const cleaned = normalizeSettings(settings)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
      setSettings(cleaned)
      await fetch("/api/pump/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned)
      })
      await fetch("/api/pump/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartPump: true })
      }).catch(() => undefined)
      setSavedMsg("Saved ✅")
    } catch {
      setSavedMsg("Save failed ❌")
    } finally {
      setLoading(false)
      window.setTimeout(() => setSavedMsg(null), 2500)
    }
  }, [settings])

  const toggleExpanded = useCallback((level: PumpLevel) => {
    setExpanded((p) => ({ ...p, [level]: !p[level] }))
  }, [])

  const updateAllLevels = useCallback((patch: Partial<PumpAlertSettings["levels"][PumpLevel]>) => {
    setSettings((s) => ({
      ...s,
      levels: {
        LOW: { ...s.levels.LOW, ...patch },
        MEDIUM: { ...s.levels.MEDIUM, ...patch },
        HIGH: { ...s.levels.HIGH, ...patch },
        EXTREME: { ...s.levels.EXTREME, ...patch }
      }
    }))
  }, [])

  const closeTrade = useCallback(async (id: string) => {
    setActionMsg(null)
    try {
      await fetch("/api/pump/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closeTradeId: id }) })
      setActionMsg("Close requested ✅")
    } catch {
      setActionMsg("Close request failed ❌")
    } finally {
      window.setTimeout(() => setActionMsg(null), 2500)
    }
  }, [])

  const addBlacklist = useCallback(() => {
    const v = blacklistInput.trim().toUpperCase()
    if (!v) return
    setBlacklistInput("")
    setSettings((s) => {
      const set = new Set<string>(s.blacklistedCoins.map((x) => x.trim().toUpperCase()).filter(Boolean))
      set.add(v)
      return { ...s, blacklistedCoins: Array.from(set) }
    })
  }, [blacklistInput])

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-white">🚀 PUMP ALERT — AUTO SHORT</div>
        <div className="text-sm text-white/60">Detect pumps → Short automatically</div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm font-semibold text-white">MODULE STATUS</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className={`rounded-lg px-3 py-1 text-sm ${settings.enabled ? "bg-emerald-600 text-white" : "bg-white/10 text-white/70"}`}
            onClick={() => setSettings((s) => ({ ...s, enabled: true }))}
          >
            ON
          </button>
          <button
            className={`rounded-lg px-3 py-1 text-sm ${!settings.enabled ? "bg-rose-600 text-white" : "bg-white/10 text-white/70"}`}
            onClick={() => setSettings((s) => ({ ...s, enabled: false }))}
          >
            OFF
          </button>

          <div className="ml-2 text-sm text-white/60">Mode:</div>
          {(["paper", "live", "mirror"] as const).map((m) => (
            <button
              key={m}
              className={`rounded-lg px-3 py-1 text-sm ${
                settings.mode === m ? "bg-white text-black" : "bg-white/10 text-white/70"
              }`}
              onClick={() => setSettings((s) => ({ ...s, mode: m }))}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="mt-3 text-sm text-white/60">
          Scan interval: every 60 seconds · Coins monitored: {contractsLoading ? "Loading..." : contractsCount ?? "—"} (all BingX futures)
        </div>
        <div className="mt-1 text-xs text-white/40">{stateLoading ? "Loading engine state..." : stateRefreshing ? "Refreshing..." : `Updated: ${new Date(state.updatedAt).toLocaleTimeString()}`}</div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold text-white">GLOBAL TRADE CONFIG (APPLIES TO ALL LEVELS)</div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Default Margin ($)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.margin)}
                onChange={(e) => updateAllLevels({ margin: clamp(Number(e.target.value), 0, 1_000_000) })}
              />
            </Field>
            <Field label="Default Leverage (x)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.leverage)}
                onChange={(e) => updateAllLevels({ leverage: clamp(Number(e.target.value), 1, 50) })}
              />
            </Field>
            <Field label="Default Take Profit (%)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.tpPercent)}
                onChange={(e) => updateAllLevels({ tpPercent: clamp(Number(e.target.value), 0, 100) })}
              />
            </Field>
            <Field label="Default Stop Loss (%)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.slPercent)}
                onChange={(e) => updateAllLevels({ slPercent: clamp(Number(e.target.value), 0, 100) })}
              />
            </Field>
            <Field label="Default Trailing">
              <button
                className={`w-full rounded-lg px-3 py-2 text-sm ${settings.levels.LOW.trailingEnabled ? "bg-white text-black" : "bg-white/10 text-white/70"}`}
                onClick={() => updateAllLevels({ trailingEnabled: !settings.levels.LOW.trailingEnabled })}
              >
                {settings.levels.LOW.trailingEnabled ? "ON" : "OFF"}
              </button>
            </Field>
            <Field label="Default Trail activate at (%)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.trailingActivateAt)}
                onChange={(e) => updateAllLevels({ trailingActivateAt: clamp(Number(e.target.value), 0, 100) })}
              />
            </Field>
            <Field label="Default Trail distance (%)">
              <input
                className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={String(settings.levels.LOW.trailingDistance)}
                onChange={(e) => updateAllLevels({ trailingDistance: clamp(Number(e.target.value), 0, 100) })}
              />
            </Field>
          </div>
        </div>

        <div className="text-sm font-semibold text-white">PUMP LEVELS</div>
        {levelList.map((level) => {
          const th = PUMP_THRESHOLDS[level]
          const lv = settings.levels[level]
          const tradeEnabled =
            level === "LOW" ? settings.tradeLow : level === "MEDIUM" ? settings.tradeMedium : level === "HIGH" ? settings.tradeHigh : settings.tradeExtreme

          return (
            <div key={level} className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="text-left" onClick={() => toggleExpanded(level)}>
                  <div className="text-white">
                    {th.color} {level} PUMP (+{th.priceChange5m}% / {th.volumeMultiplier}x volume)
                  </div>
                  <div className="text-xs text-white/60">{expanded[level] ? "Collapse" : "Expand"}</div>
                </button>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-white/60">Trade this level:</div>
                  <button
                    className={`rounded-lg px-3 py-1 text-sm ${tradeEnabled ? "bg-emerald-600 text-white" : "bg-white/10 text-white/70"}`}
                    onClick={() => {
                      if (level === "LOW") setSettings((s) => ({ ...s, tradeLow: !s.tradeLow }))
                      else if (level === "MEDIUM") setSettings((s) => ({ ...s, tradeMedium: !s.tradeMedium }))
                      else if (level === "HIGH") setSettings((s) => ({ ...s, tradeHigh: !s.tradeHigh }))
                      else setSettings((s) => ({ ...s, tradeExtreme: !s.tradeExtreme }))
                    }}
                  >
                    {tradeEnabled ? "ON ✅" : "OFF"}
                  </button>
                </div>
              </div>

              {!expanded[level] ? null : (
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Margin ($)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.margin)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], margin: clamp(Number(e.target.value), 0, 1_000_000) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Leverage (x)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.leverage)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], leverage: clamp(Number(e.target.value), 1, 50) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Take Profit (%)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.tpPercent)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], tpPercent: clamp(Number(e.target.value), 0, 100) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Stop Loss (%)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.slPercent)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], slPercent: clamp(Number(e.target.value), 0, 100) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Trailing">
                    <button
                      className={`w-full rounded-lg px-3 py-2 text-sm ${lv.trailingEnabled ? "bg-white text-black" : "bg-white/10 text-white/70"}`}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], trailingEnabled: !s.levels[level].trailingEnabled } }
                        }))
                      }
                    >
                      {lv.trailingEnabled ? "ON" : "OFF"}
                    </button>
                  </Field>
                  <Field label="Trail activate at (%)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.trailingActivateAt)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], trailingActivateAt: clamp(Number(e.target.value), 0, 100) } }
                        }))
                      }
                    />
                  </Field>
                  <Field label="Trail distance (%)">
                    <input
                      className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                      value={String(lv.trailingDistance)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          levels: { ...s.levels, [level]: { ...s.levels[level], trailingDistance: clamp(Number(e.target.value), 0, 100) } }
                        }))
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm font-semibold text-white">GLOBAL LIMITS</div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Max concurrent trades">
            <input
              className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={String(settings.maxConcurrentPumps)}
              onChange={(e) => setSettings((s) => ({ ...s, maxConcurrentPumps: clamp(Number(e.target.value), 1, 20) }))}
            />
          </Field>
          <Field label="Max trades per hour">
            <input
              className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={String(settings.maxPumpsPerHour)}
              onChange={(e) => setSettings((s) => ({ ...s, maxPumpsPerHour: clamp(Number(e.target.value), 1, 100) }))}
            />
          </Field>
          <Field label="Cooldown per coin (min)">
            <input
              className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={String(settings.cooldownAfterTrade)}
              onChange={(e) => setSettings((s) => ({ ...s, cooldownAfterTrade: clamp(Number(e.target.value), 0, 3600) }))}
            />
          </Field>
          <Field label="Min confidence (%)">
            <input
              className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={String(settings.minConfidence)}
              onChange={(e) => setSettings((s) => ({ ...s, minConfidence: clamp(Number(e.target.value), 0, 100) }))}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm font-semibold text-white">BLACKLIST</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings.blacklistedCoins.map((c) => (
            <button
              key={c}
              className="rounded-lg bg-white/10 px-3 py-1 text-sm text-white/80"
              onClick={() => setSettings((s) => ({ ...s, blacklistedCoins: s.blacklistedCoins.filter((x) => x !== c) }))}
              title="Remove"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded-lg bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
            value={blacklistInput}
            onChange={(e) => setBlacklistInput(e.target.value)}
            placeholder="Add coin (e.g. BTC-USDT)"
          />
          <button className="rounded-lg bg-white px-3 py-2 text-sm text-black" onClick={addBlacklist}>
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black" onClick={save} disabled={loading}>
          {loading ? "Saving..." : "SAVE SETTINGS"}
        </button>
        {savedMsg ? <div className="text-sm text-white/80">{savedMsg}</div> : null}
        {actionMsg ? <div className="text-sm text-white/80">{actionMsg}</div> : null}
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-white">LIVE PUMP FEED {stateLoading ? "(Loading...)" : ""}</div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">RECENT PUMPS (last 1 hour)</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[720px] w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/50">
                <tr>
                  <th className="py-2">Symbol</th>
                  <th>Level</th>
                  <th>5m %</th>
                  <th>Vol</th>
                  <th>Conf</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.recentPumps.length ? (
                  state.recentPumps.map((p) => (
                    <tr key={`${p.symbol}-${p.detectedAt}`} className="border-t border-white/5">
                      <td className="py-2">{p.symbol}</td>
                      <td>
                        {PUMP_THRESHOLDS[p.level].color}
                        {p.level}
                      </td>
                      <td>{Number.isFinite(Number(p.priceChange5m)) ? `+${Number(p.priceChange5m)}%` : "—"}</td>
                      <td>{Number.isFinite(Number(p.volumeRatio)) ? `${Number(p.volumeRatio)}x` : "—"}</td>
                      <td>{Number.isFinite(Number(p.confidence)) ? `${Number(p.confidence)}%` : "—"}</td>
                      <td>{p.action === "SHORT" ? "SHORT ✅" : "ALERT"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-2 text-white/50" colSpan={6}>
                      {stateLoading ? "Loading..." : "No pumps yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">OPEN PUMP TRADES</div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[1120px] w-full text-left text-sm text-white/80">
              <thead className="text-xs text-white/50">
                <tr>
                  <th className="py-2">Symbol</th>
                  <th>Entry</th>
                  <th>Current</th>
                  <th>PnL ($)</th>
                  <th>PnL%</th>
                  <th>TP / SL</th>
                  <th>Lev</th>
                  <th>Margin</th>
                  <th>Position</th>
                  <th>Phase</th>
                  <th>Mode</th>
                  <th>Close</th>
                </tr>
              </thead>
              <tbody>
                {state.openTrades.length ? (
                  state.openTrades.map((t) => {
                    const entry = Number(t.entryPrice)
                    const current = Number(t.currentPrice)
                    const pv = Number(t.positionValue)
                    const pp = Number(t.pnlPercent)
                    const tp = Number(t.tpPrice)
                    const sl = Number(t.slPrice)
                    const pnlUsd = Number.isFinite(pv) && Number.isFinite(pp) ? (pv * pp) / 100 : NaN
                    const lev = Number(t.leverage)
                    const margin = Number(t.margin)
                    return (
                      <tr key={t.id} className="border-t border-white/5">
                        <td className="py-2">
                          {t.symbol} {PUMP_THRESHOLDS[t.pumpLevel].color}
                        </td>
                        <td>{Number.isFinite(entry) ? `$${entry.toFixed(6)}` : "—"}</td>
                        <td>{Number.isFinite(current) ? `$${current.toFixed(6)}` : "—"}</td>
                        <td>
                          {Number.isFinite(pnlUsd) ? (
                            <span className={pnlClass(pnlUsd)}>
                              {pnlUsd >= 0 ? "+" : ""}${fmtUsd(pnlUsd)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {Number.isFinite(pp) ? (
                            <span className={pnlClass(pp)}>
                              {pp >= 0 ? "+" : ""}
                              {pp.toFixed(2)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {Number.isFinite(tp) && Number.isFinite(sl) ? `${`$${tp.toFixed(6)}`} / ${`$${sl.toFixed(6)}`}` : "—"}
                        </td>
                        <td>{Number.isFinite(lev) ? `${lev}x` : "—"}</td>
                        <td>{Number.isFinite(margin) ? `$${fmtUsd(margin)}` : "—"}</td>
                        <td>{Number.isFinite(pv) ? `$${fmtUsd(pv)}` : "—"}</td>
                        <td>{t.phase}</td>
                        <td>{t.execMode.toUpperCase()}</td>
                        <td>
                          <button className="rounded-lg bg-white px-3 py-1 text-sm text-black" onClick={() => closeTrade(t.id)}>
                            Close
                          </button>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td className="py-2 text-white/50" colSpan={12}>
                      {stateLoading ? "Loading..." : "No open pump trades"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/80">TODAY STATS</div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Stat label="Pumps detected" value={stateLoading ? "Loading..." : String(state.stats.pumpsDetected)} />
            <Stat label="Traded" value={stateLoading ? "Loading..." : String(state.stats.traded)} />
            <Stat label="Win rate" value={stateLoading ? "Loading..." : `${state.stats.winRate.toFixed(1)}%`} />
            <Stat label="Today PnL" value={stateLoading ? "Loading..." : `${state.stats.todayPnl >= 0 ? "+" : ""}$${fmtUsd(state.stats.todayPnl)}`} />
          </div>
          <div className="mt-2 text-xs text-white/40">{stateLoading ? "Loading..." : `Updated: ${new Date(state.updatedAt).toLocaleTimeString()}`}</div>
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

function readStoredSettings(): PumpAlertSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PUMP_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PumpAlertSettings>
    return normalizeSettings(parsed)
  } catch {
    return DEFAULT_PUMP_SETTINGS
  }
}

function normalizeSettings(raw: Partial<PumpAlertSettings>): PumpAlertSettings {
  const v = (raw ?? {}) as any
  const base = DEFAULT_PUMP_SETTINGS
  const levelsIn = (v.levels ?? {}) as any
  const fixLevel = (level: PumpLevel) => {
    const fb = base.levels[level]
    const lv = (levelsIn as any)[level] ?? {}
    return {
      margin: clamp(Number(lv.margin ?? fb.margin), 0, 1_000_000),
      leverage: clamp(Number(lv.leverage ?? fb.leverage), 1, 50),
      tpPercent: clamp(Number(lv.tpPercent ?? fb.tpPercent), 0, 100),
      slPercent: clamp(Number(lv.slPercent ?? fb.slPercent), 0, 100),
      trailingEnabled: Boolean(lv.trailingEnabled ?? fb.trailingEnabled),
      trailingActivateAt: clamp(Number(lv.trailingActivateAt ?? fb.trailingActivateAt), 0, 100),
      trailingDistance: clamp(Number(lv.trailingDistance ?? fb.trailingDistance), 0, 100)
    }
  }
  const modeRaw = String(v.mode ?? base.mode).toLowerCase()
  const mode = modeRaw === "live" ? "live" : modeRaw === "mirror" ? "mirror" : "paper"
  const blacklist = Array.isArray(v.blacklistedCoins)
    ? v.blacklistedCoins
        .map(String)
        .map((s: string) => s.trim().toUpperCase())
        .filter(Boolean)
    : base.blacklistedCoins
  return {
    enabled: Boolean(v.enabled ?? base.enabled),
    mode,
    tradeLow: Boolean(v.tradeLow ?? base.tradeLow),
    tradeMedium: Boolean(v.tradeMedium ?? base.tradeMedium),
    tradeHigh: Boolean(v.tradeHigh ?? base.tradeHigh),
    tradeExtreme: Boolean(v.tradeExtreme ?? base.tradeExtreme),
    levels: {
      LOW: fixLevel("LOW"),
      MEDIUM: fixLevel("MEDIUM"),
      HIGH: fixLevel("HIGH"),
      EXTREME: fixLevel("EXTREME")
    },
    maxConcurrentPumps: clamp(Number(v.maxConcurrentPumps ?? base.maxConcurrentPumps), 1, 20),
    maxPumpsPerHour: clamp(Number(v.maxPumpsPerHour ?? base.maxPumpsPerHour), 1, 100),
    cooldownAfterTrade: clamp(Number(v.cooldownAfterTrade ?? base.cooldownAfterTrade), 0, 3600),
    minConfidence: clamp(Number(v.minConfidence ?? base.minConfidence), 0, 100),
    blacklistedCoins: blacklist.length ? blacklist : base.blacklistedCoins
  }
}
