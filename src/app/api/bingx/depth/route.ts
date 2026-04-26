import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? "BTC-USDT"
  const limit = Number(url.searchParams.get("limit") ?? "20")

  const data = await envBingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/quote/depth",
    params: { symbol, limit }
  })

  return NextResponse.json(data)
}

