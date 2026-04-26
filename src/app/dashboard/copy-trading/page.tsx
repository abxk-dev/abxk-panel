"use client"

import { useEffect, useMemo, useState } from "react"
import type { ExecutionMode } from "@/types/bot"
import {
  buildTelegramCopyOpened,
  defaultCopyTradingSettings,
  normalizeCopyTradingSettings,
  parseBingxCopyPositionsJson,
  type CopyTrader,
  type CopyTradingSettings
} from "@/lib/copyTradingEngine"

const STORAGE_KEY = "copy_trading_settings"

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

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

function NumberInput(props: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs text-white/50">
        <span>{props.label}</span>
        {props.suffix ? <span>{props.suffix}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        {props.prefix ? <div className="text-sm text-white/50">{props.prefix}</div> : null}
        <input
          type="number"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
          value={Number.isFinite(props.value) ? String(props.value) : ""}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
      </div>
    </label>
  )
}

function TextInput(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/50">{props.label}</div>
      <input
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  )
}

function readStored(): CopyTradingSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultCopyTradingSettings()
    return normalizeCopyTradingSettings(JSON.parse(raw))
  } catch {
    return defaultCopyTradingSettings()
  }
}

export default function CopyTradingPage() {
  const [settings, setSettings] = useState<CopyTradingSettings>(defaultCopyTradingSettings())
  const [mode, setMode] = useState<ExecutionMode>("paper")
  const [newUid, setNewUid] = useState("")
  const [savedMsg, setSavedMsg] = useState("")
  const [syncStatus, setSyncStatus] = useState<Record<string, { ok: boolean; count: number; error?: string }>>({})

  useEffect(() => {
    const s = readStored()
    setSettings(s)
    setMode(s.mode)
  }, [])

  useEffect(() => {
    setSettings((prev) => ({ ...prev, mode }))
  }, [mode])

  const canAdd = useMemo(() => settings.traders.length < 5 && newUid.trim().length > 0, [settings.traders.length, newUid])

  const addTrader = () => {
    const uid = newUid.trim()
    if (!uid) return
    if (settings.traders.some((t) => t.uid === uid)) return
    if (settings.traders.length >= 5) return
    const next: CopyTrader = {
      uid,
      name: `Trader ${uid}`,
      winRate: 0,
      monthlyReturn: 0,
      copyRatio: 0.5,
      maxPerTrade: 20,
      active: true
    }
    setSettings((s) => ({ ...s, traders: [...s.traders, next] }))
    setNewUid("")
  }

  const save = () => {
    try {
      const normalized = normalizeCopyTradingSettings(settings)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      setSavedMsg("Saved ✅")
      window.setTimeout(() => setSavedMsg(""), 1500)
    } catch {
      setSavedMsg("Save failed")
    }
  }

  const syncNow = async () => {
    const out: Record<string, { ok: boolean; count: number; error?: string }> = {}
    for (const t of settings.traders.filter((x) => x.active)) {
      try {
        const res = await fetch(`https://open-api.bingx.com/openApi/copyTrade/v1/trader/positions?traderId=${encodeURIComponent(t.uid)}`, {
          cache: "no-store"
        })
        const json = await res.json().catch(() => null)
        const parsed = parseBingxCopyPositionsJson(t.uid, json)
        if (!parsed.ok) {
          out[t.uid] = { ok: false, count: 0, error: parsed.error ?? "Parse failed" }
          continue
        }
        out[t.uid] = { ok: true, count: parsed.positions.length }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Fetch failed"
        out[t.uid] = { ok: false, count: 0, error: msg }
      }
    }
    setSyncStatus(out)
  }

  const testTelegramTemplate = async () => {
    const t = settings.traders[0]
    if (!t) return
    const msg = buildTelegramCopyOpened({
      trader: t,
      symbol: "ETH-USDT",
      side: "LONG",
      theirNotionalUsd: 500,
      myNotionalUsd: 25,
      entryPrice: 3240
    })
    await fetch("/api/telegram/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg })
    }).catch(() => undefined)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">👥 COPY TRADING</div>
        <div className="text-sm text-white/60">Follow trader positions and mirror entries/exits</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="MODE">
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

          <Section title="ADD TRADER (MAX 5)">
            <TextInput label="Add trader UID" value={newUid} onChange={setNewUid} placeholder="123456" />
            <button
              type="button"
              disabled={!canAdd}
              className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${
                canAdd ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/40"
              }`}
              onClick={addTrader}
            >
              + Add Trader
            </button>
          </Section>

          <Section title="GLOBAL LIMITS">
            <NumberInput
              label="Max copy trades open"
              value={settings.limits.maxOpenCopyTrades}
              min={1}
              max={50}
              onChange={(v) => setSettings((s) => ({ ...s, limits: { ...s.limits, maxOpenCopyTrades: clampInt(v, 1, 50) } }))}
            />
            <NumberInput
              label="Max total exposure"
              value={settings.limits.maxTotalExposureUsd}
              min={1}
              max={1000000}
              prefix="$"
              onChange={(v) => setSettings((s) => ({ ...s, limits: { ...s.limits, maxTotalExposureUsd: clampNumber(v, 1, 1_000_000) } }))}
            />
            <TextInput
              label="Skip coins (comma-separated)"
              value={settings.limits.skipCoins.join(", ")}
              onChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  limits: { ...s.limits, skipCoins: v.split(",").map((x) => x.trim()).filter(Boolean) }
                }))
              }
              placeholder="DOGE, SHIB"
            />
          </Section>

          <Section title="ACTIONS">
            <button
              type="button"
              className="w-full rounded-lg bg-[#00FF88]/20 px-3 py-2 text-xs font-semibold text-[#00FF88]"
              onClick={save}
            >
              Save Settings
            </button>
            {savedMsg ? <div className="text-center text-xs text-white/60">{savedMsg}</div> : null}
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void syncNow()}
            >
              Sync Now (Test)
            </button>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void testTelegramTemplate()}
            >
              Send Telegram Test (Template)
            </button>
          </Section>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">TRADERS</div>
            <div className="space-y-3">
              {settings.traders.length ? (
                settings.traders.map((t) => {
                  const st = syncStatus[t.uid]
                  return (
                    <div key={t.uid} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-white">
                          UID: {t.uid} <span className="text-white/50">•</span> WR: {t.winRate.toFixed(0)}% <span className="text-white/50">•</span>{" "}
                          30d: {t.monthlyReturn >= 0 ? "+" : ""}
                          {t.monthlyReturn.toFixed(0)}%
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1 text-xs ${
                              t.active ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"
                            }`}
                            onClick={() =>
                              setSettings((s) => ({
                                ...s,
                                traders: s.traders.map((x) => (x.uid === t.uid ? { ...x, active: !x.active } : x))
                              }))
                            }
                          >
                            {t.active ? "Active ✅" : "Inactive"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white"
                            onClick={() => setSettings((s) => ({ ...s, traders: s.traders.filter((x) => x.uid !== t.uid) }))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <NumberInput
                          label="Copy ratio"
                          value={t.copyRatio}
                          min={0.01}
                          max={5}
                          step={0.05}
                          suffix="x"
                          onChange={(v) =>
                            setSettings((s) => ({
                              ...s,
                              traders: s.traders.map((x) => (x.uid === t.uid ? { ...x, copyRatio: clampNumber(v, 0.01, 5) } : x))
                            }))
                          }
                        />
                        <NumberInput
                          label="Max per trade"
                          value={t.maxPerTrade}
                          min={1}
                          max={1000000}
                          prefix="$"
                          onChange={(v) =>
                            setSettings((s) => ({
                              ...s,
                              traders: s.traders.map((x) => (x.uid === t.uid ? { ...x, maxPerTrade: clampNumber(v, 1, 1_000_000) } : x))
                            }))
                          }
                        />
                        <NumberInput
                          label="Win rate"
                          value={t.winRate}
                          min={0}
                          max={100}
                          suffix="%"
                          onChange={(v) =>
                            setSettings((s) => ({
                              ...s,
                              traders: s.traders.map((x) => (x.uid === t.uid ? { ...x, winRate: clampNumber(v, 0, 100) } : x))
                            }))
                          }
                        />
                        <NumberInput
                          label="30d return"
                          value={t.monthlyReturn}
                          min={-1000}
                          max={1000}
                          suffix="%"
                          onChange={(v) =>
                            setSettings((s) => ({
                              ...s,
                              traders: s.traders.map((x) => (x.uid === t.uid ? { ...x, monthlyReturn: clampNumber(v, -1000, 1000) } : x))
                            }))
                          }
                        />
                      </div>

                      <div className="mt-3 text-xs text-white/50">
                        Sync status:{" "}
                        {st ? (st.ok ? `OK (${st.count} positions)` : `Error: ${st.error ?? "failed"}`) : "—"}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No traders added yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

