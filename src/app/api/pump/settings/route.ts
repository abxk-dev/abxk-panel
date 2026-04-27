import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { DEFAULT_PUMP_SETTINGS, type PumpAlertSettings, type PumpLevel } from "@/lib/pumpDetector"

export const runtime = "nodejs"

const g = globalThis as unknown as { __abxkPumpSettings?: PumpAlertSettings }

export async function GET() {
  const fromMem = g.__abxkPumpSettings
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const hasAny = Object.keys(env).some((k) => k.startsWith("PUMP_"))
  if (!hasAny) return NextResponse.json({ ok: true, data: null })

  const restored = normalizeSettings({
    enabled: normalizeBool(env.PUMP_ALERT_ENABLED, DEFAULT_PUMP_SETTINGS.enabled),
    mode: normalizeMode(env.PUMP_MODE),
    tradeLow: normalizeBool(env.PUMP_TRADE_LOW, DEFAULT_PUMP_SETTINGS.tradeLow),
    tradeMedium: normalizeBool(env.PUMP_TRADE_MEDIUM, DEFAULT_PUMP_SETTINGS.tradeMedium),
    tradeHigh: normalizeBool(env.PUMP_TRADE_HIGH, DEFAULT_PUMP_SETTINGS.tradeHigh),
    tradeExtreme: normalizeBool(env.PUMP_TRADE_EXTREME, DEFAULT_PUMP_SETTINGS.tradeExtreme),
    maxConcurrentPumps: clampInt(env.PUMP_MAX_CONCURRENT, DEFAULT_PUMP_SETTINGS.maxConcurrentPumps, 1, 20),
    maxPumpsPerHour: clampInt(env.PUMP_MAX_PER_HOUR, DEFAULT_PUMP_SETTINGS.maxPumpsPerHour, 1, 100),
    cooldownAfterTrade: clampInt(env.PUMP_COOLDOWN_MIN, DEFAULT_PUMP_SETTINGS.cooldownAfterTrade, 0, 3600),
    minConfidence: clampInt(env.PUMP_MIN_CONFIDENCE, DEFAULT_PUMP_SETTINGS.minConfidence, 0, 100),
    blacklistedCoins: env.PUMP_BLACKLIST ? String(env.PUMP_BLACKLIST).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    levels: {
      LOW: levelFromEnv(env, "LOW"),
      MEDIUM: levelFromEnv(env, "MEDIUM"),
      HIGH: levelFromEnv(env, "HIGH"),
      EXTREME: levelFromEnv(env, "EXTREME")
    }
  })

  g.__abxkPumpSettings = restored
  return NextResponse.json({ ok: true, data: restored })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PumpAlertSettings>
  const next = normalizeSettings(body)
  g.__abxkPumpSettings = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnv(prev, toEnvMap(next))
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true })
}

function levelFromEnv(env: Record<string, string>, level: PumpLevel) {
  const p = `PUMP_${level}_`
  const fallback = DEFAULT_PUMP_SETTINGS.levels[level]
  return {
    margin: clampNum(env[`${p}MARGIN`], fallback.margin, 0, 1_000_000),
    leverage: clampInt(env[`${p}LEVERAGE`], fallback.leverage, 1, 50),
    tpPercent: clampNum(env[`${p}TP_PCT`], fallback.tpPercent, 0, 100),
    slPercent: clampNum(env[`${p}SL_PCT`], fallback.slPercent, 0, 100),
    trailingEnabled: normalizeBool(env[`${p}TRAILING`], fallback.trailingEnabled),
    trailingActivateAt: clampNum(env[`${p}TRAIL_ACTIVATE_PCT`], fallback.trailingActivateAt, 0, 100),
    trailingDistance: clampNum(env[`${p}TRAIL_DISTANCE_PCT`], fallback.trailingDistance, 0, 100)
  }
}

