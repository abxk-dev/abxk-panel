import { NextResponse } from "next/server"
import { sendTelegram } from "@/lib/telegram"

type TelegramUpdate = {
  message?: {
    message_id?: number
    from?: { id?: number; username?: string }
    chat?: { id?: number; type?: string; username?: string; title?: string }
    text?: string
    date?: number
  }
}

type PendingConfirm = {
  chatId: string
  action: "close" | "emergency"
  createdAt: number
}

const g = globalThis as unknown as {
  __abxkTelegramPendingConfirm?: PendingConfirm
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

function parseChatId(v: unknown): string | undefined {
  const s = String(v ?? "").trim()
  return s ? s : undefined
}

function isAuthorizedChat(updateChatId: string | undefined): boolean {
  const configured = parseChatId(process.env.TELEGRAM_CHAT_ID)
  if (!configured) return true
  if (!updateChatId) return false
  return configured === updateChatId
}

async function setCommand(req: Request, patch: Record<string, unknown>) {
  await fetch(new URL("/api/bot/command", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  }).catch(() => undefined)
}

async function setScalping3Command(req: Request, patch: Record<string, unknown>) {
  await fetch(new URL("/api/scalping3/command", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  }).catch(() => undefined)
}

function consumePendingConfirm(chatId: string): PendingConfirm | undefined {
  const cur = g.__abxkTelegramPendingConfirm
  if (!cur) return undefined
  if (cur.chatId !== chatId) return undefined
  if (Date.now() - cur.createdAt > 2 * 60_000) {
    g.__abxkTelegramPendingConfirm = undefined
    return undefined
  }
  g.__abxkTelegramPendingConfirm = undefined
  return cur
}

function setPendingConfirm(chatId: string, action: PendingConfirm["action"]) {
  g.__abxkTelegramPendingConfirm = { chatId, action, createdAt: Date.now() }
}

function formatMode(mode: string | undefined): "PAPER" | "LIVE" | "MIRROR" {
  const m = String(mode ?? "paper").toLowerCase()
  if (m === "live") return "LIVE"
  if (m === "mirror") return "MIRROR"
  return "PAPER"
}

function toNumber(x: string): number | undefined {
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}

async function getSnapshot(req: Request): Promise<any | null> {
  const snapRes = await fetch(new URL("/api/bot/state", req.url), { cache: "no-store" }).catch(() => null)
  if (!snapRes) return null
  const snapJson = (await snapRes.json().catch(() => null)) as any
  return snapJson?.data ?? null
}

export async function POST(req: Request) {
  const update = (await req.json().catch(() => ({}))) as TelegramUpdate
  const chatId = update.message?.chat?.id !== undefined ? String(update.message.chat.id) : undefined
  if (!isAuthorizedChat(chatId)) return NextResponse.json({ ok: true })

  const rawText = typeof update.message?.text === "string" ? update.message.text : ""
  const text = normalizeText(rawText)
  if (!text) return NextResponse.json({ ok: true })

  if (text === "/confirm") {
    const pending = chatId ? consumePendingConfirm(chatId) : undefined
    if (!pending) {
      await sendTelegram("No pending action to confirm.")
      return NextResponse.json({ ok: true })
    }
    if (pending.action === "close") {
      await setCommand(req, { closeNow: true })
      await sendTelegram("✅ Closing open position(s) now.")
      return NextResponse.json({ ok: true })
    }
    await setCommand(req, { emergencyNow: true, paused: true })
    await sendTelegram("🚨 Emergency action confirmed. Closing all positions and pausing bot.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/pause") {
    await setCommand(req, { paused: true })
    await sendTelegram("⏸ Bot PAUSED. Reply /resume to continue.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/resume") {
    await setCommand(req, { paused: false })
    await sendTelegram("▶ Bot RESUMING.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/skip") {
    await setCommand(req, { skipOnce: true })
    await sendTelegram("⏭ Next trade will be skipped.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/skip_s3") {
    await setScalping3Command(req, { skipOnce: true })
    await sendTelegram("⏭ Next Scalping 3 trade will be skipped.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/scan") {
    await setCommand(req, { scanNow: true })
    await sendTelegram("📡 Manual scan triggered.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/report") {
    await setCommand(req, { reportNow: true })
    await sendTelegram("📊 Sending daily report now.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/health") {
    await setCommand(req, { healthNow: true })
    await sendTelegram("🩺 Fetching health status now.")
    return NextResponse.json({ ok: true })
  }

  if (text === "/status") {
    const s = await getSnapshot(req)
    if (!s) {
      await sendTelegram("⚠️ No status available yet.")
      return NextResponse.json({ ok: true })
    }
    const openPositions: any[] = Array.isArray(s.openPositions) ? s.openPositions : []
    const openLines = openPositions.length
      ? `Open: ${openPositions.map((p) => `${String(p.symbol ?? "").replace("-", "/")} ${p.side ?? p.direction ?? ""}`.trim()).join(", ")}`
      : "Open: None"
    const msg = `📊 <b>STATUS</b>
━━━━━━━━━━━━━━
Mode: ${formatMode(s.mode)}
Level: ${s.level ?? "—"}/${s.levelsTotal ?? "—"} | Equity: $${Number(s.equity ?? 0).toFixed(2)}
Regime: ${String(s.marketRegime ?? "—")}
${openLines}`
    await sendTelegram(msg)
    return NextResponse.json({ ok: true })
  }

  if (text === "/level") {
    const s = await getSnapshot(req)
    if (!s) {
      await sendTelegram("⚠️ No level data available yet.")
      return NextResponse.json({ ok: true })
    }
    const msg = `🎯 <b>LEVEL PROGRESS</b>
━━━━━━━━━━━━━━
Level: ${s.level ?? "—"}/${s.levelsTotal ?? "—"}
Progress: ${s.levelProgressPct ?? "—"}% to next
Equity: $${Number(s.equity ?? 0).toFixed(2)}`
    await sendTelegram(msg)
    return NextResponse.json({ ok: true })
  }

  if (text === "/close") {
    if (chatId) setPendingConfirm(chatId, "close")
    await sendTelegram('Are you sure you want to close the open position? Reply "/confirm" to proceed.')
    return NextResponse.json({ ok: true })
  }

  if (text === "/emergency") {
    if (chatId) setPendingConfirm(chatId, "emergency")
    await sendTelegram('🚨 Are you sure? This will close ALL positions and pause the bot. Reply "/confirm" to proceed.')
    return NextResponse.json({ ok: true })
  }

  const parts = text.split(" ")
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ").trim()

  if (cmd === "/setlev") {
    const lev = toNumber(arg)
    if (!lev || lev <= 0) {
      await sendTelegram("Usage: /setlev 10")
      return NextResponse.json({ ok: true })
    }
    await setCommand(req, { settingsPatch: { risk: { leverage: Math.round(lev) } }, applySettingsOnce: true })
    await sendTelegram(`⚡ Leverage updated to ${Math.round(lev)}x.`)
    return NextResponse.json({ ok: true })
  }

  if (cmd === "/risk") {
    const riskPct = toNumber(arg)
    if (riskPct === undefined || riskPct <= 0) {
      await sendTelegram("Usage: /risk 1.5")
      return NextResponse.json({ ok: true })
    }
    await setCommand(req, {
      settingsPatch: { compounding: { riskPctOfBalance: riskPct } },
      applySettingsOnce: true
    })
    await sendTelegram(`💵 Risk updated to ${riskPct}% of balance.`)
    return NextResponse.json({ ok: true })
  }

  if (cmd === "/mode") {
    const m = arg.toLowerCase()
    if (m !== "paper" && m !== "live" && m !== "mirror") {
      await sendTelegram("Usage: /mode paper | /mode live | /mode mirror")
      return NextResponse.json({ ok: true })
    }
    await setCommand(req, { settingsPatch: { mode: m }, applySettingsOnce: true })
    await sendTelegram(`🔁 Mode switched to ${m.toUpperCase()}.`)
    return NextResponse.json({ ok: true })
  }

  await sendTelegram(
    "Commands: /status /pause /resume /skip /close /emergency /report /level /scan /health /setlev <n> /risk <pct> /mode <paper|live|mirror>"
  )
  return NextResponse.json({ ok: true })
}
