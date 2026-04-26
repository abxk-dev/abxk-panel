import { NextResponse } from "next/server"

export const runtime = "nodejs"

type ChatMessage = { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  try {
    const key = process.env.GEMINI_API_KEY
    if (!key) return NextResponse.json({ ok: false, error: "Missing GEMINI_API_KEY" }, { status: 500 })

    const body = (await req.json()) as { message?: string; systemPrompt?: string; history?: ChatMessage[] }
    const message = String(body?.message ?? "").trim()
    if (!message) return NextResponse.json({ ok: false, error: "Missing message" }, { status: 400 })

    const systemPrompt = String(body?.systemPrompt ?? "").trim()
    const history = Array.isArray(body?.history) ? body.history : []

    const contents = history
      .slice(-12)
      .map((m) => {
        const role = m?.role === "assistant" ? "model" : "user"
        const text = String(m?.content ?? "")
        return { role, parts: [{ text }] }
      })
      .filter((x) => String(x?.parts?.[0]?.text ?? "").trim().length > 0)

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: [...contents, { role: "user", parts: [{ text: message }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
      })
    })

    const text = await res.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return NextResponse.json({ ok: false, error: `Gemini non-JSON response (${res.status})` }, { status: 502 })
    }
    if (!res.ok) {
      const err = typeof data?.error?.message === "string" ? data.error.message : `Gemini error (${res.status})`
      return NextResponse.json({ ok: false, error: err }, { status: 502 })
    }

    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof out !== "string" || !out.trim()) return NextResponse.json({ ok: false, error: "Empty Gemini response" }, { status: 502 })
    return NextResponse.json({ ok: true, data: { text: out.trim() } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

