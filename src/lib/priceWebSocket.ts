import WebSocket from "ws"
import zlib from "zlib"

export type PriceFeedStatus = {
  connected: boolean
  lastMessageAt?: number
  symbols: string[]
  updatedAt: number
}

type Runtime = {
  ws?: WebSocket
  connected: boolean
  lastMessageAt?: number
  symbols: string[]
  prices: Record<string, number>
  started: boolean
  retries: number
}

const g = globalThis as unknown as { __abxkPrices?: Runtime }

function runtime(): Runtime {
  if (g.__abxkPrices) return g.__abxkPrices
  const r: Runtime = { connected: false, symbols: [], prices: {}, started: false, retries: 0 }
  g.__abxkPrices = r
  return r
}

export function startPriceWebSocket(symbols: string[]) {
  const r = runtime()
  r.symbols = symbols
  if (r.started) return
  r.started = true
  connect()
}

export function stopPriceWebSocket() {
  const r = runtime()
  r.started = false
  r.connected = false
  try {
    r.ws?.close()
  } catch {
    return
  }
}

export function getLatestPrice(symbol: string): number | undefined {
  return runtime().prices[symbol.toUpperCase()]
}

export function getAllLatestPrices(): Record<string, number> {
  return { ...runtime().prices }
}

export function getPriceFeedStatus(): PriceFeedStatus {
  const r = runtime()
  return { connected: r.connected, lastMessageAt: r.lastMessageAt, symbols: [...r.symbols], updatedAt: Date.now() }
}

function connect() {
  const r = runtime()
  try {
    r.ws?.close()
  } catch {
    return
  }

  const ws = new WebSocket("wss://open-api-ws.bingx.com/market")
  r.ws = ws

  ws.on("open", () => {
    r.connected = true
    r.retries = 0
    for (const symbol of r.symbols) {
      ws.send(JSON.stringify({ id: `prices-${symbol}-${Date.now()}`, reqType: "sub", dataType: `${symbol}@ticker` }))
    }
  })

  ws.on("message", (data) => {
    const text = decodeWsPayload(data)
    if (!text) return
    r.lastMessageAt = Date.now()
    if (text === "Ping") {
      ws.send("Pong")
      return
    }
    const price = extractPrice(text)
    const sym = extractSymbol(text)
    if (sym && typeof price === "number" && Number.isFinite(price) && price > 0) {
      r.prices[sym.toUpperCase()] = price
    }
  })

  const retry = () => {
    r.connected = false
    r.retries = Math.min(12, r.retries + 1)
    const delay = Math.min(30_000, 1500 * r.retries)
    if (r.started) setTimeout(connect, delay)
  }

  ws.on("close", retry)
  ws.on("error", retry)
}

function decodeWsPayload(data: WebSocket.RawData): string {
  try {
    const buf =
      typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.isBuffer(data) ? data : Buffer.from(data as any)
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString("utf8")
    return buf.toString("utf8")
  } catch {
    return ""
  }
}

function extractPrice(text: string): number | undefined {
  try {
    const msg = JSON.parse(text) as any
    const row = msg?.data ?? msg?.tick ?? msg
    const p = Number(row?.lastPrice ?? row?.last ?? row?.price ?? row?.c ?? row?.close ?? row?.markPrice)
    return Number.isFinite(p) ? p : undefined
  } catch {
    return undefined
  }
}

function extractSymbol(text: string): string | undefined {
  try {
    const msg = JSON.parse(text) as any
    const sym = String(msg?.symbol ?? msg?.dataType?.split?.("@")?.[0] ?? msg?.data?.symbol ?? msg?.tick?.symbol ?? "")
    if (sym) return sym.toUpperCase()
    return undefined
  } catch {
    return undefined
  }
}

