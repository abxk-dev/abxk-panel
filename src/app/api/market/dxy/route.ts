import { NextResponse } from "next/server"

export async function GET() {
  const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=10d&interval=1d", {
    cache: "no-store"
  })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const json = (await res.json()) as any
  const result = json?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  const opens: any[] = Array.isArray(quote?.open) ? quote.open : []
  const closes: any[] = Array.isArray(quote?.close) ? quote.close : []

  const candles: { open: number; close: number }[] = []
  for (let i = 0; i < Math.min(opens.length, closes.length); i += 1) {
    const o = Number(opens[i])
    const c = Number(closes[i])
    if (Number.isFinite(o) && Number.isFinite(c)) candles.push({ open: o, close: c })
  }

  return NextResponse.json({ ok: true, data: { candles: candles.slice(-10) } })
}

