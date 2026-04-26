import { NextResponse } from "next/server"
import { sendTelegram, sendTelegramDocument, sendTelegramPhoto } from "@/lib/telegram"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = (await req.json()) as {
    message: string
    imageBase64?: string
    documentBase64?: string
    filename?: string
    mimeType?: string
  }
  if (body.documentBase64 && body.documentBase64.trim()) {
    await sendTelegramDocument({
      caption: body.message,
      base64: body.documentBase64,
      filename: body.filename ?? "report.pdf",
      mimeType: body.mimeType
    })
  } else if (body.imageBase64 && body.imageBase64.trim()) {
    await sendTelegramPhoto({ caption: body.message, base64Png: body.imageBase64 })
  } else {
    await sendTelegram(body.message)
  }
  return NextResponse.json({ ok: true })
}
