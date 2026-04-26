import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

type BotCommand = {
  paused?: boolean
  scanNow?: boolean
  reportNow?: boolean
  healthNow?: boolean
  closeNow?: boolean
  emergencyNow?: boolean
  restartOnce?: boolean
  applySettingsOnce?: boolean
  settingsPatch?: Record<string, unknown>
}

const KEY = "ABXK_BOT_COMMAND_B64"
const g = globalThis as unknown as { __abxkBotCommand?: BotCommand }

export async function GET() {
  const fromMem = g.__abxkBotCommand
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const b64 = env[KEY]
  if (!b64) return NextResponse.json({ ok: true, data: {} })
  try {
    const json = Buffer.from(b64, "base64").toString("utf8")
    const data = JSON.parse(json) as BotCommand
    g.__abxkBotCommand = normalizeCommand(data)
    return NextResponse.json({ ok: true, data: g.__abxkBotCommand })
  } catch {
    return NextResponse.json({ ok: true, data: {} })
  }
}

export async function POST(req: Request) {
  const patch = (await req.json().catch(() => ({}))) as Partial<BotCommand>
  const current = g.__abxkBotCommand ?? {}
  const merged: BotCommand = normalizeCommand({ ...current, ...patch })
  g.__abxkBotCommand = merged

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const b64 = Buffer.from(JSON.stringify(merged), "utf8").toString("base64")
  const updated = upsertEnv(prev, { [KEY]: b64 })
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true, data: merged })
}

function normalizeCommand(x: unknown): BotCommand {
  const v = (x ?? {}) as any
  const out: BotCommand = {}
  if (typeof v.paused === "boolean") out.paused = v.paused
  if (typeof v.scanNow === "boolean") out.scanNow = v.scanNow
  if (typeof v.reportNow === "boolean") out.reportNow = v.reportNow
  if (typeof v.healthNow === "boolean") out.healthNow = v.healthNow
  if (typeof v.closeNow === "boolean") out.closeNow = v.closeNow
  if (typeof v.emergencyNow === "boolean") out.emergencyNow = v.emergencyNow
  if (typeof v.restartOnce === "boolean") out.restartOnce = v.restartOnce
  if (typeof v.applySettingsOnce === "boolean") out.applySettingsOnce = v.applySettingsOnce
  if (v.settingsPatch && typeof v.settingsPatch === "object") out.settingsPatch = v.settingsPatch as Record<string, unknown>
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
    if (key === KEY) continue
    out.push(line)
  }
  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) out.push(`${k}=${v}`)
  out.push("")
  return out.join("\n")
}

