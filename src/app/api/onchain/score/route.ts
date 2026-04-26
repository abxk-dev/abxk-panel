import { NextResponse } from "next/server"
import { getOnChainScore } from "@/lib/onChain"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? "BTC"
  try {
    const data = await getOnChainScore(symbol)
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "On-chain fetch failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

