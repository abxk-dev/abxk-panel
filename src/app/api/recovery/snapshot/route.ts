import { NextResponse } from "next/server"
import { saveState, type RecoveryBotState } from "@/lib/disasterRecovery"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RecoveryBotState
    const g = globalThis as unknown as { __abxkRecovery?: RecoveryBotState }
    g.__abxkRecovery = body
    await saveState(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Snapshot save failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

