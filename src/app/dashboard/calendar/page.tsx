"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type Impact = "High" | "Medium" | "Low"

type FfEvent = {
  title?: string
  country?: string
  date?: string
  impact?: string
  forecast?: string
  previous?: string
}

type AutoPauseSettings = {
  enabled: boolean
  beforeMin: number
  afterMin: number
  pauseScalping: boolean
  pauseCompounding: boolean
  pauseBreakout: boolean
  pauseGrid: boolean
}

const STORAGE_KEY = "economic_calendar_settings"

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

function impactOf(e: FfEvent): Impact {
  const raw = String(e.impact ?? "").toLowerCase()
  if (raw.includes("high") || raw === "3") return "High"
  if (raw.includes("medium") || raw === "2") return "Medium"
  return "Low"
}

function parseEventTime(e: FfEvent): number | null {
  const s = String(e.date ?? "").trim()
  if (!s) return null
  const t = Date.parse(s)
  if (Number.isFinite(t)) return t
  return null
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function loadSettings(): AutoPauseSettings {
  const base: AutoPauseSettings = {
    enabled: false,
    beforeMin: 15,
    afterMin: 30,
    pauseScalping: true,
    pauseCompounding: true,
    pauseBreakout: true,
    pauseGrid: false
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const x = JSON.parse(raw) as any
    return {
      enabled: Boolean(x?.enabled ?? base.enabled),
      beforeMin: clampInt(Number(x?.beforeMin ?? base.beforeMin), 0, 180),
      afterMin: clampInt(Number(x?.afterMin ?? base.afterMin), 0, 180),
      pauseScalping: Boolean(x?.pauseScalping ?? base.pauseScalping),
      pauseCompounding: Boolean(x?.pauseCompounding ?? base.pauseCompounding),
      pauseBreakout: Boolean(x?.pauseBreakout ?? base.pauseBreakout),
      pauseGrid: Boolean(x?.pauseGrid ?? base.pauseGrid)
    }
  } catch {
    return base
  }
}

async function pauseBot(reason: string, what: { scalping: boolean }) {
  if (what.scalping) {
    await fetch("/api/scalping/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true })
    }).catch(() => undefined)
  }
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `⚠️ <b>ECONOMIC EVENT</b>\n━━━━━━━━━━━━━━\nAuto-pausing bots\nReason: ${reason}`
    })
  }).catch(() => undefined)
}

async function resumeBot(reason: string, what: { scalping: boolean }) {
  if (what.scalping) {
    await fetch("/api/scalping/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: false })
    }).catch(() => undefined)
  }
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `▶ <b>BOTS RESUMED</b>\n━━━━━━━━━━━━━━\nReason: ${reason}`
    })
  }).catch(() => undefined)
}

