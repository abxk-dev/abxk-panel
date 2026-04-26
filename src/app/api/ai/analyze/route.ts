import { NextResponse } from "next/server"
import type { Trade } from "@/types/bot"
import { analyzeTrade } from "@/lib/tradeAnalyzer"

export async function POST(req: Request) {
  const body = (await req.json()) as { trade: Trade; extra?: Record<string, unknown> }
  const res = await analyzeTrade(body.trade, body.extra ?? {})
  return NextResponse.json({ ok: true, ...res })
}

