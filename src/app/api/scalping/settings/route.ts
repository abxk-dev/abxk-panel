import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { DEFAULT_SCALP_FILTERS, SCALP_COINS, type ScalpFilterId, type ScalpFilterState } from "@/lib/scalpEngine"

export const runtime = "nodejs"

type ScalpSettings = {
  enabled: boolean
  paused: boolean
  mode: "paper" | "live" | "mirror"
  patternRequired: boolean
  patternMinStrength: "ANY" | "MODERATE" | "STRONG"
  patternBlockOpposing: boolean
  filters: ScalpFilterState
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
  timeframe: string
  minScore: number
  enabledCoins: string[]
}

const g = globalThis as unknown as { __abxkScalpingSettings?: ScalpSettings }

export async function GET() {
  const fromMem = g.__abxkScalpingSettings
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const hasAny = Object.keys(env).some((k) => k.startsWith("SCALPING_"))
  if (!hasAny) return NextResponse.json({ ok: true, data: null })

  const restored = normalizeSettings({
    enabled: normalizeBool(env.SCALPING_ENABLED, false),
    paused: normalizeBool(env.SCALPING_PAUSED, false),
    mode: normalizeMode(env.SCALPING_MODE),
    patternRequired: normalizeBool(env.SCALPING_PATTERN_REQUIRED, true),
    patternMinStrength: normalizePatternMinStrength(env.SCALPING_PATTERN_MIN_STRENGTH),
    patternBlockOpposing: normalizeBool(env.SCALPING_PATTERN_BLOCK_OPPOSING, true),
    filters: filtersFromEnv(String(env.SCALPING_ENABLED_FILTERS ?? "")),
    paperBalanceUsd: toNum(env.SCALPING_PAPER_BALANCE, 250),
    maxDailyLossUsd: toNum(env.SCALPING_MAX_DAILY_LOSS_USD, 0),
    tp1Amount: toNum(env.SCALPING_TP1_AMOUNT, 3),
    tp2Amount: toNum(env.SCALPING_TP2_AMOUNT, 5),
    slAmount: toNum(env.SCALPING_SL_AMOUNT, 5),
    trailingEnabled: normalizeBool(env.SCALPING_TRAILING_ENABLED, true),
    lockAtTp1: toNum(env.SCALPING_LOCK_AT_TP1, 3),
    trailDistance: toNum(env.SCALPING_TRAIL_DISTANCE, 1),
    leverage: clampInt(env.SCALPING_LEVERAGE, 20, 1, 50),
    marginPerTrade: toNum(env.SCALPING_MARGIN_PER_TRADE, 10),
    maxConcurrent: clampInt(env.SCALPING_MAX_CONCURRENT, 3, 1, 20),
    maxPerDay: clampInt(env.SCALPING_MAX_PER_DAY, 10, 1, 100),
    timeframe: env.SCALPING_TIMEFRAME,
    minScore: clampInt(env.SCALPING_MIN_SCORE, 70, 0, 100),
    enabledCoins: env.SCALPING_ENABLED_COINS ? String(env.SCALPING_ENABLED_COINS).split(",").map((s) => s.trim()) : []
  })

  g.__abxkScalpingSettings = restored
  return NextResponse.json({ ok: true, data: restored })
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<ScalpSettings>
  const next = normalizeSettings(body)
  g.__abxkScalpingSettings = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnv(prev, toEnvMap(next))
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true })
}

function normalizeSettings(raw: Partial<ScalpSettings>): ScalpSettings {
  const allowed = new Set<string>(SCALP_COINS as unknown as string[])
  const enabledCoinsRaw = Array.isArray(raw.enabledCoins) ? raw.enabledCoins.map(String).filter(Boolean) : []
  const enabledCoins = enabledCoinsRaw.filter((c) => allowed.has(c))
  const filters = normalizeFilters(raw.filters)
  const mode = normalizeMode(raw.mode)
  const patternRequired = normalizeBool(raw.patternRequired, true)
  const patternMinStrength = normalizePatternMinStrength(raw.patternMinStrength)
  const patternBlockOpposing = normalizeBool(raw.patternBlockOpposing, true)
  const timeframe = String(raw.timeframe ?? "5m").toLowerCase()
  const okTf = ["1m", "3m", "5m", "15m", "30m"].includes(timeframe)
  return {
    enabled: Boolean(raw.enabled),
    paused: Boolean(raw.paused),
    mode,
    patternRequired,
    patternMinStrength,
    patternBlockOpposing,
    filters,
    paperBalanceUsd: toNum(raw.paperBalanceUsd, 250),
    maxDailyLossUsd: Math.max(0, toNum(raw.maxDailyLossUsd, 0)),
    tp1Amount: toNum(raw.tp1Amount, 3),
    tp2Amount: toNum(raw.tp2Amount, 5),
    slAmount: toNum(raw.slAmount, 5),
    trailingEnabled: Boolean(raw.trailingEnabled ?? true),
    lockAtTp1: toNum(raw.lockAtTp1, 3),
    trailDistance: toNum(raw.trailDistance, 1),
    leverage: clampInt(raw.leverage, 20, 1, 50),
    marginPerTrade: toNum(raw.marginPerTrade, 10),
    maxConcurrent: clampInt(raw.maxConcurrent, 3, 1, 20),
    maxPerDay: clampInt(raw.maxPerDay, 10, 1, 100),
    timeframe: okTf ? timeframe : "5m",
    minScore: clampInt(raw.minScore, 70, 0, 100),
    enabledCoins
  }
}

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const m = Number.isFinite(n) ? Math.floor(n) : fallback
  return Math.max(min, Math.min(max, m))
}

