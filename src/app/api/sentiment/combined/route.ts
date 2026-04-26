import { NextResponse } from "next/server"
import { getCombinedSentiment } from "@/lib/sentiment"

export const runtime = "nodejs"

export async function GET() {
  try {
    const data = await getCombinedSentiment()
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sentiment fetch failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

