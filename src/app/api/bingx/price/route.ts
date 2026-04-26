import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? "BTC-USDT"

  try {
    const data = await fetchPublicPrice(symbol)
    return NextResponse.json(data)
  } catch (e1) {
    try {
      const data = await envBingxRequest<unknown>({
        method: "GET",
        path: "/openApi/swap/v2/quote/price",
        params: { symbol }
      })
      return NextResponse.json(data)
    } catch {
      const data = await envBingxRequest<unknown>({
        method: "GET",
        path: "/openApi/swap/v1/ticker/price",
        params: { symbol }
      })
      return NextResponse.json(data)
    }
  }
}

async function fetchPublicPrice(symbol: string): Promise<{ code: number; msg: string; data: { symbol: string; price: string } }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
      cache: "no-store"
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)

    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Non-JSON response: ${text}`)
    }

    const price = parseFloat(json?.data?.price ?? "0")
    if (!price || price === 0 || Number.isNaN(price)) {
      throw new Error(`Invalid price for ${symbol}: ${String(json?.data?.price ?? "")}`)
    }

    return { code: 0, msg: "", data: { symbol, price: String(price) } }
  } finally {
    clearTimeout(timeout)
  }
}
