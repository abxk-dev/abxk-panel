import { NextResponse } from "next/server"
import { startHealthCheck, getHealthSummary } from "@/lib/healthCheck"
import { startMarketMonitor, getMarketMonitorSummary } from "@/lib/marketMonitor"

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { settings?: any }
    const g = globalThis as unknown as { __abxkSnapshot?: any }
    if (body?.settings) {
      g.__abxkSnapshot = { ...(g.__abxkSnapshot ?? {}), settings: body.settings }
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  startHealthCheck()
  startMarketMonitor()
  return NextResponse.json({ ok: true, data: { health: getHealthSummary(), monitor: getMarketMonitorSummary() } })
}

