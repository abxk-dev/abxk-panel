import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import type { PumpLevel } from "@/lib/pumpDetector"

export const runtime = "nodejs"

type Pump2LevelConfig = {
  enabled: boolean
  pct: number
  timeframeMin: number
  volX: number
}

type Pump2Settings = {
  enabled: boolean
  minVolumeUsd: number
  debounceMinutes: number
  minPriceChangeAbs: number
  mtcEnabled: boolean
  mtcTimeframes: number[]
  mtcMinConfirmations: number
  levels: Record<PumpLevel, Pump2LevelConfig>
  trade: {
    enabled: boolean
    mode: "paper" | "live" | "mirror"
    leverage: number
    marginUsd: number
    stopLoss: { mode: "PCT" | "USD"; value: number }
    takeProfit: { mode: "PCT" | "USD"; value: number }
    trailingStop: { enabled: boolean; activateAtUsd: number; distanceUsd: number }
  }
}

const DEFAULT_SETTINGS: Pump2Settings = {
  enabled: false,
  minVolumeUsd: 1_000_000,
  debounceMinutes: 20,
  minPriceChangeAbs: 0.01,
  mtcEnabled: true,
  mtcTimeframes: [5, 10, 15],
  mtcMinConfirmations: 2,
  levels: {
    LOW: { enabled: true, pct: 1.5, timeframeMin: 5, volX: 2.0 },
    MEDIUM: { enabled: true, pct: 3.0, timeframeMin: 5, volX: 3.0 },
    HIGH: { enabled: true, pct: 5.0, timeframeMin: 5, volX: 5.0 },
    EXTREME: { enabled: true, pct: 10.0, timeframeMin: 5, volX: 10.0 }
  },
  trade: {
    enabled: false,
    mode: "paper",
    leverage: 10,
    marginUsd: 10,
    stopLoss: { mode: "PCT", value: 2 },
    takeProfit: { mode: "PCT", value: 1.5 },
    trailingStop: { enabled: true, activateAtUsd: 2, distanceUsd: 1 }
  }
}

const g = globalThis as unknown as { __abxkPump2Settings?: Pump2Settings }

export async function GET() {
  const fromMem = g.__abxkPump2Settings
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const hasAny = Object.keys(env).some((k) => k.startsWith("PUMP2_"))
  if (!hasAny) return NextResponse.json({ ok: true, data: null })

  const slModeRaw = String(env.PUMP2_TRADE_SL_MODE ?? DEFAULT_SETTINGS.trade.stopLoss.mode).toUpperCase()
  const slMode = slModeRaw === "USD" ? "USD" : "PCT"
  const tpModeRaw = String(env.PUMP2_TRADE_TP_MODE ?? DEFAULT_SETTINGS.trade.takeProfit.mode).toUpperCase()
  const tpMode = tpModeRaw === "USD" ? "USD" : "PCT"

  const restored = normalizeSettings({
    enabled: normalizeBool(env.PUMP2_ENABLED, DEFAULT_SETTINGS.enabled),
    minVolumeUsd: clampNum(env.PUMP2_MIN_VOL_USD, DEFAULT_SETTINGS.minVolumeUsd, 0, 1_000_000_000),
    debounceMinutes: clampInt(env.PUMP2_DEBOUNCE_MIN, DEFAULT_SETTINGS.debounceMinutes, 0, 3600),
    minPriceChangeAbs: clampNum(env.PUMP2_MIN_PRICE_CHANGE_ABS, DEFAULT_SETTINGS.minPriceChangeAbs, 0, 100),
    mtcEnabled: normalizeBool(env.PUMP2_MTC_ENABLED, DEFAULT_SETTINGS.mtcEnabled),
    mtcTimeframes: parseNumberList(env.PUMP2_MTC_TIMEFRAMES, DEFAULT_SETTINGS.mtcTimeframes),
    mtcMinConfirmations: clampInt(env.PUMP2_MTC_MIN_CONFIRM, DEFAULT_SETTINGS.mtcMinConfirmations, 0, 20),
    levels: {
      LOW: levelFromEnv(env, "LOW"),
      MEDIUM: levelFromEnv(env, "MEDIUM"),
      HIGH: levelFromEnv(env, "HIGH"),
      EXTREME: levelFromEnv(env, "EXTREME")
    },
    trade: {
      enabled: normalizeBool(env.PUMP2_TRADE_ENABLED, DEFAULT_SETTINGS.trade.enabled),
      mode: normalizeMode(env.PUMP2_TRADE_MODE ?? DEFAULT_SETTINGS.trade.mode),
      leverage: clampInt(env.PUMP2_TRADE_LEVERAGE, DEFAULT_SETTINGS.trade.leverage, 1, 50),
      marginUsd: clampNum(env.PUMP2_TRADE_MARGIN_USD, DEFAULT_SETTINGS.trade.marginUsd, 0, 1_000_000_000),
      stopLoss: { mode: slMode, value: clampNum(env.PUMP2_TRADE_SL_VALUE, DEFAULT_SETTINGS.trade.stopLoss.value, 0, 1_000_000_000) },
      takeProfit: { mode: tpMode, value: clampNum(env.PUMP2_TRADE_TP_VALUE, DEFAULT_SETTINGS.trade.takeProfit.value, 0, 1_000_000_000) },
      trailingStop: {
        enabled: normalizeBool(env.PUMP2_TRADE_TRAILING_ENABLED, DEFAULT_SETTINGS.trade.trailingStop.enabled),
        activateAtUsd: clampNum(env.PUMP2_TRADE_TRAIL_ACTIVATE_USD, DEFAULT_SETTINGS.trade.trailingStop.activateAtUsd, 0, 1_000_000_000),
        distanceUsd: clampNum(env.PUMP2_TRADE_TRAIL_DISTANCE_USD, DEFAULT_SETTINGS.trade.trailingStop.distanceUsd, 0, 1_000_000_000)
      }
    }
  })

  g.__abxkPump2Settings = restored
  return NextResponse.json({ ok: true, data: restored })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Pump2Settings>
  const next = normalizeSettings(body)
  g.__abxkPump2Settings = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnv(prev, toEnvMap(next))
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true })
}

