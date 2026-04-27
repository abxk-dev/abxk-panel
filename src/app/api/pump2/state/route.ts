import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

let lastGoodData: any | null = null

export async function GET() {
  const filePath = path.join(process.cwd(), "pump2-state.json")
  try {
    if (!fs.existsSync(filePath)) {
      const empty = {
        updatedAt: Date.now(),
        settings: null,
        pairsCount: 0,
        lastCheckAt: null,
        alerts: []
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
    const msg = e instanceof Error ? e.message : "Failed to read pump2 state"
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
          pairsCount: 0,
          lastCheckAt: null,
          alerts: []
        }
      },
      { status: 200 }
    )
  }
}
