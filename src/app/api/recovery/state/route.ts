import { NextResponse } from "next/server"
import { loadState, recoverFromCrash } from "@/lib/disasterRecovery"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const verify = url.searchParams.get("verify") === "1"
  try {
    if (verify) {
      const res = await recoverFromCrash()
      return NextResponse.json({ ok: true, data: res })
    }
    const state = await loadState()
    return NextResponse.json({ ok: true, data: state })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Recovery read failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