function levelFromEnv(env: Record<string, string>, level: PumpLevel): Pump2LevelConfig {
  const p = `PUMP2_${level}_`
  const fallback = DEFAULT_SETTINGS.levels[level]
  return {
    enabled: normalizeBool(env[`${p}ENABLED`], fallback.enabled),
    pct: clampNum(env[`${p}PCT`], fallback.pct, 0, 100),
    timeframeMin: clampInt(env[`${p}TF_MIN`], fallback.timeframeMin, 1, 720),
    volX: clampNum(env[`${p}VOLX`], fallback.volX, 0, 1_000_000)
  }
}

function normalizeSettings(raw: Partial<Pump2Settings>): Pump2Settings {
  const v = (raw ?? {}) as any
  const base = DEFAULT_SETTINGS
  const levelsIn = (v.levels ?? {}) as any
  const fixLevel = (level: PumpLevel): Pump2LevelConfig => {
    const fb = base.levels[level]
    const lv = (levelsIn as any)[level] ?? {}
    return {
      enabled: Boolean(lv.enabled ?? fb.enabled),
      pct: clampNum(lv.pct, fb.pct, 0, 100),
      timeframeMin: clampInt(lv.timeframeMin, fb.timeframeMin, 1, 720),
      volX: clampNum(lv.volX, fb.volX, 0, 1_000_000)
    }
  }

  const mtcTimeframes = Array.isArray(v.mtcTimeframes) ? v.mtcTimeframes.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : base.mtcTimeframes
  const slModeRaw = String(v?.trade?.stopLoss?.mode ?? base.trade.stopLoss.mode).toUpperCase()
  const slMode = slModeRaw === "USD" ? "USD" : "PCT"
  const tpModeRaw = String(v?.trade?.takeProfit?.mode ?? base.trade.takeProfit.mode).toUpperCase()
  const tpMode = tpModeRaw === "USD" ? "USD" : "PCT"
  return {
    enabled: Boolean(v.enabled ?? base.enabled),
    minVolumeUsd: clampNum(v.minVolumeUsd, base.minVolumeUsd, 0, 1_000_000_000),
    debounceMinutes: clampInt(v.debounceMinutes, base.debounceMinutes, 0, 3600),
    minPriceChangeAbs: clampNum(v.minPriceChangeAbs, base.minPriceChangeAbs, 0, 100),
    mtcEnabled: Boolean(v.mtcEnabled ?? base.mtcEnabled),
    mtcTimeframes: mtcTimeframes.length ? mtcTimeframes : base.mtcTimeframes,
    mtcMinConfirmations: clampInt(v.mtcMinConfirmations, base.mtcMinConfirmations, 0, 20),
    levels: {
      LOW: fixLevel("LOW"),
      MEDIUM: fixLevel("MEDIUM"),
      HIGH: fixLevel("HIGH"),
      EXTREME: fixLevel("EXTREME")
    },
    trade: {
      enabled: Boolean(v?.trade?.enabled ?? base.trade.enabled),
      mode: normalizeMode(v?.trade?.mode ?? base.trade.mode),
      leverage: clampInt(v?.trade?.leverage, base.trade.leverage, 1, 50),
      marginUsd: clampNum(v?.trade?.marginUsd, base.trade.marginUsd, 0, 1_000_000_000),
      stopLoss: { mode: slMode, value: clampNum(v?.trade?.stopLoss?.value, base.trade.stopLoss.value, 0, 1_000_000_000) },
      takeProfit: { mode: tpMode, value: clampNum(v?.trade?.takeProfit?.value, base.trade.takeProfit.value, 0, 1_000_000_000) },
      trailingStop: {
        enabled: Boolean(v?.trade?.trailingStop?.enabled ?? base.trade.trailingStop.enabled),
        activateAtUsd: clampNum(v?.trade?.trailingStop?.activateAtUsd, base.trade.trailingStop.activateAtUsd, 0, 1_000_000_000),
        distanceUsd: clampNum(v?.trade?.trailingStop?.distanceUsd, base.trade.trailingStop.distanceUsd, 0, 1_000_000_000)
      }
    }
  }
}

