import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  const filePath = path.join(process.cwd(), "scalp2-state.json")
  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({
        ok: true,
        data: {
          updatedAt: Date.now(),
          openTrades: [],
          stats: { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 },
          leaderboard: []
        }
      })
    }
    const raw = fs.readFileSync(filePath, "utf8")
    const json = JSON.parse(raw) as any
    const data = json?.data ?? json
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read scalp2 state"
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        data: {
          updatedAt: Date.now(),
          openTrades: [],
          stats: { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 },
          leaderboard: []
        }
      },
      { status: 200 }
    )
  }
}
