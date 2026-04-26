import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"

export async function GET() {
  const data = await envBingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/user/balance"
  })
  return NextResponse.json(data)
}

