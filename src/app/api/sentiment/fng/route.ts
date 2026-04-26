import { NextResponse } from "next/server"

export async function GET() {
  const res = await fetch("https://api.alternative.me/fng/?limit=1&format=json", { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, data })
}

