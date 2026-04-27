function telegramApiBase(token: string) {
  return `https://api.telegram.org/bot${token}`
}

export async function sendTelegram(message: string, parseMode: "HTML" | "MarkdownV2" | "Markdown" = "HTML") {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID")
  }

  const res = await fetch(`${telegramApiBase(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: parseMode
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram sendMessage failed: ${res.status} ${text}`)
  }
}

export async function sendTelegramPhoto(opts: { caption: string; base64Png: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID")
  }

  const bytes = Buffer.from(opts.base64Png, "base64")
  const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" })
  const form = new FormData()
  form.set("chat_id", chatId)
  form.set("caption", opts.caption)
  form.set("parse_mode", "HTML")
  form.set("photo", blob, "chart.png")

  const res = await fetch(`${telegramApiBase(token)}/sendPhoto`, { method: "POST", body: form as any })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${text}`)
  }
}

export async function sendTelegramDocument(opts: { caption: string; base64: string; filename: string; mimeType?: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID")
  }

  const bytes = Buffer.from(opts.base64, "base64")
  const blob = new Blob([Uint8Array.from(bytes)], { type: opts.mimeType ?? "application/octet-stream" })
  const form = new FormData()
  form.set("chat_id", chatId)
  form.set("caption", opts.caption)
  form.set("parse_mode", "HTML")
  form.set("document", blob, opts.filename || "report.pdf")

  const res = await fetch(`${telegramApiBase(token)}/sendDocument`, { method: "POST", body: form as any })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram sendDocument failed: ${res.status} ${text}`)
  }
}
