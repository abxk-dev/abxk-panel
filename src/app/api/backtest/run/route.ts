import { NextResponse } from "next/server"
import type { Candle, Settings } from "@/types/bot"
import { envBingxRequest } from "@/app/api/bingx/_utils"
import { runBacktest } from "@/lib/selfLearner"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as any
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const symbol = String(body.symbol ?? "BTC-USDT")
  const timeframe = body.timeframe === "1d" ? "1d" : "4h"
  const startTimeMs = Number(body.startTimeMs ?? 0)
  const endTimeMs = Number(body.endTimeMs ?? Date.now())
  const initialBalance = Number(body.initialBalance ?? 100)
  const riskPercent = Number(body.riskPercent ?? 1)
  const leverage = Number(body.leverage ?? 3)
  const targetScoreThreshold = Number(body.targetScoreThreshold ?? 75)
  const settings = body.settings as Settings | undefined

  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || startTimeMs <= 0 || endTimeMs <= startTimeMs) {
    return NextResponse.json({ ok: false, error: "Invalid start/end time" }, { status: 400 })
  }
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid initialBalance" }, { status: 400 })
  }
  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ ok: false, error: "Missing settings" }, { status: 400 })
  }

  const intervalMs = timeframe === "1d" ? 24 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000

  const candles = await fetchHistoricalKlines({
    symbol,
    interval: timeframe,
    startTimeMs,
    endTimeMs,
    intervalMs
  })

  const result = await runBacktest({
    symbol,
    timeframe,
    startTimeMs,
    endTimeMs,
    initialBalance,
    riskPercent,
    leverage,
    targetScoreThreshold,
    settings,
    filterWeights: body.filterWeights ?? undefined,
    fetchHistoricalKlines: async () => candles
  })

  return NextResponse.json({ ok: true, data: result })
}

async function fetchHistoricalKlines(opts: {
  symbol: string
  interval: "4h" | "1d"
  startTimeMs: number
  endTimeMs: number
  intervalMs: number
}): Promise<Candle[]> {
  const out: Candle[] = []
  const seen = new Set<number>()

  let cursor = opts.startTimeMs
  const maxIters = 60

  for (let iter = 0; iter < maxIters; iter += 1) {
    const data = await envBingxRequest<unknown>({
      method: "GET",
      path: "/openApi/swap/v3/quote/klines",
      params: {
        symbol: opts.symbol,
        interval: opts.interval,
        limit: 1000,
        startTime: cursor,
        endTime: opts.endTimeMs
      }
    })

    const batch = parseKlines(data).filter((c) => c.openTime >= opts.startTimeMs && c.openTime <= opts.endTimeMs)
    if (!batch.length) break

    for (const c of batch) {
      if (seen.has(c.openTime)) continue
      seen.add(c.openTime)
      out.push(c)
    }

    out.sort((a, b) => a.openTime - b.openTime)
    const last = out[out.length - 1]
    if (!last) break
    if (last.openTime >= opts.endTimeMs - opts.intervalMs) break
    const nextCursor = last.openTime + opts.intervalMs
    if (nextCursor <= cursor) break
    cursor = nextCursor
  }

  return out.sort((a, b) => a.openTime - b.openTime)
}

function safeNumber(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x)
  return undefined
}

function parseKlines(raw: unknown): Candle[] {
  const data = raw as any
  const rows: any[] =
    Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : []

  const candles: Candle[] = []
  for (const r of rows) {
    if (Array.isArray(r)) {
      const openTime = safeNumber(r[0])
      const open = safeNumber(r[1])
      const high = safeNumber(r[2])
      const low = safeNumber(r[3])
      const close = safeNumber(r[4])
      const volume = safeNumber(r[5])
      if (
        openTime !== undefined &&
        open !== undefined &&
        high !== undefined &&
        low !== undefined &&
        close !== undefined &&
        volume !== undefined
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    } else if (r && typeof r === "object") {
      const openTime = safeNumber((r as any).time ?? (r as any).openTime)
      const open = safeNumber((r as any).open)
      const high = safeNumber((r as any).high)
      const low = safeNumber((r as any).low)
      const close = safeNumber((r as any).close)
      const volume = safeNumber((r as any).volume)
      if (
        openTime !== undefined &&
        open !== undefined &&
        high !== undefined &&
        low !== undefined &&
        close !== undefined &&
        volume !== undefined
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    }
  }

  return candles.sort((a, b) => a.openTime - b.openTime)
}

