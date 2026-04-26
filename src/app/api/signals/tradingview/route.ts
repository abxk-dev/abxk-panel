import { NextResponse } from "next/server"

export const runtime = "nodejs"

function normalizeSymbol(raw: string): string {
  const s = String(raw ?? "").trim().toUpperCase()
  if (!s) return ""
  if (s.includes("-")) return s
  if (s.endsWith("USDT") && s.length > 4) return `${s.slice(0, -4)}-USDT`
  return s
}

function clamp(v: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

export async function POST(req: Request) {
  const secret = process.env.TRADINGVIEW_WEBHOOK_SECRET
  if (secret) {
    const provided = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret") ?? ""
    if (provided !== secret) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as any
  const symbol = normalizeSymbol(String(body?.symbol ?? body?.ticker ?? body?.pair ?? ""))
  const sideRaw = String(body?.side ?? body?.direction ?? body?.action ?? "").toUpperCase()
  const direction = sideRaw.includes("SHORT") || sideRaw === "SELL" ? "SHORT" : "LONG"
  const confidence = clamp(Number(body?.confidence ?? body?.conf ?? 80), 0, 100)
  const reason = String(body?.reason ?? body?.message ?? body?.comment ?? "TradingView webhook").trim()
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 })

  const signal = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    source: "TRADINGVIEW" as const,
    symbol,
    direction,
    confidence,
    reason
  }

  const url = new URL("/api/signals/queue", req.url)
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal })
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, data: signal })
}

