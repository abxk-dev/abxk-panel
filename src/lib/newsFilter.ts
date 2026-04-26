import { addMinutes } from "date-fns"

export type NewsImpact = "High" | "Medium" | "Low" | "Unknown"

export type NewsEvent = {
  id: string
  title: string
  currency: string
  impact: NewsImpact
  time: number
}

export type NewsStatus =
  | { state: "ACTIVE"; event: NewsEvent; endsAt: number }
  | { state: "UPCOMING"; event: NewsEvent; startsAt: number }
  | { state: "CLEAR"; next?: NewsEvent }

type Cache = { fetchedAt: number; data: any }

const g = globalThis as unknown as { __abxkNewsCache?: Cache }

export async function fetchForexFactoryWeek(): Promise<any> {
  const cache = g.__abxkNewsCache
  const now = Date.now()
  if (cache && now - cache.fetchedAt < 24 * 60 * 60 * 1000) return cache.data

  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  g.__abxkNewsCache = { fetchedAt: now, data }
  return data
}

export function computeNewsStatus(opts: {
  eventsRaw: any
  now: number
  blackoutMinutes: number
  currencies: string[]
  impact: NewsImpact
}): NewsStatus {
  const window = Math.max(0, Math.floor(opts.blackoutMinutes))
  const events = normalizeEvents(opts.eventsRaw)
    .filter((e) => opts.currencies.includes(e.currency))
    .filter((e) => impactRank(e.impact) >= impactRank(opts.impact))
    .filter((e) => isWatchedTitle(e.title))
    .sort((a, b) => a.time - b.time)

  const now = opts.now
  const beforeMs = window * 60_000
  const afterMs = window * 60_000

  for (const e of events) {
    const start = addMinutes(new Date(e.time), -window).getTime()
    const end = addMinutes(new Date(e.time), window).getTime()
    if (now >= start && now <= end) return { state: "ACTIVE", event: e, endsAt: end }
    if (now < start) return { state: "UPCOMING", event: e, startsAt: start }
  }

  return { state: "CLEAR", next: events[0] }
}

function isWatchedTitle(title: string): boolean {
  const t = title.toUpperCase()
  return (
    t.includes("CPI") ||
    t.includes("CORE CPI") ||
    t.includes("FOMC") ||
    t.includes("RATE DECISION") ||
    t.includes("FED CHAIR") ||
    t.includes("SPEECH") ||
    t.includes("NON-FARM") ||
    t.includes("NFP") ||
    t.includes("GDP") ||
    t.includes("UNEMPLOYMENT") ||
    t.includes("PPI") ||
    t.includes("RETAIL SALES")
  )
}

function normalizeEvents(raw: any): NewsEvent[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : raw?.data?.data ?? []
  const out: NewsEvent[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const time = parseTimeMs(item)
    if (!time) continue
    const currency = String(item.currency ?? item.ccy ?? "").toUpperCase()
    const title = String(item.title ?? item.event ?? item.name ?? item.detail ?? "Event")
    const impact = normalizeImpact(item.impact ?? item.impactTitle ?? item.importance)
    out.push({ id: String(item.id ?? `${currency}-${time}-${title}`), title, currency, impact, time })
  }
  return out
}

function parseTimeMs(item: any): number | null {
  const ts = item.timestamp ?? item.ts
  const n = typeof ts === "string" ? Number(ts) : typeof ts === "number" ? ts : undefined
  if (n && Number.isFinite(n)) return n < 2_000_000_000 ? n * 1000 : n
  const dateStr = item.date ?? item.datetime ?? item.time
  if (typeof dateStr === "string") {
    const t = new Date(dateStr).getTime()
    if (Number.isFinite(t)) return t
  }
  return null
}

function normalizeImpact(v: any): NewsImpact {
  const s = String(v ?? "").toLowerCase()
  if (s.includes("high") || s === "3") return "High"
  if (s.includes("medium") || s === "2") return "Medium"
  if (s.includes("low") || s === "1") return "Low"
  return "Unknown"
}

function impactRank(i: NewsImpact): number {
  if (i === "High") return 3
  if (i === "Medium") return 2
  if (i === "Low") return 1
  return 0
}
