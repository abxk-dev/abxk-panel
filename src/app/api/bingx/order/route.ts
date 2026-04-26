import { NextResponse } from "next/server"
import { envBingxRequest } from "../_utils"
import { recordOrderAttempt } from "@/lib/healthCheck"

type TpSlPayload = {
  type: string
  stopPrice: number
  price?: number
  quantity?: number
  workingType?: "MARK_PRICE" | "CONTRACT_PRICE" | "INDEX_PRICE"
}

function stringifyTpSl(payload: TpSlPayload | undefined): string | undefined {
  if (!payload) return undefined
  return JSON.stringify(payload)
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    symbol: string
    tradeSide: "LONG" | "SHORT"
    orderType: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET"
    quantity: number
    leverage?: number
    price?: number
    stopPrice?: number
    reduceOnly?: boolean
    intent?: "OPEN" | "CLOSE"
    stopLoss?: TpSlPayload
    takeProfit?: TpSlPayload
    workingType?: "MARK_PRICE" | "CONTRACT_PRICE" | "INDEX_PRICE"
    clientOrderId?: string
  }

  const symbol = body.symbol
  const positionSide = body.tradeSide
  const openSide = body.tradeSide === "LONG" ? "BUY" : "SELL"
  const closeSide = body.tradeSide === "LONG" ? "SELL" : "BUY"
  const side = body.intent === "CLOSE" ? closeSide : openSide

  const place = async (reduceOnly?: boolean) => {
    const params: Record<string, string | number | boolean | undefined> = {
      symbol,
      type: body.orderType,
      side,
      positionSide,
      quantity: body.quantity,
      price: body.orderType === "LIMIT" ? body.price : undefined,
      stopPrice: body.stopPrice,
      reduceOnly: reduceOnly ? "true" : undefined,
      stopLoss: stringifyTpSl(body.stopLoss),
      takeProfit: stringifyTpSl(body.takeProfit),
      workingType: body.workingType,
      clientOrderId: body.clientOrderId
    }

    return envBingxRequest<unknown>({
      method: "POST",
      path: "/openApi/swap/v2/trade/order",
      params
    })
  }

  try {
    const lev = Number(body.leverage)
    if (Number.isFinite(lev) && lev > 0) {
      await setLeverageForSymbol({ symbol, positionSide, leverage: lev })
    }
    const data = await place(Boolean(body.reduceOnly))
    recordOrderAttempt(true)
    return NextResponse.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Order failed"
    const isClose = body.intent === "CLOSE"
    const requestedReduceOnly = body.reduceOnly === true
    const hedgeReduceOnlyError =
      msg.includes("code=109400") || msg.toLowerCase().includes("hedge mode") || msg.toLowerCase().includes("reduceonly")

    if (isClose && requestedReduceOnly && hedgeReduceOnlyError) {
      try {
        const data = await place(false)
        recordOrderAttempt(true)
        return NextResponse.json(data)
      } catch (e2) {
        recordOrderAttempt(false)
        const msg2 = e2 instanceof Error ? e2.message : "Order failed"
        return NextResponse.json({ ok: false, error: msg2 }, { status: 502 })
      }
    }

    recordOrderAttempt(false)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json()) as { symbol: string; orderId?: number; clientOrderId?: string }

  try {
    const data = await envBingxRequest<unknown>({
      method: "DELETE",
      path: "/openApi/swap/v2/trade/order",
      params: {
        symbol: body.symbol,
        orderId: body.orderId,
        clientOrderId: body.clientOrderId
      }
    })
    recordOrderAttempt(true)
    return NextResponse.json(data)
  } catch (e) {
    recordOrderAttempt(false)
    const msg = e instanceof Error ? e.message : "Cancel failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}

async function setLeverageForSymbol(opts: { symbol: string; positionSide: "LONG" | "SHORT"; leverage: number }) {
  const trySet = async (side: "LONG" | "SHORT" | "BOTH") => {
    return envBingxRequest<unknown>({
      method: "POST",
      path: "/openApi/swap/v2/trade/leverage",
      params: {
        symbol: opts.symbol,
        leverage: Math.floor(opts.leverage),
        side
      }
    })
  }

  try {
    await trySet(opts.positionSide)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    const oneWayError = msg.includes("PositionSide") || msg.toLowerCase().includes("one-way") || msg.toLowerCase().includes("one way")
    if (!oneWayError) throw e
    await trySet("BOTH")
  }
}
