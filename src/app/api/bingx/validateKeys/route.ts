import { NextResponse } from "next/server"
import { bingxRequest } from "@/lib/bingx"

export async function POST(req: Request) {
  const body = (await req.json()) as { apiKey: string; secretKey: string }

  const data = await bingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/user/balance",
    apiKey: body.apiKey,
    secretKey: body.secretKey
  })

  return NextResponse.json({ ok: true, data })
}

