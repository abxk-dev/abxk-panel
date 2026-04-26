import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? "BTC-USDT"

  const data = await envBingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/quote/bookTicker",
    params: { symbol }
  })

  return NextResponse.json(data)
}

