import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

type Scalp2Command = {
  closeTradeId?: string
  restartScalping2?: boolean
  resetPaperAccountUsd?: number | null
  updatedAt?: number
}

const KEY = "ABXK_SCALP2_COMMAND_B64"
const g = globalThis as unknown as { __abxkScalp2Command?: Scalp2Command }

export async function GET() {
  const fromMem = g.__abxkScalp2Command
  if (fromMem) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const b64 = env[KEY]
  if (!b64) return NextResponse.json({ ok: true, data: {} })
  try {
    const json = Buffer.from(b64, "base64").toString("utf8")
    const data = JSON.parse(json) as Scalp2Command
    g.__abxkScalp2Command = normalizeCommand(data)
    return NextResponse.json({ ok: true, data: g.__abxkScalp2Command })
  } catch {
    return NextResponse.json({ ok: true, data: {} })
  }
}

export async function POST(req: Request) {
  const patch = (await req.json().catch(() => ({}))) as Partial<Scalp2Command>
  const cur = g.__abxkScalp2Command ?? {}
  const merged = normalizeCommand({ ...cur, ...patch, updatedAt: Date.now() })
  g.__abxkScalp2Command = merged

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const b64 = Buffer.from(JSON.stringify(merged), "utf8").toString("base64")
  const updated = upsertEnv(prev, { [KEY]: b64 })
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true, data: merged })
}

function normalizeCommand(x: unknown): Scalp2Command {
  const v = (x ?? {}) as any
  const out: Scalp2Command = {}
  if (typeof v.closeTradeId === "string") out.closeTradeId = v.closeTradeId
  if (typeof v.restartScalping2 === "boolean") out.restartScalping2 = v.restartScalping2
  if (typeof v.resetPaperAccountUsd === "number" && Number.isFinite(v.resetPaperAccountUsd)) out.resetPaperAccountUsd = v.resetPaperAccountUsd
  if (v.resetPaperAccountUsd === null) out.resetPaperAccountUsd = null
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
