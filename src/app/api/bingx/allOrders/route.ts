import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = url.searchParams.get("symbol") ?? undefined
  const limit = Number(url.searchParams.get("limit") ?? "100")
  const startTime = url.searchParams.get("startTime")
  const endTime = url.searchParams.get("endTime")

  const data = await envBingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/trade/allOrders",
    params: {
      symbol,
      limit,
      startTime: startTime ? Number(startTime) : undefined,
      endTime: endTime ? Number(endTime) : undefined
    }
  })

  return NextResponse.json(data)
}