function toEnvMap(s: ScalpSettings): Record<string, string> {
  const enabledFilters = Object.entries(s.filters)
    .filter(([, on]) => Boolean(on))
    .map(([id]) => id)
    .join(",")
  return {
    SCALPING_ENABLED: s.enabled ? "true" : "false",
    SCALPING_PAUSED: s.paused ? "true" : "false",
    SCALPING_MODE: s.mode,
    SCALPING_PATTERN_REQUIRED: s.patternRequired ? "true" : "false",
    SCALPING_PATTERN_MIN_STRENGTH: s.patternMinStrength,
    SCALPING_PATTERN_BLOCK_OPPOSING: s.patternBlockOpposing ? "true" : "false",
    SCALPING_ENABLED_FILTERS: enabledFilters,
    SCALPING_PAPER_BALANCE: String(s.paperBalanceUsd),
    SCALPING_MAX_DAILY_LOSS_USD: String(s.maxDailyLossUsd),
    SCALPING_TP1_AMOUNT: String(s.tp1Amount),
    SCALPING_TP2_AMOUNT: String(s.tp2Amount),
    SCALPING_SL_AMOUNT: String(s.slAmount),
    SCALPING_TRAILING_ENABLED: s.trailingEnabled ? "true" : "false",
    SCALPING_LOCK_AT_TP1: String(s.lockAtTp1),
    SCALPING_TRAIL_DISTANCE: String(s.trailDistance),
    SCALPING_LEVERAGE: String(s.leverage),
    SCALPING_MARGIN_PER_TRADE: String(s.marginPerTrade),
    SCALPING_MAX_CONCURRENT: String(s.maxConcurrent),
    SCALPING_MAX_PER_DAY: String(s.maxPerDay),
    SCALPING_TIMEFRAME: String(s.timeframe),
    SCALPING_MIN_SCORE: String(s.minScore),
    SCALPING_ENABLED_COINS: s.enabledCoins.join(",")
  }
}

function normalizeMode(v: unknown): "paper" | "live" | "mirror" {
  const s = String(v ?? "paper").toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  return "paper"
}

function normalizeBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  const s = String(v ?? "").toLowerCase().trim()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function normalizePatternMinStrength(v: unknown): "ANY" | "MODERATE" | "STRONG" {
  const s = String(v ?? "MODERATE").toUpperCase()
  if (s === "ANY") return "ANY"
  if (s === "STRONG") return "STRONG"
  return "MODERATE"
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

function filtersFromEnv(raw: string): ScalpFilterState {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return { ...DEFAULT_SCALP_FILTERS }
  const out: ScalpFilterState = { ...DEFAULT_SCALP_FILTERS }
  for (const k of Object.keys(out) as ScalpFilterId[]) out[k] = false
  const allow = new Set<string>(Object.keys(out))
  for (const id of trimmed.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!allow.has(id)) continue
    out[id as ScalpFilterId] = true
  }
  return out
}

function upsertEnv(prev: string, patch: Record<string, string>): string {
  const lines = prev.split(/\r?\n/g)
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      out.push(line)
      continue
    }
    const idx = trimmed.indexOf("=")
    const key = trimmed.slice(0, idx).trim()
    if (key.startsWith("SCALPING_")) continue
    out.push(line)
    seen.add(key)
  }

  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) {
    out.push(`${k}=${v}`)
    seen.add(k)
  }
  out.push("")
  return out.join("\n")
}

function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = text.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}
