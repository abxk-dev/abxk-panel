import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "scalp3-state.json")
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({
        ok: true,
        data: {
          updatedAt: Date.now(),
          openTrades: [],
          stats: { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 }
        }
      })
    }

    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw)
    const normalized = data?.data ?? data
    return NextResponse.json({ ok: true, data: normalized })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read scalp3 state"
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        data: {
          updatedAt: Date.now(),
          openTrades: [],
          stats: { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 }
        }
      },
      { status: 200 }
    )
  }
}
