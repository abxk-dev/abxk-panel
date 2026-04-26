import { NextResponse } from "next/server"
import { getHealthSummary, refreshHealthNow } from "@/lib/healthCheck"
import { getMarketMonitorSummary } from "@/lib/marketMonitor"

export async function GET(req: Request) {
  const g = globalThis as unknown as { __abxkSnapshot?: any }
  const url = new URL(req.url)
  const refresh = url.searchParams.get("refresh") === "1"
  const health = refresh ? await refreshHealthNow().catch(() => getHealthSummary()) : getHealthSummary()
  return NextResponse.json({
    ok: true,
    data: {
      health,
      monitor: getMarketMonitorSummary(),
      snapshot: g.__abxkSnapshot ?? null
    }
  })
}