function normalizeSettings(raw: Partial<PumpAlertSettings>): PumpAlertSettings {
  const levelsIn = (raw.levels ?? {}) as any
  const out: PumpAlertSettings = {
    ...DEFAULT_PUMP_SETTINGS,
    enabled: Boolean(raw.enabled ?? DEFAULT_PUMP_SETTINGS.enabled),
    mode: normalizeMode(raw.mode ?? DEFAULT_PUMP_SETTINGS.mode),
    tradeLow: Boolean(raw.tradeLow ?? DEFAULT_PUMP_SETTINGS.tradeLow),
    tradeMedium: Boolean(raw.tradeMedium ?? DEFAULT_PUMP_SETTINGS.tradeMedium),
    tradeHigh: Boolean(raw.tradeHigh ?? DEFAULT_PUMP_SETTINGS.tradeHigh),
    tradeExtreme: Boolean(raw.tradeExtreme ?? DEFAULT_PUMP_SETTINGS.tradeExtreme),
    maxConcurrentPumps: clampInt(raw.maxConcurrentPumps, DEFAULT_PUMP_SETTINGS.maxConcurrentPumps, 1, 20),
    maxPumpsPerHour: clampInt(raw.maxPumpsPerHour, DEFAULT_PUMP_SETTINGS.maxPumpsPerHour, 1, 100),
    cooldownAfterTrade: clampInt(raw.cooldownAfterTrade, DEFAULT_PUMP_SETTINGS.cooldownAfterTrade, 0, 3600),
    minConfidence: clampInt(raw.minConfidence, DEFAULT_PUMP_SETTINGS.minConfidence, 0, 100),
    blacklistedCoins: Array.isArray(raw.blacklistedCoins)
      ? raw.blacklistedCoins.map(String).map((s) => s.trim()).filter(Boolean)
      : DEFAULT_PUMP_SETTINGS.blacklistedCoins,
    levels: {
      LOW: normalizeLevel(levelsIn.LOW, "LOW"),
      MEDIUM: normalizeLevel(levelsIn.MEDIUM, "MEDIUM"),
      HIGH: normalizeLevel(levelsIn.HIGH, "HIGH"),
      EXTREME: normalizeLevel(levelsIn.EXTREME, "EXTREME")
    }
  }
  return out
}

function normalizeLevel(v: any, level: PumpLevel) {
  const fallback = DEFAULT_PUMP_SETTINGS.levels[level]
  return {
    margin: clampNum(v?.margin, fallback.margin, 0, 1_000_000),
    leverage: clampInt(v?.leverage, fallback.leverage, 1, 50),
    tpPercent: clampNum(v?.tpPercent, fallback.tpPercent, 0, 100),
    slPercent: clampNum(v?.slPercent, fallback.slPercent, 0, 100),
    trailingEnabled: Boolean(v?.trailingEnabled ?? fallback.trailingEnabled),
    trailingActivateAt: clampNum(v?.trailingActivateAt, fallback.trailingActivateAt, 0, 100),
    trailingDistance: clampNum(v?.trailingDistance, fallback.trailingDistance, 0, 100)
  }
}

function toEnvMap(s: PumpAlertSettings): Record<string, string> {
  const out: Record<string, string> = {
    PUMP_ALERT_ENABLED: s.enabled ? "true" : "false",
    PUMP_MODE: s.mode,
    PUMP_TRADE_LOW: s.tradeLow ? "true" : "false",
    PUMP_TRADE_MEDIUM: s.tradeMedium ? "true" : "false",
    PUMP_TRADE_HIGH: s.tradeHigh ? "true" : "false",
    PUMP_TRADE_EXTREME: s.tradeExtreme ? "true" : "false",
    PUMP_MAX_CONCURRENT: String(s.maxConcurrentPumps),
    PUMP_MAX_PER_HOUR: String(s.maxPumpsPerHour),
    PUMP_COOLDOWN_MIN: String(s.cooldownAfterTrade),
    PUMP_MIN_CONFIDENCE: String(s.minConfidence),
    PUMP_BLACKLIST: s.blacklistedCoins.join(",")
  }

  for (const level of ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const) {
    const p = `PUMP_${level}_`
    const lv = s.levels[level]
    out[`${p}MARGIN`] = String(lv.margin)
    out[`${p}LEVERAGE`] = String(lv.leverage)
    out[`${p}TP_PCT`] = String(lv.tpPercent)
    out[`${p}SL_PCT`] = String(lv.slPercent)
    out[`${p}TRAILING`] = lv.trailingEnabled ? "true" : "false"
    out[`${p}TRAIL_ACTIVATE_PCT`] = String(lv.trailingActivateAt)
    out[`${p}TRAIL_DISTANCE_PCT`] = String(lv.trailingDistance)
  }

  return out
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

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const x = Number.isFinite(n) ? n : fallback
  return Math.max(min, Math.min(max, x))
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const x = Number.isFinite(n) ? Math.floor(n) : fallback
  return Math.max(min, Math.min(max, x))
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
    if (key.startsWith("PUMP_")) continue
    out.push(line)
  }

  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) out.push(`${k}=${v}`)
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
