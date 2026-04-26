import { NextResponse } from "next/server"
import { computeNewsStatus, fetchForexFactoryWeek } from "@/lib/newsFilter"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const blackoutMinutes = Number(url.searchParams.get("blackoutMinutes") ?? "30")
  const currenciesParam = url.searchParams.get("currencies") ?? "USD"
  const currencies = currenciesParam
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)

  const now = Date.now()
  const raw = await fetchForexFactoryWeek()
  const status = computeNewsStatus({
    eventsRaw: raw,
    now,
    blackoutMinutes: Number.isFinite(blackoutMinutes) ? blackoutMinutes : 30,
    currencies,
    impact: "High"
  })

  return NextResponse.json({ ok: true, data: status })
}

