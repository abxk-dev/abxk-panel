import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  const res = await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/contracts", { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, data })
}
