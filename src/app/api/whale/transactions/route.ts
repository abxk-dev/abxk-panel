import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const apiKey = process.env.WHALE_ALERT_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing WHALE_ALERT_API_KEY" }, { status: 400 })

  const url = new URL(req.url)
  const currency = url.searchParams.get("currency") ?? "btc"
  const minValue = url.searchParams.get("min_value") ?? "500000"

  const endpoint = new URL("https://api.whale-alert.io/v1/transactions")
  endpoint.searchParams.set("api_key", apiKey)
  endpoint.searchParams.set("currency", currency)
  endpoint.searchParams.set("min_value", minValue)

  const res = await fetch(endpoint.toString(), { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, data })
}

