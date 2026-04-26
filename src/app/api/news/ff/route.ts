import { NextResponse } from "next/server"

export async function GET() {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, data })
}

