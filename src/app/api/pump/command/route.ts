import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

type PumpCommand = {
  closeTradeId?: string
  restartPump?: boolean
  resetPumpLogs?: boolean
  updatedAt?: number
}

const KEY = "ABXK_PUMP_COMMAND_B64"
const g = globalThis as unknown as { __abxkPumpCommand?: PumpCommand }

export async function GET() {
  const fromMem = g.__abxkPumpCommand
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const b64 = env[KEY]
  if (!b64) return NextResponse.json({ ok: true, data: {} })
  try {
    const json = Buffer.from(b64, "base64").toString("utf8")
    const data = JSON.parse(json) as PumpCommand
    g.__abxkPumpCommand = normalizeCommand(data)
    return NextResponse.json({ ok: true, data: g.__abxkPumpCommand })
  } catch {
    return NextResponse.json({ ok: true, data: {} })
  }
}

export async function POST(req: Request) {
  const patch = (await req.json().catch(() => ({}))) as Partial<PumpCommand>
  const cur = g.__abxkPumpCommand ?? {}
  const merged = normalizeCommand({ ...cur, ...patch, updatedAt: Date.now() })
  g.__abxkPumpCommand = merged

  if (merged.resetPumpLogs) {
    const now = Date.now()
    const pumpPath = path.join(process.cwd(), "pump-state.json")
    const pump2Path = path.join(process.cwd(), "pump2-state.json")
    const emptyPump = {
      ok: true,
      data: {
        updatedAt: now,
        settings: null,
        recentPumps: [],
        openTrades: [],
        closedTrades: [],
        history: [],
        stats: { pumpsDetected: 0, traded: 0, wins: 0, losses: 0, winRate: 0, todayPnl: 0 }
      }
    }
    const emptyPump2 = {
      ok: true,
      data: {
        updatedAt: now,
        settings: null,
        pairsCount: 0,
        lastCheckAt: null,
        alerts: []
      }
    }
    try {
      fs.writeFileSync(pumpPath, JSON.stringify(emptyPump, null, 2), "utf8")
    } catch {}
    try {
      fs.writeFileSync(pump2Path, JSON.stringify(emptyPump2, null, 2), "utf8")
    } catch {}
  }

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const b64 = Buffer.from(JSON.stringify(merged), "utf8").toString("base64")
  const updated = upsertEnv(prev, { [KEY]: b64 })
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true, data: merged })
}

function normalizeCommand(x: unknown): PumpCommand {
  const v = (x ?? {}) as any
  const out: PumpCommand = {}
  if (typeof v.closeTradeId === "string") out.closeTradeId = v.closeTradeId
  if (typeof v.restartPump === "boolean") out.restartPump = v.restartPump
  if (typeof v.resetPumpLogs === "boolean") out.resetPumpLogs = v.resetPumpLogs
  if (typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt)) out.updatedAt = v.updatedAt
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
