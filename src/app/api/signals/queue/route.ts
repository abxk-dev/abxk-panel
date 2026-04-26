import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

type SignalSource = "NEWS_AI" | "FEAR_GREED" | "TRADINGVIEW" | "WHALE_ALERT" | "MANUAL"
type SignalDirection = "LONG" | "SHORT"

type IncomingSignal = {
  id: string
  createdAt: number
  source: SignalSource
  symbol: string
  direction: SignalDirection
  confidence: number
  reason: string
  executedAt?: number
  skippedAt?: number
  analysis?: string
}

const KEY = "ABXK_SIGNAL_QUEUE_B64"
const g = globalThis as unknown as { __abxkSignalQueue?: IncomingSignal[] }

export async function GET() {
  const fromMem = g.__abxkSignalQueue
  if (Array.isArray(fromMem)) return NextResponse.json({ ok: true, data: fromMem })

  const envPath = path.join(process.cwd(), ".env.local")
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const env = parseEnvText(text)
  const b64 = env[KEY]
  if (!b64) return NextResponse.json({ ok: true, data: [] })
  try {
    const json = Buffer.from(b64, "base64").toString("utf8")
    const arr = JSON.parse(json) as unknown
    const normalized = Array.isArray(arr) ? arr.map(normalizeSignal).filter(Boolean) : []
    g.__abxkSignalQueue = normalized as IncomingSignal[]
    return NextResponse.json({ ok: true, data: g.__abxkSignalQueue })
  } catch {
    return NextResponse.json({ ok: true, data: [] })
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as any
  const incoming = body?.signal ?? body
  const sig = normalizeSignal(incoming)
  if (!sig) return NextResponse.json({ ok: false, error: "Invalid signal" }, { status: 400 })

  const current = Array.isArray(g.__abxkSignalQueue) ? g.__abxkSignalQueue : []
  const next = [sig, ...current].slice(0, 200)
  g.__abxkSignalQueue = next

  const envPath = path.join(process.cwd(), ".env.local")
  const prev = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const b64 = Buffer.from(JSON.stringify(next), "utf8").toString("base64")
  const updated = upsertEnv(prev, { [KEY]: b64 })
  fs.writeFileSync(envPath, updated, "utf8")

  return NextResponse.json({ ok: true, data: next })
}

function normalizeSignal(x: unknown): IncomingSignal | null {
  if (!x || typeof x !== "object") return null
  const v = x as any
  const id = String(v.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`).trim()
  const createdAt = Number(v.createdAt ?? Date.now())
  const source = String(v.source ?? "MANUAL") as SignalSource
  const symbol = String(v.symbol ?? "").trim()
  const direction = (String(v.direction ?? "LONG").toUpperCase() as SignalDirection) === "SHORT" ? "SHORT" : "LONG"
  const confidence = clamp(Number(v.confidence ?? 0), 0, 100)
  const reason = String(v.reason ?? "").trim()
  const executedAt = v.executedAt ? Number(v.executedAt) : undefined
  const skippedAt = v.skippedAt ? Number(v.skippedAt) : undefined
  const analysis = v.analysis ? String(v.analysis) : undefined
  if (!id || !Number.isFinite(createdAt) || !symbol || !reason) return null
  if (!["NEWS_AI", "FEAR_GREED", "TRADINGVIEW", "WHALE_ALERT", "MANUAL"].includes(source)) return null
  return { id, createdAt, source, symbol, direction, confidence, reason, executedAt, skippedAt, analysis }
}

function clamp(v: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
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
    if (key === KEY) continue
    out.push(line)
  }
  if (out.length && out[out.length - 1].trim() !== "") out.push("")
  for (const [k, v] of Object.entries(patch)) out.push(`${k}=${v}`)
  out.push("")
  return out.join("\n")
}

