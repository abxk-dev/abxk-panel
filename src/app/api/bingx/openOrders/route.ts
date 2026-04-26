import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? undefined
  const type = url.searchParams.get("type") ?? undefined

  const data = await envBingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/trade/openOrders",
    params: { symbol, type }
  })

  return NextResponse.json(data)
}