function toEnvMap(s: Pump2Settings): Record<string, string> {
  const out: Record<string, string> = {
    PUMP2_ENABLED: s.enabled ? "true" : "false",
    PUMP2_MIN_VOL_USD: String(s.minVolumeUsd),
    PUMP2_DEBOUNCE_MIN: String(s.debounceMinutes),
    PUMP2_MIN_PRICE_CHANGE_ABS: String(s.minPriceChangeAbs),
    PUMP2_MTC_ENABLED: s.mtcEnabled ? "true" : "false",
    PUMP2_MTC_TIMEFRAMES: s.mtcTimeframes.join(","),
    PUMP2_MTC_MIN_CONFIRM: String(s.mtcMinConfirmations),
    PUMP2_TRADE_ENABLED: s.trade.enabled ? "true" : "false",
    PUMP2_TRADE_MODE: s.trade.mode,
    PUMP2_TRADE_LEVERAGE: String(s.trade.leverage),
    PUMP2_TRADE_MARGIN_USD: String(s.trade.marginUsd),
    PUMP2_TRADE_SL_MODE: s.trade.stopLoss.mode,
    PUMP2_TRADE_SL_VALUE: String(s.trade.stopLoss.value),
    PUMP2_TRADE_TP_MODE: s.trade.takeProfit.mode,
    PUMP2_TRADE_TP_VALUE: String(s.trade.takeProfit.value),
    PUMP2_TRADE_TRAILING_ENABLED: s.trade.trailingStop.enabled ? "true" : "false",
    PUMP2_TRADE_TRAIL_ACTIVATE_USD: String(s.trade.trailingStop.activateAtUsd),
    PUMP2_TRADE_TRAIL_DISTANCE_USD: String(s.trade.trailingStop.distanceUsd)
  }

  for (const level of ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const) {
    const p = `PUMP2_${level}_`
    const lv = s.levels[level]
    out[`${p}ENABLED`] = lv.enabled ? "true" : "false"
    out[`${p}PCT`] = String(lv.pct)
    out[`${p}TF_MIN`] = String(lv.timeframeMin)
    out[`${p}VOLX`] = String(lv.volX)
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

function parseNumberList(v: unknown, fallback: number[]): number[] {
  const s = String(v ?? "").trim()
  if (!s) return fallback
  const out = s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return out.length ? out : fallback
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
    if (key.startsWith("PUMP2_")) continue
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
