import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { DEFAULT_SCALP2_FILTERS, SCALP_COINS, type Scalp2FilterId, type Scalp2FilterState } from "@/lib/scalpEngine"

export const runtime = "nodejs"

type Scalp2Settings = {
  enabled: boolean
  paused: boolean
  mode: "paper" | "live" | "mirror"
  patternRequired: boolean
  patternMinStrength: "ANY" | "MODERATE" | "STRONG"
  patternBlockOpposing: boolean
  filters: Scalp2FilterState
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

const g = globalThis as unknown as { __abxkScalping2Settings?: Scalp2Settings }

export async function GET() {
  const fromMem = g.__abxkScalping2Settings
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const hasAny = Object.keys(env).some((k) => k.startsWith("SCALPING2_"))
  if (!hasAny) return NextResponse.json({ ok: true, data: null })

  const restored = normalizeSettings({
    enabled: normalizeBool(env.SCALPING2_ENABLED, false),
    paused: normalizeBool(env.SCALPING2_PAUSED, false),
    mode: normalizeMode(env.SCALPING2_MODE),
    patternRequired: normalizeBool(env.SCALPING2_PATTERN_REQUIRED, false),
    patternMinStrength: normalizePatternMinStrength(env.SCALPING2_PATTERN_MIN_STRENGTH),
    patternBlockOpposing: normalizeBool(env.SCALPING2_PATTERN_BLOCK_OPPOSING, true),
    filters: filtersFromEnv(String(env.SCALPING2_ENABLED_FILTERS ?? "")),
    paperBalanceUsd: toNum(env.SCALPING2_PAPER_BALANCE, 250),
    maxDailyLossUsd: toNum(env.SCALPING2_MAX_DAILY_LOSS_USD, 0),
    tp1Amount: toNum(env.SCALPING2_TP1_AMOUNT, 3),
    tp2Amount: toNum(env.SCALPING2_TP2_AMOUNT, 5),
    slAmount: toNum(env.SCALPING2_SL_AMOUNT, 5),
    trailingEnabled: normalizeBool(env.SCALPING2_TRAILING_ENABLED, true),
    lockAtTp1: toNum(env.SCALPING2_LOCK_AT_TP1, 3),
    trailDistance: toNum(env.SCALPING2_TRAIL_DISTANCE, 1),
    leverage: clampInt(env.SCALPING2_LEVERAGE, 20, 1, 50),
    marginPerTrade: toNum(env.SCALPING2_MARGIN_PER_TRADE, 10),
    maxConcurrent: clampInt(env.SCALPING2_MAX_CONCURRENT, 3, 1, 20),
    maxPerDay: clampInt(env.SCALPING2_MAX_PER_DAY, 10, 1, 100),
    timeframe: env.SCALPING2_TIMEFRAME,
    minScore: clampInt(env.SCALPING2_MIN_SCORE, 100, 0, 100),
    enabledCoins: env.SCALPING2_ENABLED_COINS ? String(env.SCALPING2_ENABLED_COINS).split(",").map((s) => s.trim()) : []
  })

  g.__abxkScalping2Settings = restored
  return NextResponse.json({ ok: true, data: restored })
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Scalp2Settings>
  const next = normalizeSettings(body)
  g.__abxkScalping2Settings = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnv(prev, toEnvMap(next))
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true })
}

function normalizeSettings(raw: Partial<Scalp2Settings>): Scalp2Settings {
  const allowed = new Set<string>(SCALP_COINS as unknown as string[])
  const enabledCoinsRaw = Array.isArray(raw.enabledCoins) ? raw.enabledCoins.map(String).filter(Boolean) : []
  const enabledCoins = enabledCoinsRaw.filter((c) => allowed.has(c))
  const filters = normalizeFilters(raw.filters)
  const mode = normalizeMode(raw.mode)
  const patternRequired = normalizeBool(raw.patternRequired, false)
  const patternMinStrength = normalizePatternMinStrength(raw.patternMinStrength)
  const patternBlockOpposing = normalizeBool(raw.patternBlockOpposing, true)
  const timeframe = String(raw.timeframe ?? "3m").toLowerCase()
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
    timeframe: okTf ? timeframe : "3m",
    minScore: clampInt(raw.minScore, 100, 0, 100),
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

function toEnvMap(s: Scalp2Settings): Record<string, string> {
  const enabledFilters = Object.entries(s.filters)
    .filter(([, on]) => Boolean(on))
    .map(([id]) => id)
    .join(",")
  return {
    SCALPING2_ENABLED: s.enabled ? "true" : "false",
    SCALPING2_PAUSED: s.paused ? "true" : "false",
    SCALPING2_MODE: s.mode,
    SCALPING2_PATTERN_REQUIRED: s.patternRequired ? "true" : "false",
    SCALPING2_PATTERN_MIN_STRENGTH: s.patternMinStrength,
    SCALPING2_PATTERN_BLOCK_OPPOSING: s.patternBlockOpposing ? "true" : "false",
    SCALPING2_ENABLED_FILTERS: enabledFilters,
    SCALPING2_PAPER_BALANCE: String(s.paperBalanceUsd),
    SCALPING2_MAX_DAILY_LOSS_USD: String(s.maxDailyLossUsd),
    SCALPING2_TP1_AMOUNT: String(s.tp1Amount),
    SCALPING2_TP2_AMOUNT: String(s.tp2Amount),
    SCALPING2_SL_AMOUNT: String(s.slAmount),
    SCALPING2_TRAILING_ENABLED: s.trailingEnabled ? "true" : "false",
    SCALPING2_LOCK_AT_TP1: String(s.lockAtTp1),
    SCALPING2_TRAIL_DISTANCE: String(s.trailDistance),
    SCALPING2_LEVERAGE: String(s.leverage),
    SCALPING2_MARGIN_PER_TRADE: String(s.marginPerTrade),
    SCALPING2_MAX_CONCURRENT: String(s.maxConcurrent),
    SCALPING2_MAX_PER_DAY: String(s.maxPerDay),
    SCALPING2_TIMEFRAME: String(s.timeframe),
    SCALPING2_MIN_SCORE: String(s.minScore),
    SCALPING2_ENABLED_COINS: s.enabledCoins.join(",")
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

function filtersFromEnv(raw: string): Scalp2FilterState {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return { ...DEFAULT_SCALP2_FILTERS }
  const allow = new Set<string>(Object.keys(DEFAULT_SCALP2_FILTERS))
  const enabled = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && allow.has(s))
  const out: Scalp2FilterState = { ...DEFAULT_SCALP2_FILTERS }
  for (const k of Object.keys(out) as Scalp2FilterId[]) out[k] = false
  for (const id of enabled as Scalp2FilterId[]) out[id] = true
  return out
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

function upsertEnv(prev: string, patch: Record<string, string>): string {
  const lines = prev.split(/\r?\n/g)
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      out.push(line)
      continue
    }
    const idx = trimmed.indexOf("=")
    const key = trimmed.slice(0, idx).trim()
    if (key.startsWith("SCALPING2_")) continue
    out.push(line)
  }
  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) out.push(`${k}=${v}`)
  out.push("")
  return out.join("\n")
}
