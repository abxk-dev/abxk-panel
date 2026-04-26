import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const apiKey = process.env.COINGLASS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing COINGLASS_API_KEY" }, { status: 400 })
  }

  const url = new URL(req.url)
  const exchange = url.searchParams.get("exchange") ?? "Binance"
  const symbol = url.searchParams.get("symbol") ?? "BTCUSDT"
  const range = url.searchParams.get("range") ?? "24h"

  const endpoint = new URL("https://open-api-v4.coinglass.com/api/futures/liquidation/heatmap/model1")
  endpoint.searchParams.set("exchange", exchange)
  endpoint.searchParams.set("symbol", symbol)
  endpoint.searchParams.set("range", range)

  const res = await fetch(endpoint.toString(), {
    headers: { "CG-API-KEY": apiKey, Accept: "application/json" },
    cache: "no-store"
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({ ok: true, data })
}

