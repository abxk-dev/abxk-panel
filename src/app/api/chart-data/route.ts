import { NextRequest } from "next/server"
import { envBingxRequest } from "../bingx/_utils"

export const runtime = "nodejs"

type RawKline = { time: number; open: string; high: string; low: string; close: string; volume: string }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get("symbol") || "BTC-USDT"
  const interval = (searchParams.get("interval") || "4h").toLowerCase()
  const limit = Number(searchParams.get("limit") || "100")

  try {
    const data = await envBingxRequest<any>({
      method: "GET",
      path: "/openApi/swap/v3/quote/klines",
      params: { symbol, interval, limit }
    })

    const rows: RawKline[] = Array.isArray(data?.data) ? data.data : []
    if (!rows.length) return Response.json({ candles: [], ema20: [], ema50: [] })

    const candles = rows
      .map((k) => ({
        time: Number(k.time),
        open: parseFloat(String(k.open)),
        high: parseFloat(String(k.high)),
        low: parseFloat(String(k.low)),
        close: parseFloat(String(k.close)),
        volume: parseFloat(String(k.volume))
      }))
      .filter((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite))
      .sort((a, b) => a.time - b.time)

    const ema20 = calcEMA(candles, 20)
    const ema50 = calcEMA(candles, 50)

    return Response.json({ candles, ema20, ema50 })
  } catch {
    return Response.json({ candles: [], ema20: [], ema50: [] })
  }
}

function calcEMA(candles: { time: number; close: number }[], period: number): { time: number; value: number }[] {
  const k = 2 / (period + 1)
  let ema = candles[0]?.close ?? 0
  const out: { time: number; value: number }[] = []
  for (const c of candles) {
    ema = c.close * k + ema * (1 - k)
    out.push({ time: c.time, value: Number(ema.toFixed(2)) })
  }
  return out
}

