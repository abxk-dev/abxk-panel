import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const url = new URL("/api/bot/command", req.url)
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanNow: true })
  }).catch(() => undefined)
  return NextResponse.json({ ok: true })
}

