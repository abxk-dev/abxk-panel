import { promises as fs } from "fs"
import path from "path"
import type { Settings, Trade } from "@/types/bot"
import { sendTelegram } from "@/lib/telegram"

export type BotStatus = "RUNNING" | "PAUSED" | "STOPPED"

export type OpenPosition = {
  orderId: string
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  size: number
  leverage: number
  stopLoss: number
  takeProfit: number
  trailingStop: boolean
  trailingDistance: number
  openTime: number
  partialProfitLocked: number
  slOrderId?: string
  tpOrderId?: string
  peakPrice: number
}

export type PendingOrder = {
  id: string
  symbol: string
  direction: "LONG" | "SHORT"
  timeframe: string
  createdAt: number
  enterAtCandleOpenTime?: number
}

export type RecoveryBotState = {
  timestamp: number
  version: string
  botStatus: BotStatus
  currentLevel: number
  equity: number
  startingEquity: number
  openPositions: OpenPosition[]
  pendingOrders: PendingOrder[]
  dailyTradeCount: number
  dailyPnl: number
  consecutiveLosses: number
  consecutiveWins: number
  lastTradeId: string
  lastCandleProcessed: number
  activeFilters: string[]
  currentRegime: string
  settings: Settings
  recoveryCount: number
  lastRecoveryTime: number
  raw?: unknown
}

export type VerifyResult = {
  issues: string[]
  fixes: string[]
  positionsVerified: number
}

export type RecoveryResult =
  | { recovered: false; reason: string }
  | { recovered: true; savedState: RecoveryBotState; stateAgeMinutes: number; verificationResult: VerifyResult }

export const STATE_FILE = path.join(process.cwd(), "bot-state.json")
export const BACKUP_FILE = path.join(process.cwd(), "bot-state-backup.json")

export async function saveState(state: RecoveryBotState): Promise<void> {
  const json = JSON.stringify(state, null, 2)
  try {
    await fs.writeFile(BACKUP_FILE, json, "utf8")
    await fs.writeFile(STATE_FILE, json, "utf8")
  } catch (e) {
    const msg = e instanceof Error ? e.message : "State save failed"
    await sendTelegram(`⚠️ <b>STATE SAVE FAILED</b>\nManual check needed\nReason: ${escapeHtml(msg)}`).catch(() => undefined)
  }
}

export async function loadState(): Promise<RecoveryBotState | null> {
  const tryRead = async (p: string) => {
    const data = await fs.readFile(p, "utf8")
    return JSON.parse(data) as RecoveryBotState
  }
  try {
    return await tryRead(STATE_FILE)
  } catch {
    try {
      return await tryRead(BACKUP_FILE)
    } catch {
      return null
    }
  }
}

export async function recoverFromCrash(): Promise<RecoveryResult> {
  const savedState = await loadState()
  if (!savedState) return { recovered: false, reason: "No state file found" }

  const stateAge = Date.now() - savedState.timestamp
  const stateAgeMinutes = stateAge / 1000 / 60
  if (stateAgeMinutes > 60) {
    await sendTelegram(`⚠️ <b>RECOVERY</b>: State is ${Math.round(stateAgeMinutes)} min old`).catch(() => undefined)
  }

  const verificationResult = await verifyPositions(savedState.openPositions)
  return { recovered: true, savedState, stateAgeMinutes, verificationResult }
}

export async function verifyPositions(savedPositions: OpenPosition[]): Promise<VerifyResult> {
  const issues: string[] = []
  const fixes: string[] = []

  const apiKey = process.env.BINGX_API_KEY
  const secret = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secret) {
    return { issues: ["BINGX keys missing — cannot verify live positions"], fixes: [], positionsVerified: savedPositions.length }
  }

  const [livePositions, liveOrders] = await Promise.all([
    safeBingxGetPositions(apiKey, secret),
    safeBingxGetOpenOrders(apiKey, secret)
  ])

  for (const saved of savedPositions) {
    const match = livePositions.find((p) => String(p?.symbol ?? "").toUpperCase() === saved.symbol.toUpperCase())
    if (!match) {
      issues.push(`Position ${saved.symbol} not found on exchange (may have closed during downtime)`)
      continue
    }

    if (saved.slOrderId) {
      const sl = liveOrders.find((o) => String(o?.orderId ?? "") === String(saved.slOrderId))
      if (!sl) issues.push(`SL order missing for ${saved.symbol}`)
    }
    if (saved.tpOrderId) {
      const tp = liveOrders.find((o) => String(o?.orderId ?? "") === String(saved.tpOrderId))
      if (!tp) issues.push(`TP order missing for ${saved.symbol}`)
    }
  }

  return { issues, fixes, positionsVerified: savedPositions.length }
}

