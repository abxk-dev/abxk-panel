import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { DEFAULT_SCALPING3_SETTINGS, settingsFromScalp3Env, toEnvMap } from "@/lib/scalping3/settings"
import type { Scalping3Mode, Scalping3Settings, Scalping3Timeframe } from "@/lib/scalping3/types"

export const runtime = "nodejs"

const g = globalThis as unknown as { __abxkScalping3Settings?: Scalping3Settings }

export async function GET() {
  const fromMem = g.__abxkScalping3Settings
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const hasAny = Object.keys(env).some((k) => k.startsWith("SCALPING3_"))
  if (!hasAny) return NextResponse.json({ ok: true, data: null })

  const restored = settingsFromScalp3Env(env)
  g.__abxkScalping3Settings = restored
  return NextResponse.json({ ok: true, data: restored })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Scalping3Settings>
  const next = normalizeSettings(body)
  g.__abxkScalping3Settings = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnv(prev, toEnvMap(next))
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true, data: next })
}

function normalizeSettings(raw: Partial<Scalping3Settings>): Scalping3Settings {
  const enabledSymbols = Array.isArray(raw.enabledSymbols) ? raw.enabledSymbols.map((s) => String(s).trim()).filter(Boolean) : undefined
  const next: Scalping3Settings = {
    ...DEFAULT_SCALPING3_SETTINGS,
    ...raw,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SCALPING3_SETTINGS.enabled,
    paused: typeof raw.paused === "boolean" ? raw.paused : DEFAULT_SCALPING3_SETTINGS.paused,
    mode: normalizeMode(raw.mode),
    timeframe: normalizeTimeframe(raw.timeframe),
    minSmcScore: clampInt(raw.minSmcScore, 0, 100, DEFAULT_SCALPING3_SETTINGS.minSmcScore),
    minVolumeRatio: toNum(raw.minVolumeRatio, DEFAULT_SCALPING3_SETTINGS.minVolumeRatio),
    marginPerTrade: toNum(raw.marginPerTrade, DEFAULT_SCALPING3_SETTINGS.marginPerTrade),
    leverage: clampInt(raw.leverage, 1, 50, DEFAULT_SCALPING3_SETTINGS.leverage),
    minRR: toNum(raw.minRR, DEFAULT_SCALPING3_SETTINGS.minRR),
    useGlobalTargets: typeof raw.useGlobalTargets === "boolean" ? raw.useGlobalTargets : DEFAULT_SCALPING3_SETTINGS.useGlobalTargets,
    globalSlPct: Math.max(0, toNum(raw.globalSlPct, DEFAULT_SCALPING3_SETTINGS.globalSlPct)),
    globalTp1Pct: Math.max(0, toNum(raw.globalTp1Pct, DEFAULT_SCALPING3_SETTINGS.globalTp1Pct)),
    globalTp2Pct: Math.max(0, toNum(raw.globalTp2Pct, DEFAULT_SCALPING3_SETTINGS.globalTp2Pct)),
    maxPerDay: clampInt(raw.maxPerDay, 1, 200, DEFAULT_SCALPING3_SETTINGS.maxPerDay),
    enabledSymbols: enabledSymbols && enabledSymbols.length ? enabledSymbols : DEFAULT_SCALPING3_SETTINGS.enabledSymbols
  }
  if (next.globalTp2Pct > 0 && next.globalTp1Pct > next.globalTp2Pct) next.globalTp1Pct = next.globalTp2Pct
  return next
}

function normalizeMode(v: unknown): Scalping3Mode {
  const s = String(v ?? "paper").toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  return "paper"
}

function normalizeTimeframe(v: unknown): Scalping3Timeframe {
  const s = String(v ?? "5m").toLowerCase()
  if (s === "1m" || s === "3m" || s === "5m" || s === "15m") return s
  return "5m"
}

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(toNum(v, fallback))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
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
    if (key.startsWith("SCALPING3_")) continue
    out.push(line)
  }
  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) out.push(`${k}=${v}`)
  out.push("")
  return out.join("\n")
}
