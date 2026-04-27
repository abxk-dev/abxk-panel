import { SCALP_COINS } from "@/lib/scalpEngine"
import type { Scalping3Mode, Scalping3Settings, Scalping3Timeframe } from "@/lib/scalping3/types"

export const DEFAULT_SCALPING3_SETTINGS: Scalping3Settings = {
  enabled: false,
  paused: false,
  mode: "paper",
  timeframe: "5m",
  minSmcScore: 55,
  minVolumeRatio: 1.5,
  marginPerTrade: 20,
  leverage: 10,
  minRR: 1.5,
  useGlobalTargets: false,
  globalSlPct: 0.35,
  globalTp1Pct: 0.5,
  globalTp2Pct: 0.9,
  maxPerDay: 5,
  enabledSymbols: SCALP_COINS.slice(0, 8) as unknown as string[]
}

export function settingsFromScalp3Env(env: Record<string, string | undefined>): Scalping3Settings {
  const tf = normalizeTimeframe(env.SCALPING3_TIMEFRAME, DEFAULT_SCALPING3_SETTINGS.timeframe)
  const enabledCoins = String(env.SCALPING3_ENABLED_COINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return normalizeSettings({
    enabled: toBool(env.SCALPING3_ENABLED, DEFAULT_SCALPING3_SETTINGS.enabled),
    paused: toBool(env.SCALPING3_PAUSED, DEFAULT_SCALPING3_SETTINGS.paused),
    mode: normalizeMode(env.SCALPING3_MODE, DEFAULT_SCALPING3_SETTINGS.mode),
    timeframe: tf,
    minSmcScore: clampInt(env.SCALPING3_MIN_SMC_SCORE, DEFAULT_SCALPING3_SETTINGS.minSmcScore, 0, 100),
    minVolumeRatio: toNum(env.SCALPING3_MIN_VOLUME_RATIO, DEFAULT_SCALPING3_SETTINGS.minVolumeRatio),
    marginPerTrade: toNum(env.SCALPING3_MARGIN, DEFAULT_SCALPING3_SETTINGS.marginPerTrade),
    leverage: clampInt(env.SCALPING3_LEVERAGE, DEFAULT_SCALPING3_SETTINGS.leverage, 1, 50),
    minRR: toNum(env.SCALPING3_MIN_RR, DEFAULT_SCALPING3_SETTINGS.minRR),
    useGlobalTargets: toBool(env.SCALPING3_USE_GLOBAL_TARGETS, DEFAULT_SCALPING3_SETTINGS.useGlobalTargets),
    globalSlPct: toNum(env.SCALPING3_GLOBAL_SL_PCT, DEFAULT_SCALPING3_SETTINGS.globalSlPct),
    globalTp1Pct: toNum(env.SCALPING3_GLOBAL_TP1_PCT, DEFAULT_SCALPING3_SETTINGS.globalTp1Pct),
    globalTp2Pct: toNum(env.SCALPING3_GLOBAL_TP2_PCT, DEFAULT_SCALPING3_SETTINGS.globalTp2Pct),
    maxPerDay: clampInt(env.SCALPING3_MAX_TRADES, DEFAULT_SCALPING3_SETTINGS.maxPerDay, 1, 200),
    enabledSymbols: enabledCoins.length ? enabledCoins : DEFAULT_SCALPING3_SETTINGS.enabledSymbols
  })
}

export function toEnvMap(s: Scalping3Settings): Record<string, string> {
  return {
    SCALPING3_ENABLED: s.enabled ? "true" : "false",
    SCALPING3_PAUSED: s.paused ? "true" : "false",
    SCALPING3_MODE: s.mode,
    SCALPING3_TIMEFRAME: s.timeframe,
    SCALPING3_MIN_SMC_SCORE: String(s.minSmcScore),
    SCALPING3_MIN_VOLUME_RATIO: String(s.minVolumeRatio),
    SCALPING3_MARGIN: String(s.marginPerTrade),
    SCALPING3_LEVERAGE: String(s.leverage),
    SCALPING3_MIN_RR: String(s.minRR),
    SCALPING3_USE_GLOBAL_TARGETS: s.useGlobalTargets ? "true" : "false",
    SCALPING3_GLOBAL_SL_PCT: String(s.globalSlPct),
    SCALPING3_GLOBAL_TP1_PCT: String(s.globalTp1Pct),
    SCALPING3_GLOBAL_TP2_PCT: String(s.globalTp2Pct),
    SCALPING3_MAX_TRADES: String(s.maxPerDay),
    SCALPING3_ENABLED_COINS: s.enabledSymbols.join(",")
  }
}

function normalizeSettings(raw: Partial<Scalping3Settings>): Scalping3Settings {
  const out: Scalping3Settings = {
    ...DEFAULT_SCALPING3_SETTINGS,
    ...raw
  }
  if (out.minVolumeRatio < 0) out.minVolumeRatio = DEFAULT_SCALPING3_SETTINGS.minVolumeRatio
  if (out.marginPerTrade < 0) out.marginPerTrade = DEFAULT_SCALPING3_SETTINGS.marginPerTrade
  if (out.minRR < 0) out.minRR = DEFAULT_SCALPING3_SETTINGS.minRR
  if (out.globalSlPct < 0) out.globalSlPct = DEFAULT_SCALPING3_SETTINGS.globalSlPct
  if (out.globalTp1Pct < 0) out.globalTp1Pct = DEFAULT_SCALPING3_SETTINGS.globalTp1Pct
  if (out.globalTp2Pct < 0) out.globalTp2Pct = DEFAULT_SCALPING3_SETTINGS.globalTp2Pct
  if (out.globalTp2Pct > 0 && out.globalTp1Pct > out.globalTp2Pct) out.globalTp1Pct = out.globalTp2Pct
  out.enabledSymbols = (out.enabledSymbols ?? []).filter(Boolean)
  if (!out.enabledSymbols.length) out.enabledSymbols = [...DEFAULT_SCALPING3_SETTINGS.enabledSymbols]
  return out
}

function toBool(v: unknown, fallback: boolean): boolean {
  const s = String(v ?? "").trim().toLowerCase()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(toNum(v, fallback))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeMode(v: unknown, fallback: Scalping3Mode): Scalping3Mode {
  const s = String(v ?? "").trim().toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  if (s === "paper") return "paper"
  return fallback
}

function normalizeTimeframe(v: unknown, fallback: Scalping3Timeframe): Scalping3Timeframe {
  const s = String(v ?? "").trim().toLowerCase()
  if (s === "1m" || s === "3m" || s === "5m" || s === "15m") return s
  return fallback
}
