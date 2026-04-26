import { NextResponse } from "next/server"

export async function GET() {
  const start = Date.now()
  const res = await fetch("https://open-api.bingx.com/openApi/swap/v2/server/time", { cache: "no-store" })
  const latencyMs = Date.now() - start
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, latencyMs, error: text }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, latencyMs, data })
}