export function snapshotFromDashboard(opts: {
  version: string
  botStatus: BotStatus
  settings: Settings
  currentLevel: number
  equity: number
  startingEquity: number
  openTrades: Trade[]
  pendingOrders: PendingOrder[]
  dailyTradeCount: number
  dailyPnl: number
  lastTradeId: string
  lastCandleProcessed: number
  activeFilters: string[]
  currentRegime: string
  recoveryCount: number
  lastRecoveryTime: number
  consecutiveWins: number
  consecutiveLosses: number
  raw?: unknown
}): RecoveryBotState {
  const openPositions: OpenPosition[] = opts.openTrades
    .filter((t) => t.status === "OPEN")
    .map((t) => ({
      orderId: t.id,
      symbol: t.symbol,
      direction: t.side,
      entryPrice: t.entryPrice,
      size: t.quantity,
      leverage: t.leverage,
      stopLoss: t.stopLossPrice,
      takeProfit: t.takeProfitPrice,
      trailingStop: Boolean(opts.settings.risk.trailingStopEnabled),
      trailingDistance: 0,
      openTime: t.openedAt,
      partialProfitLocked: 0,
      peakPrice: typeof t.peakPrice === "number" ? t.peakPrice : t.entryPrice
    }))

  return {
    timestamp: Date.now(),
    version: opts.version,
    botStatus: opts.botStatus,
    currentLevel: opts.currentLevel,
    equity: opts.equity,
    startingEquity: opts.startingEquity,
    openPositions,
    pendingOrders: opts.pendingOrders,
    dailyTradeCount: opts.dailyTradeCount,
    dailyPnl: opts.dailyPnl,
    consecutiveLosses: opts.consecutiveLosses,
    consecutiveWins: opts.consecutiveWins,
    lastTradeId: opts.lastTradeId,
    lastCandleProcessed: opts.lastCandleProcessed,
    activeFilters: opts.activeFilters,
    currentRegime: opts.currentRegime,
    settings: opts.settings,
    recoveryCount: opts.recoveryCount,
    lastRecoveryTime: opts.lastRecoveryTime,
    raw: opts.raw
  }
}

async function safeBingxGetPositions(apiKey: string, secretKey: string): Promise<any[]> {
  try {
    const res = await fetch(buildBingxSignedUrl("/openApi/swap/v2/user/positions", apiKey, secretKey), {
      headers: { "X-BX-APIKEY": apiKey },
      cache: "no-store"
    })
    const data = (await res.json()) as any
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.positions) ? data.data.positions : []
    return list
  } catch {
    return []
  }
}

async function safeBingxGetOpenOrders(apiKey: string, secretKey: string): Promise<any[]> {
  try {
    const res = await fetch(buildBingxSignedUrl("/openApi/swap/v2/trade/openOrders", apiKey, secretKey), {
      headers: { "X-BX-APIKEY": apiKey },
      cache: "no-store"
    })
    const data = (await res.json()) as any
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.orders) ? data.data.orders : []
    return list
  } catch {
    return []
  }
}

function buildBingxSignedUrl(pathname: string, apiKey: string, secretKey: string): string {
  void apiKey
  const ts = Date.now()
  const params = new URLSearchParams({ timestamp: String(ts) })
  const query = params.toString()
  const sig = hmacSha256(query, secretKey)
  return `https://open-api.bingx.com${pathname}?${query}&signature=${sig}`
}

function hmacSha256(payload: string, secret: string): string {
  const crypto = require("crypto") as typeof import("crypto")
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

