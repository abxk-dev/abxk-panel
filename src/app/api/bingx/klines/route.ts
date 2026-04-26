import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? "BTC-USDT"
  const interval = (url.searchParams.get("interval") ?? "4h").toLowerCase()
  const limit = Number(url.searchParams.get("limit") ?? "300")

  const endpoint = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  endpoint.searchParams.set("symbol", symbol)
  endpoint.searchParams.set("interval", interval)
  endpoint.searchParams.set("limit", String(limit))

  try {
    const res = await fetch(endpoint.toString(), { cache: "no-store" })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ ok: false, error: text }, { status: 502 })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch klines"
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
