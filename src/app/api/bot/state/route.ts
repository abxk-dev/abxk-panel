import { NextResponse } from "next/server"

type BotSnapshot = {
  time: number
  equity?: number
  dailyPnlUsd?: number
  level?: number
  levelsDone?: number
  levelsTotal?: number
  symbol?: string
  mode?: string
  todayTrades?: number
  todayMax?: number
  winRate30d?: number
  levelProgressPct?: number
  marketRegime?: string
  openPositions?: { symbol?: string; side?: string }[]
  settings?: {
    symbol?: string
    timeframe?: string
    features?: Record<string, boolean>
    notifications?: Record<string, boolean>
    thresholds?: Record<string, unknown>
    compounding?: { levels?: number; profitTargetPct?: number; riskPctOfBalance?: number }
  }
}

const g = globalThis as unknown as {
  __abxkSnapshot?: BotSnapshot
}

export async function GET() {
  return NextResponse.json({ ok: true, data: g.__abxkSnapshot ?? null })
}

export async function POST(req: Request) {
  const body = (await req.json()) as BotSnapshot
  g.__abxkSnapshot = body
  return NextResponse.json({ ok: true })
}