export default function CalendarPage() {
  const [events, setEvents] = useState<FfEvent[]>([])
  const [impactFilter, setImpactFilter] = useState<Impact>("High")
  const [error, setError] = useState("")
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsRefreshing, setEventsRefreshing] = useState(false)
  const [settings, setSettings] = useState<AutoPauseSettings>(() => ({
    enabled: false,
    beforeMin: 15,
    afterMin: 30,
    pauseScalping: true,
    pauseCompounding: true,
    pauseBreakout: true,
    pauseGrid: false
  }))
  const [pausedByCalendar, setPausedByCalendar] = useState(false)
  const [pauseUntil, setPauseUntil] = useState<number | null>(null)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const refresh = async () => {
    setError("")
    setEventsRefreshing(true)
    try {
      const res = await fetch("/api/news/ff", { cache: "no-store" })
      const json = (await res.json()) as any
      if (!json?.ok) throw new Error(json?.error ?? "Fetch failed")
      const data = Array.isArray(json?.data) ? (json.data as FfEvent[]) : []
      setEvents(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed"
      setError(msg)
    } finally {
      setEventsRefreshing(false)
      setEventsLoading(false)
    }
  }

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    void refreshRef.current()
    const t = window.setInterval(() => void refreshRef.current(), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    const now = Date.now()
    const minImpactRank = impactFilter === "High" ? 3 : impactFilter === "Medium" ? 2 : 1
    return events
      .map((e) => ({ e, t: parseEventTime(e), impact: impactOf(e) }))
      .filter((x) => x.t !== null)
      .map((x) => ({ ...x, t: x.t as number }))
      .filter((x) => (x.impact === "High" ? 3 : x.impact === "Medium" ? 2 : 1) >= minImpactRank)
      .sort((a, b) => a.t - b.t)
      .filter((x) => x.t >= now - 24 * 60 * 60_000)
  }, [events, impactFilter])

  const nextHigh = useMemo(() => {
    const now = Date.now()
    const highs = events
      .map((e) => ({ e, t: parseEventTime(e), impact: impactOf(e) }))
      .filter((x) => x.t !== null && x.impact === "High")
      .map((x) => ({ e: x.e, t: x.t as number }))
      .filter((x) => x.t >= now)
      .sort((a, b) => a.t - b.t)
    return highs[0] ?? null
  }, [events])

  useEffect(() => {
    if (!settings.enabled) return
    if (!nextHigh) return
    const t = nextHigh.t
    const beforeMs = settings.beforeMin * 60_000
    const afterMs = settings.afterMin * 60_000
    const shouldPauseAny = settings.pauseScalping || settings.pauseCompounding || settings.pauseBreakout || settings.pauseGrid
    if (!shouldPauseAny) return

    const tick = async () => {
      const now = Date.now()
      const pauseStart = t - beforeMs
      const pauseEnd = t + afterMs
      if (now >= pauseStart && now <= pauseEnd) {
        if (!pausedByCalendar) {
          setPausedByCalendar(true)
          setPauseUntil(pauseEnd)
          await pauseBot(`${nextHigh.e.title ?? "High impact event"} at ${new Date(t).toUTCString()}`, {
            scalping: settings.pauseScalping
          })
        } else {
          setPauseUntil(pauseEnd)
        }
      } else if (pausedByCalendar && pauseUntil && now > pauseUntil) {
        setPausedByCalendar(false)
        setPauseUntil(null)
        await resumeBot("Economic event window ended", { scalping: settings.pauseScalping })
      }
    }

    void tick()
    const iv = window.setInterval(() => void tick(), 5_000)
    return () => window.clearInterval(iv)
  }, [settings.enabled, settings.beforeMin, settings.afterMin, settings.pauseScalping, settings.pauseCompounding, settings.pauseBreakout, settings.pauseGrid, nextHigh, pausedByCalendar, pauseUntil])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">📅 ECONOMIC CALENDAR</div>
        <div className="text-sm text-white/60">High-impact events + optional auto-pause window</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="NEXT HIGH IMPACT">
            {eventsLoading ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">Loading upcoming events…</div>
            ) : nextHigh ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-sm font-semibold text-white">{nextHigh.e.title ?? "—"}</div>
                <div className="mt-1 text-xs text-white/60">
                  Time: {new Date(nextHigh.t).toUTCString()} • Country: {nextHigh.e.country ?? "—"}
                </div>
                <div className="mt-2 text-xs text-white/70">
                  Countdown: {fmtCountdown(nextHigh.t - Date.now())}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No upcoming high-impact event found.</div>
            )}
          </Section>

          <Section title="AUTO-PAUSE">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-sm text-white/80">Enable auto-pause</div>
              <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs text-white/50">Pause before (min)</div>
                <input
                  type="number"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  value={settings.beforeMin}
                  min={0}
                  max={180}
                  onChange={(e) => setSettings((s) => ({ ...s, beforeMin: clampInt(Number(e.target.value), 0, 180) }))}
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs text-white/50">Resume after (min)</div>
                <input
                  type="number"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                  value={settings.afterMin}
                  min={0}
                  max={180}
                  onChange={(e) => setSettings((s) => ({ ...s, afterMin: clampInt(Number(e.target.value), 0, 180) }))}
                />
              </label>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="mb-2 text-xs font-semibold text-white/70">Auto-pausing</div>
              <div className="space-y-2 text-sm text-white/80">
                <label className="flex items-center justify-between">
                  <span>Scalping</span>
                  <input type="checkbox" checked={settings.pauseScalping} onChange={(e) => setSettings((s) => ({ ...s, pauseScalping: e.target.checked }))} />
                </label>
                <label className="flex items-center justify-between">
                  <span>Compounding</span>
                  <input type="checkbox" checked={settings.pauseCompounding} onChange={(e) => setSettings((s) => ({ ...s, pauseCompounding: e.target.checked }))} />
                </label>
                <label className="flex items-center justify-between">
                  <span>Breakout</span>
                  <input type="checkbox" checked={settings.pauseBreakout} onChange={(e) => setSettings((s) => ({ ...s, pauseBreakout: e.target.checked }))} />
                </label>
                <label className="flex items-center justify-between">
                  <span>Grid</span>
                  <input type="checkbox" checked={settings.pauseGrid} onChange={(e) => setSettings((s) => ({ ...s, pauseGrid: e.target.checked }))} />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/60">
              Status: {pausedByCalendar ? `PAUSED until ${pauseUntil ? new Date(pauseUntil).toUTCString() : "—"}` : "RUNNING"}
            </div>
          </Section>

          <Section title="FILTERS">
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Impact</div>
              <select
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={impactFilter}
                onChange={(e) => setImpactFilter(e.target.value as Impact)}
              >
                <option value="High">High</option>
                <option value="Medium">Medium+</option>
                <option value="Low">All</option>
              </select>
            </label>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              disabled={eventsRefreshing}
              onClick={() => void refresh()}
            >
              {eventsRefreshing ? "Refreshing…" : "Refresh Now"}
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={`EVENTS (${filtered.length})`}>
            {eventsLoading ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">Loading events…</div>
            ) : filtered.length ? (
              <div className="space-y-2">
                {filtered.slice(0, 80).map((x, idx) => {
                  const imp = x.impact
                  const color = imp === "High" ? "text-red-300" : imp === "Medium" ? "text-yellow-300" : "text-white/70"
                  return (
                    <div key={`${x.t}_${idx}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-white">{x.e.title ?? "—"}</div>
                        <div className={`text-xs font-semibold ${color}`}>{imp.toUpperCase()}</div>
                      </div>
                      <div className="mt-1 text-xs text-white/60">
                        {new Date(x.t).toUTCString()} • {x.e.country ?? "—"}
                      </div>
                      <div className="mt-1 text-xs text-white/70">
                        Expected: {x.e.forecast ?? "—"} • Previous: {x.e.previous ?? "—"}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">No events match this filter.</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
