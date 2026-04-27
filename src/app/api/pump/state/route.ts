import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

let lastGoodData: any | null = null

export async function GET() {
  const filePath = path.join(process.cwd(), "pump-state.json")
  try {
    if (!fs.existsSync(filePath)) {
      const empty = {
        updatedAt: Date.now(),
        settings: null,
        recentPumps: [],
        openTrades: [],
        closedTrades: [],
        history: [],
        stats: { pumpsDetected: 0, traded: 0, wins: 0, losses: 0, winRate: 0, todayPnl: 0 }
      }
      lastGoodData = empty
      return NextResponse.json({ ok: true, data: empty })
    }
    const raw = fs.readFileSync(filePath, "utf8")
    const json = JSON.parse(raw) as any
    const data = json?.data ?? json
    lastGoodData = data
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read pump state"
    if (lastGoodData) {
      return NextResponse.json({ ok: false, error: msg, data: lastGoodData }, { status: 200 })
    }
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        data: {
          updatedAt: Date.now(),
          settings: null,
          recentPumps: [],
          openTrades: [],
          closedTrades: [],
          history: [],
          stats: { pumpsDetected: 0, traded: 0, wins: 0, losses: 0, winRate: 0, todayPnl: 0 }
        }
      },
      { status: 200 }
    )
  }
}
