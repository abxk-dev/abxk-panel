import fs from "fs"
import path from "path"
import cron from "node-cron"
import WebSocket from "ws"
import zlib from "zlib"
import type { Candle, Settings } from "@/types/bot"
import { bingxRequest } from "@/lib/bingx"
import { SCAN_SYMBOLS, resolveScanSymbols, scanAllSymbols } from "@/lib/scanner"
import { getPriceFeedStatus, startPriceWebSocket, stopPriceWebSocket } from "@/lib/priceWebSocket"
import {
  buildWeeklyReportFromBotState,
  buildWeeklyReportTelegramCaption,
  generateWeeklyPerformancePdfBase64
} from "@/lib/reportGenerator"
import {
  DEFAULT_SCALP_SETTINGS,
  DEFAULT_SCALP2_SETTINGS,
  calculateFees,
  computePnlUsd,
  manageScalpTrade,
  scanScalpLeaderboard,
  scanScalp2Leaderboard,
  settingsFromEnv,
  settingsFromScalp2Env,
  type ScalpSettings,
  type ScalpSignal,
  type ScalpTimeframe,
  type Scalp2Settings,
  type Scalp2Signal,
  type ScalpTrade
} from "@/lib/scalpEngine"
import { DEFAULT_SCALPING3_SETTINGS, settingsFromScalp3Env } from "@/lib/scalping3/settings"
import { runScalping3Scan } from "@/lib/scalping3/strategy"
import type { Scalping3Settings, Scalping3Signal, Scalping3Timeframe } from "@/lib/scalping3/types"
import {
  DEFAULT_PUMP_SETTINGS,
  PUMP_THRESHOLDS,
  fetchCandles,
  scanAllCoinsForPump,
  type PumpAlertSettings,
  type PumpDetection,
  type PumpLevel
} from "@/lib/pumpDetector"
import { computeNewsStatus, fetchForexFactoryWeek } from "@/lib/newsFilter"

type BotMode = "paper" | "live" | "mirror"
type BotTimeframe = "15m" | "1h" | "4h" | "1d"

type EngineScalpTrade = ScalpTrade & {
  execMode: "paper" | "live"
  groupId: string
  leverage: number
  grossPnlUsd?: number
  netPnlUsd?: number
  fees?: {
    openFee: number
    closeFee: number
    fundingFee: number
    totalFee: number
  }
  closePrice?: number
  lastWickCheckAt?: number
}

type PaperScalpAccount = {
  balance: number
  totalDeposited: number
  totalFeesPaid: number
  totalGrossPnl: number
  totalNetPnl: number
}

type EngineScalp3Trade = {
  id: string
  execMode: "paper" | "live"
  groupId: string
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  quantity: number
  margin: number
  leverage: number
  positionValue: number
  tpPrice: number
  tp1Price?: number
  tp2Price?: number
  tpStage?: 1 | 2
  slPrice: number
  rr: number
  scores: { smc: number; volume: number; session: number; total: number }
  openedAt: number
  closedAt?: number
  status: "OPEN" | "CLOSED"
  closeReason?: "SL_HIT" | "TP_HIT" | "MANUAL"
  realizedPnlUsd?: number
  feesPaidCloseUsd?: number
  feesPaidFundingUsd?: number
  pnlUsd?: number
  grossPnlUsd?: number
  netPnlUsd?: number
  fees?: { openFee: number; closeFee: number; fundingFee: number; totalFee: number }
  orderId?: string
  closePrice?: number
}

type PumpTrailing = {
  enabled: boolean
  mode: "PCT" | "USD"
  activateAt: number
  distance: number
  active: boolean
  bestPrice: number
  bestPnlUsd?: number
}

type EnginePumpTrade = {
  id: string
  execMode: "paper" | "live"
  source?: "PUMP1" | "PUMP2"
  symbol: string
  direction: "SHORT"
  pumpLevel: PumpLevel
  entryPrice: number
  quantity: number
  margin: number
  leverage: number
  positionValue: number
  tpPrice: number
  slPrice: number
  trailing: PumpTrailing
  phase: "OPEN" | "TRAIL"
  detectedAt: number
  openedAt: number
  status: "OPEN" | "CLOSED"
  orderId?: string
  currentPrice?: number
  pnlPercent?: number
  closePrice?: number
  closedAt?: number
  closeReason?: string
  grossPnlUsd?: number
  netPnlUsd?: number
  feesUsd?: number
}

type EnginePumpRecent = PumpDetection & {
  action: "ALERT" | "SHORT"
}

type Pump2LevelConfig = {
  enabled: boolean
  pct: number
  timeframeMin: number
  volX: number
}

type Pump2Settings = {
  enabled: boolean
  minVolumeUsd: number
  debounceMinutes: number
  minPriceChangeAbs: number
  mtcEnabled: boolean
  mtcTimeframes: number[]
  mtcMinConfirmations: number
  levels: Record<PumpLevel, Pump2LevelConfig>
  trade: {
    enabled: boolean
    mode: "paper" | "live" | "mirror"
    leverage: number
    marginUsd: number
    stopLoss: { mode: "PCT" | "USD"; value: number }
    takeProfit: { mode: "PCT" | "USD"; value: number }
    trailingStop: { enabled: boolean; activateAtUsd: number; distanceUsd: number }
  }
}

type Pump2Alert = {
  id: string
  symbol: string
  price: number
  pctChange: number
  volumeMultiplier: number
  confidence: PumpLevel
  rsi?: number | null
  chg5m?: number | null
  chg10m?: number | null
  chg1h?: number | null
  chg4h?: number | null
  chg12h?: number | null
  mtcScore?: number
  timestamp: number
}

const DEFAULT_PUMP2_SETTINGS: Pump2Settings = {
  enabled: false,
  minVolumeUsd: 1_000_000,
  debounceMinutes: 20,
  minPriceChangeAbs: 0.01,
  mtcEnabled: true,
  mtcTimeframes: [5, 10, 15],
  mtcMinConfirmations: 2,
  levels: {
    LOW: { enabled: true, pct: 1.5, timeframeMin: 5, volX: 2.0 },
    MEDIUM: { enabled: true, pct: 3.0, timeframeMin: 5, volX: 3.0 },
    HIGH: { enabled: true, pct: 5.0, timeframeMin: 5, volX: 5.0 },
    EXTREME: { enabled: true, pct: 10.0, timeframeMin: 5, volX: 10.0 }
  },
  trade: {
    enabled: false,
    mode: "paper",
    leverage: 10,
    marginUsd: 10,
    stopLoss: { mode: "PCT", value: 2 },
    takeProfit: { mode: "PCT", value: 1.5 },
    trailingStop: { enabled: true, activateAtUsd: 2, distanceUsd: 1 }
  }
}

type EngineState = {
  startedAt: number
  mode: BotMode
  symbol: string
  timeframe: BotTimeframe
  paused?: boolean
  ws: {
    connected: boolean
    lastMessageAt?: number
    lastPrice?: number
  }
  health: {
    lastCheckAt?: number
    bingxOk?: boolean
    bingxAuthOk?: boolean
    coingeckoOk?: boolean
  }
  last4hCandleClose?: number
  lastScanSummary?: {
    symbol: string
    side: "LONG" | "SHORT"
    score: number
  }
  scalping: {
    settings: ScalpSettings
    paperAccount: PaperScalpAccount
    openTrades: EngineScalpTrade[]
    closedTrades: EngineScalpTrade[]
    leaderboard: {
      symbol: string
      score: number
      direction: "LONG" | "SHORT"
      pattern: { name: string; strength: "STRONG" | "MODERATE" | "WEAK" | "NONE"; reliability?: number; allowed: boolean }
      vwapOk: boolean
      rsiOk: boolean
      volRatio: number
    }[]
    updatedAt?: number
    lastHourKey?: string
    paperBalanceApplied?: number
    dailyLossLock?: { day: string; hit: boolean }
  }
  scalping2: {
    settings: Scalp2Settings
    paperAccount: PaperScalpAccount
    openTrades: EngineScalpTrade[]
    closedTrades: EngineScalpTrade[]
    leaderboard: {
      symbol: string
      score: number
      direction: "LONG" | "SHORT"
      pattern: { name: string; strength: "STRONG" | "MODERATE" | "WEAK" | "NONE"; reliability?: number; allowed: boolean }
      vwapOk: boolean
      rsiOk: boolean
      volRatio: number
    }[]
    updatedAt?: number
    lastHourKey?: string
    paperBalanceApplied?: number
    dailyLossLock?: { day: string; hit: boolean }
  }
  scalping3: {
    settings: Scalping3Settings
    paperAccount: PaperScalpAccount
    openTrades: EngineScalp3Trade[]
    closedTrades: EngineScalp3Trade[]
    skipOnce?: boolean
    lastNoSignalTelegramAt?: number
    lastScan?: {
      at: number
      session: string
      scanned: number
      smcValid: number
      volumeConfirmed: number
      reason: string
    }
    pending?: { createdAt: number; signal: Scalping3Signal; dueAt: number }
    updatedAt?: number
    paperBalanceApplied?: number
  }
  pump: {
    settings: PumpAlertSettings
    openTrades: EnginePumpTrade[]
    closedTrades: EnginePumpTrade[]
    recentPumps: EnginePumpRecent[]
    cooldowns: Record<string, number>
    updatedAt?: number
  }
  pump2: {
    settings: Pump2Settings
    pairsCount: number
    lastCheckAt?: number
    alerts: Pump2Alert[]
    debounce: Record<string, number>
    updatedAt?: number
  }
}

const ROOT = path.resolve(__dirname, "..")
const STATE_PATH = path.join(ROOT, "bot-state.json")
const SCALP_STATE_PATH = path.join(ROOT, "scalp-state.json")
const SCALP2_STATE_PATH = path.join(ROOT, "scalp2-state.json")
const SCALP3_STATE_PATH = path.join(ROOT, "scalp3-state.json")
const PUMP_STATE_PATH = path.join(ROOT, "pump-state.json")
const PUMP2_STATE_PATH = path.join(ROOT, "pump2-state.json")

loadEnvLocal()

const mode = normalizeMode(process.env.BOT_MODE)
const symbol = String(process.env.DEFAULT_SYMBOL ?? process.env.BOT_SYMBOL ?? "BTC-USDT")
const scanSymbols = parseSymbolsEnv(process.env.SCAN_SYMBOLS) ?? undefined
const timeframe = normalizeTimeframe(process.env.TRADING_TIMEFRAME ?? process.env.BOT_TIMEFRAME ?? "4h")

const engine: EngineState = {
  startedAt: Date.now(),
  mode,
  symbol,
  timeframe,
  ws: { connected: false },
  health: {},
  scalping: {
    settings: DEFAULT_SCALP_SETTINGS,
    paperAccount: {
      balance: Number(process.env.SCALPING_PAPER_BALANCE ?? 250),
      totalDeposited: Number(process.env.SCALPING_PAPER_BALANCE ?? 250),
      totalFeesPaid: 0,
      totalGrossPnl: 0,
      totalNetPnl: 0
    },
    openTrades: [],
    closedTrades: [],
    leaderboard: [],
    paperBalanceApplied: Number(process.env.SCALPING_PAPER_BALANCE ?? 250),
    dailyLossLock: { day: dayKey(Date.now()), hit: false }
  },
  scalping2: {
    settings: DEFAULT_SCALP2_SETTINGS,
    paperAccount: {
      balance: Number(process.env.SCALPING2_PAPER_BALANCE ?? 250),
      totalDeposited: Number(process.env.SCALPING2_PAPER_BALANCE ?? 250),
      totalFeesPaid: 0,
      totalGrossPnl: 0,
      totalNetPnl: 0
    },
    openTrades: [],
    closedTrades: [],
    leaderboard: [],
    paperBalanceApplied: Number(process.env.SCALPING2_PAPER_BALANCE ?? 250),
    dailyLossLock: { day: dayKey(Date.now()), hit: false }
  },
  scalping3: {
    settings: DEFAULT_SCALPING3_SETTINGS,
    paperAccount: {
      balance: Number(process.env.SCALPING3_PAPER_BALANCE ?? 250),
      totalDeposited: Number(process.env.SCALPING3_PAPER_BALANCE ?? 250),
      totalFeesPaid: 0,
      totalGrossPnl: 0,
      totalNetPnl: 0
    },
    openTrades: [],
    closedTrades: [],
    skipOnce: false,
    updatedAt: Date.now(),
    paperBalanceApplied: Number(process.env.SCALPING3_PAPER_BALANCE ?? 250)
  },
  pump: {
    settings: DEFAULT_PUMP_SETTINGS,
    openTrades: [],
    closedTrades: [],
    recentPumps: [],
    cooldowns: {}
  },
  pump2: {
    settings: DEFAULT_PUMP2_SETTINGS,
    pairsCount: 0,
    alerts: [],
    debounce: {}
  }
}

restoreScalpingStateFromDisk()
restoreScalping2StateFromDisk()
restoreScalping3StateFromDisk()
restorePumpStateFromDisk()
restorePump2StateFromDisk()

log(`▶ Bot engine started — ${mode.toUpperCase()} MODE`)

let healthTimer: NodeJS.Timeout | null = null
let stateTimer: NodeJS.Timeout | null = null
let candleTimer: NodeJS.Timeout | null = null
let commandTimer: NodeJS.Timeout | null = null
let scalpScanTimer: NodeJS.Timeout | null = null
let scalpUpdateTimer: NodeJS.Timeout | null = null
let scalpCommandTimer: NodeJS.Timeout | null = null
let scalpSummaryTimer: NodeJS.Timeout | null = null
let scalp2ScanTimer: NodeJS.Timeout | null = null
let scalp2UpdateTimer: NodeJS.Timeout | null = null
let scalp2CommandTimer: NodeJS.Timeout | null = null
let scalp2SummaryTimer: NodeJS.Timeout | null = null
let scalp3ScanTimer: NodeJS.Timeout | null = null
let scalp3UpdateTimer: NodeJS.Timeout | null = null
let scalp3CommandTimer: NodeJS.Timeout | null = null
let scalp3PendingTimer: NodeJS.Timeout | null = null
let pumpScanTimer: NodeJS.Timeout | null = null
let pumpTrailTimer: NodeJS.Timeout | null = null
let pumpCommandTimer: NodeJS.Timeout | null = null
let pump2ControlTimer: NodeJS.Timeout | null = null
let scalpScanInFlight = false
let scalp2ScanInFlight = false
let scalp3ScanInFlight = false
const scalpOpenLocks = new Map<string, number>()
const scalp2OpenLocks = new Map<string, number>()
let pumpScanInFlight = false

type Pump2Point = { ts: number; price: number; vol: number }

type Pump2Runtime = {
  started: boolean
  sockets: WebSocket[]
  symbols: string[]
  symbolsKey: string
  history: Map<string, Pump2Point[]>
  lastSampleAt: Map<string, number>
  volRatioCache: Map<string, { at: number; ratio: number }>
  lastPairsRefreshAt: number
  reconnectAt: number
}

const pump2Runtime: Pump2Runtime = {
  started: false,
  sockets: [],
  symbols: [],
  symbolsKey: "",
  history: new Map(),
  lastSampleAt: new Map(),
  volRatioCache: new Map(),
  lastPairsRefreshAt: 0,
  reconnectAt: 0
}

let pump2ControlInFlight = false

startWebSocketPriceFeed(scanSymbols ?? [symbol])
startHealthMonitor()
startScheduledJobs()
startMainLoop()
startStateSaver()
startCommandListener()
startScalpingEngine()
startScalping2Engine()
startScalping3Engine()
startPumpEngine()
startPump2Engine()

log("▶ Waiting for next 4H candle close...")

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

function restoreScalpingStateFromDisk() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = fs.readFileSync(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as any
    const scalping = parsed?.scalping
    if (!scalping || typeof scalping !== "object") return

    const openTrades = Array.isArray(scalping.openTrades) ? scalping.openTrades.filter(isEngineScalpTrade) : []
    const closedTrades = Array.isArray(scalping.closedTrades) ? scalping.closedTrades.filter(isEngineScalpTrade) : []
    const paper = scalping.paperAccount

    if (openTrades.length) engine.scalping.openTrades = dedupeOpenTrades(openTrades as EngineScalpTrade[])
    if (closedTrades.length)
      engine.scalping.closedTrades = dedupeByKey<EngineScalpTrade>(closedTrades as EngineScalpTrade[], (t) => t.id).slice(0, 2_000)
    if (paper && typeof paper === "object") {
      const balance = Number((paper as any).balance)
      const totalDeposited = Number((paper as any).totalDeposited)
      const totalFeesPaid = Number((paper as any).totalFeesPaid)
      const totalGrossPnl = Number((paper as any).totalGrossPnl)
      const totalNetPnl = Number((paper as any).totalNetPnl)
      if ([balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl].every((n) => Number.isFinite(n))) {
        engine.scalping.paperAccount = { balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl }
      }
    }
  } catch {
    return
  }
}

function restoreScalping2StateFromDisk() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = fs.readFileSync(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as any
    const scalping2 = parsed?.scalping2
    if (!scalping2 || typeof scalping2 !== "object") return

    const openTrades = Array.isArray(scalping2.openTrades) ? scalping2.openTrades.filter(isEngineScalpTrade) : []
    const closedTrades = Array.isArray(scalping2.closedTrades) ? scalping2.closedTrades.filter(isEngineScalpTrade) : []
    const paper = scalping2.paperAccount

    if (openTrades.length) engine.scalping2.openTrades = dedupeOpenTrades(openTrades as EngineScalpTrade[])
    if (closedTrades.length)
      engine.scalping2.closedTrades = dedupeByKey<EngineScalpTrade>(closedTrades as EngineScalpTrade[], (t) => t.id).slice(0, 2_000)
    if (paper && typeof paper === "object") {
      const balance = Number((paper as any).balance)
      const totalDeposited = Number((paper as any).totalDeposited)
      const totalFeesPaid = Number((paper as any).totalFeesPaid)
      const totalGrossPnl = Number((paper as any).totalGrossPnl)
      const totalNetPnl = Number((paper as any).totalNetPnl)
      if ([balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl].every((n) => Number.isFinite(n))) {
        engine.scalping2.paperAccount = { balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl }
      }
    }
  } catch {
    return
  }
}

function restoreScalping3StateFromDisk() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = fs.readFileSync(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as any
    const scalping3 = parsed?.scalping3
    if (!scalping3 || typeof scalping3 !== "object") return

    const openTrades = Array.isArray(scalping3.openTrades) ? scalping3.openTrades.filter(isEngineScalp3Trade) : []
    const closedTrades = Array.isArray(scalping3.closedTrades) ? scalping3.closedTrades.filter(isEngineScalp3Trade) : []
    const paper = scalping3.paperAccount

    if (openTrades.length) engine.scalping3.openTrades = dedupeOpenScalp3Trades(openTrades as EngineScalp3Trade[])
    if (closedTrades.length)
      engine.scalping3.closedTrades = dedupeByKey<EngineScalp3Trade>(closedTrades as EngineScalp3Trade[], (t) => t.id).slice(0, 2_000)
    if (paper && typeof paper === "object") {
      const balance = Number((paper as any).balance)
      const totalDeposited = Number((paper as any).totalDeposited)
      const totalFeesPaid = Number((paper as any).totalFeesPaid)
      const totalGrossPnl = Number((paper as any).totalGrossPnl)
      const totalNetPnl = Number((paper as any).totalNetPnl)
      if ([balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl].every((n) => Number.isFinite(n))) {
        engine.scalping3.paperAccount = { balance, totalDeposited, totalFeesPaid, totalGrossPnl, totalNetPnl }
      }
    }
  } catch {
    return
  }
}

function restorePumpStateFromDisk() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = fs.readFileSync(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as any
    const pump = parsed?.pump
    if (!pump || typeof pump !== "object") return

    const openTrades = Array.isArray(pump.openTrades) ? pump.openTrades.filter(isEnginePumpTrade) : []
    const closedTrades = Array.isArray(pump.closedTrades) ? pump.closedTrades.filter(isEnginePumpTrade) : []
    const recentPumps = Array.isArray(pump.recentPumps) ? pump.recentPumps : []
    const cooldowns = pump.cooldowns && typeof pump.cooldowns === "object" ? (pump.cooldowns as Record<string, unknown>) : {}

    if (openTrades.length) engine.pump.openTrades = dedupeByKey<EnginePumpTrade>(openTrades as EnginePumpTrade[], (t) => t.id)
    if (closedTrades.length)
      engine.pump.closedTrades = dedupeByKey<EnginePumpTrade>(closedTrades as EnginePumpTrade[], (t) => t.id).slice(0, 2_000)

    const cleaned = recentPumps
      .filter((x: any) => x && typeof x === "object" && typeof x.symbol === "string" && typeof x.detectedAt === "number")
      .map((x: any) => ({
        ...x,
        symbol: String(x.symbol),
        detectedAt: Number(x.detectedAt)
      }))
    const sorted = [...cleaned].sort((a: any, b: any) => Number(b.detectedAt) - Number(a.detectedAt))
    engine.pump.recentPumps = dedupeByKey(sorted, (p: any) => `${p.symbol}:${p.detectedAt}:${String(p.action ?? "")}`).slice(0, 500)

    engine.pump.cooldowns = {}
    for (const [k, v] of Object.entries(cooldowns)) {
      const exp = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
      if (!Number.isFinite(exp)) continue
      engine.pump.cooldowns[String(k)] = exp
    }
  } catch {
    return
  }
}

function restorePump2StateFromDisk() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = fs.readFileSync(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as any
    const pump2 = parsed?.pump2
    if (!pump2 || typeof pump2 !== "object") return

    const alerts = Array.isArray(pump2.alerts) ? pump2.alerts.filter(isPump2Alert) : []
    const debounce = pump2.debounce && typeof pump2.debounce === "object" ? (pump2.debounce as Record<string, unknown>) : {}

    if (alerts.length) {
      const sorted = [...alerts].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      engine.pump2.alerts = dedupeByKey(sorted, (a) => a.id).slice(0, 500)
    }
    engine.pump2.debounce = {}
    for (const [k, v] of Object.entries(debounce)) {
      const ts = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
      if (!Number.isFinite(ts)) continue
      engine.pump2.debounce[String(k)] = ts
    }
  } catch {
    return
  }
}

function isPump2Alert(x: unknown): x is Pump2Alert {
  if (!x || typeof x !== "object") return false
  const a = x as any
  if (typeof a.id !== "string" || !a.id) return false
  if (typeof a.symbol !== "string" || !a.symbol) return false
  if (!Number.isFinite(Number(a.price))) return false
  if (!Number.isFinite(Number(a.pctChange))) return false
  if (!Number.isFinite(Number(a.volumeMultiplier))) return false
  if (a.confidence !== "LOW" && a.confidence !== "MEDIUM" && a.confidence !== "HIGH" && a.confidence !== "EXTREME") return false
  if (!Number.isFinite(Number(a.timestamp))) return false
  return true
}

function isEngineScalpTrade(x: unknown): x is EngineScalpTrade {
  if (!x || typeof x !== "object") return false
  const t = x as any
  if (typeof t.id !== "string" || !t.id) return false
  if (typeof t.symbol !== "string" || !t.symbol) return false
  if (t.direction !== "LONG" && t.direction !== "SHORT") return false
  if (!Number.isFinite(Number(t.entryPrice)) || Number(t.entryPrice) <= 0) return false
  if (!Number.isFinite(Number(t.quantity)) || Number(t.quantity) <= 0) return false
  if (!Number.isFinite(Number(t.margin)) || Number(t.margin) < 0) return false
  if (!Number.isFinite(Number(t.positionValue)) || Number(t.positionValue) < 0) return false
  if (!Number.isFinite(Number(t.score)) || Number(t.score) < 0) return false
  if (!Array.isArray(t.topFilters)) return false
  if (!Number.isFinite(Number(t.openedAt)) || Number(t.openedAt) <= 0) return false
  if (t.status !== "OPEN" && t.status !== "CLOSED") return false
  if (!t.trailing || typeof t.trailing !== "object") return false
  const phase = (t.trailing as any).phase
  if (phase !== "INITIAL" && phase !== "TRAILING" && phase !== "CLOSED") return false
  if (t.execMode !== "paper" && t.execMode !== "live") return false
  if (typeof t.groupId !== "string" || !t.groupId) return false
  if (!Number.isFinite(Number(t.leverage)) || Number(t.leverage) <= 0) return false
  return true
}

function isEngineScalp3Trade(x: unknown): x is EngineScalp3Trade {
  if (!x || typeof x !== "object") return false
  const t = x as any
  if (typeof t.id !== "string" || !t.id) return false
  if (typeof t.symbol !== "string" || !t.symbol) return false
  if (t.direction !== "LONG" && t.direction !== "SHORT") return false
  if (!Number.isFinite(Number(t.entryPrice)) || Number(t.entryPrice) <= 0) return false
  if (!Number.isFinite(Number(t.quantity)) || Number(t.quantity) <= 0) return false
  if (!Number.isFinite(Number(t.margin)) || Number(t.margin) < 0) return false
  if (!Number.isFinite(Number(t.positionValue)) || Number(t.positionValue) < 0) return false
  if (!Number.isFinite(Number(t.tpPrice)) || Number(t.tpPrice) <= 0) return false
  if (!Number.isFinite(Number(t.slPrice)) || Number(t.slPrice) <= 0) return false
  if (!Number.isFinite(Number(t.rr)) || Number(t.rr) < 0) return false
  if (!Number.isFinite(Number(t.openedAt)) || Number(t.openedAt) <= 0) return false
  if (t.status !== "OPEN" && t.status !== "CLOSED") return false
  if (t.execMode !== "paper" && t.execMode !== "live") return false
  if (typeof t.groupId !== "string" || !t.groupId) return false
  if (!Number.isFinite(Number(t.leverage)) || Number(t.leverage) <= 0) return false
  return true
}

function isEnginePumpTrade(x: unknown): x is EnginePumpTrade {
  if (!x || typeof x !== "object") return false
  const t = x as any
  if (typeof t.id !== "string" || !t.id) return false
  if (typeof t.symbol !== "string" || !t.symbol) return false
  if (t.direction !== "SHORT") return false
  if (t.pumpLevel !== "LOW" && t.pumpLevel !== "MEDIUM" && t.pumpLevel !== "HIGH" && t.pumpLevel !== "EXTREME") return false
  if (!Number.isFinite(Number(t.entryPrice)) || Number(t.entryPrice) <= 0) return false
  if (!Number.isFinite(Number(t.quantity)) || Number(t.quantity) <= 0) return false
  if (!Number.isFinite(Number(t.margin)) || Number(t.margin) < 0) return false
  if (!Number.isFinite(Number(t.positionValue)) || Number(t.positionValue) < 0) return false
  if (!Number.isFinite(Number(t.tpPrice)) || Number(t.tpPrice) <= 0) return false
  if (!Number.isFinite(Number(t.slPrice)) || Number(t.slPrice) <= 0) return false
  if (!t.trailing || typeof t.trailing !== "object") return false
  if (typeof (t.trailing as any).enabled !== "boolean") return false
  if (!Number.isFinite(Number((t.trailing as any).distance))) return false
  if (!Number.isFinite(Number((t.trailing as any).activateAt))) return false
  if (typeof (t.trailing as any).active !== "boolean") return false
  if (!Number.isFinite(Number((t.trailing as any).bestPrice))) return false
  if (!Number.isFinite(Number(t.openedAt)) || Number(t.openedAt) <= 0) return false
  if (t.status !== "OPEN" && t.status !== "CLOSED") return false
  if (t.execMode !== "paper" && t.execMode !== "live") return false
  return true
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function normalizeMode(v: unknown): BotMode {
  const s = String(v ?? "paper").toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  return "paper"
}

function log(msg: string) {
  process.stdout.write(`${msg}\n`)
}

function startWebSocketPriceFeed(symbols: string[]) {
  startPriceWebSocket(symbols)
  let logged = false
  const t = setInterval(() => {
    const s = getPriceFeedStatus()
    engine.ws.connected = s.connected
    engine.ws.lastMessageAt = s.lastMessageAt
    if (!logged && s.connected) {
      logged = true
      log("▶ WebSocket price feed connected")
    }
    if (!engine.ws.connected && !engine.ws.lastMessageAt) return
    clearInterval(t)
  }, 1000)
}

function startHealthMonitor() {
  const tick = async () => {
    engine.health.lastCheckAt = Date.now()
    engine.health.bingxOk = await pingBingx().catch(() => false)
    engine.health.bingxAuthOk = await pingBingxAuth().catch(() => false)
    engine.health.coingeckoOk = await pingCoingecko().catch(() => false)
  }
  void tick()
  healthTimer = setInterval(() => void tick(), 30_000)
  log("▶ Health monitor active")
}

async function pingBingx(): Promise<boolean> {
  const res = await fetch("https://open-api.bingx.com/openApi/swap/v2/server/time", { cache: "no-store" })
  return res.status < 500
}

async function pingBingxAuth(): Promise<boolean> {
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) return false
  await bingxRequest<unknown>({
    method: "GET",
    path: "/openApi/swap/v2/user/balance",
    apiKey,
    secretKey
  })
  return true
}

async function pingCoingecko(): Promise<boolean> {
  const res = await fetch("https://api.coingecko.com/api/v3/ping", { cache: "no-store" })
  return res.ok
}

function startScheduledJobs() {
  cron.schedule("0 23 * * *", async () => {
    log("▶ Daily report job triggered (23:00 UTC)")
  })

  cron.schedule("0 0 * * 0", async () => {
    log("▶ Weekly optimizer job triggered (Sunday 00:00 UTC)")
  })

  cron.schedule("0 9 * * 0", async () => {
    await sendWeeklyPdfReport().catch(() => undefined)
  })

  log("▶ Scheduled jobs active")
}

function startMainLoop() {
  const intervalMs =
    engine.timeframe === "15m"
      ? 15 * 60 * 1000
      : engine.timeframe === "1h"
        ? 60 * 60 * 1000
        : engine.timeframe === "4h"
          ? 4 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000

  const dayAnchorUtcHour = 9

  const getSlotStart = (now: number) => {
    if (engine.timeframe !== "1d") return Math.floor(now / intervalMs) * intervalMs
    const d = new Date(now)
    const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
    const anchor = utcMidnight + dayAnchorUtcHour * 60 * 60 * 1000
    return now >= anchor ? anchor : anchor - 24 * 60 * 60 * 1000
  }

  const runImmediate = async () => {
    const now = Date.now()
    const candleClose = getSlotStart(now)
    log("[BOT] Bot resumed — running immediate scan")
    engine.last4hCandleClose = candleClose
    await on4hCandleClose(candleClose).catch(() => undefined)
  }

  const tick = async () => {
    if (engine.paused) return
    const now = Date.now()
    const candleClose = getSlotStart(now)
    if (!engine.last4hCandleClose || candleClose > engine.last4hCandleClose) {
      engine.last4hCandleClose = candleClose
      await on4hCandleClose(candleClose).catch(() => undefined)
    }
  }

  void runImmediate()
  candleTimer = setInterval(() => void tick(), 60_000)
}

function startCommandListener() {
  const base = String(process.env.BOT_COMMAND_URL ?? "http://localhost:3000/api/bot/command")
  let lastPaused: boolean | undefined = engine.paused

  const tick = async () => {
    const cmd = await fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)
    const data = cmd?.data ?? null
    if (!data || typeof data !== "object") return

    const paused = typeof (data as any).paused === "boolean" ? Boolean((data as any).paused) : undefined
    const scanNow = Boolean((data as any).scanNow)

    if (paused !== undefined) {
      engine.paused = paused
      if (lastPaused === true && paused === false) {
        lastPaused = paused
        log("[BOT] Bot resumed — running immediate scan")
        await on4hCandleClose(Date.now()).catch(() => undefined)
      } else {
        lastPaused = paused
      }
    }

    if (scanNow && engine.paused !== true) {
      log("[BOT] Manual scan requested — running now")
      await on4hCandleClose(Date.now()).catch(() => undefined)
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanNow: false })
      }).catch(() => undefined)
    }
  }

  void tick()
  commandTimer = setInterval(() => void tick(), 5_000)
}

function normalizeTimeframe(v: unknown): BotTimeframe {
  const s = String(v ?? "4h").toLowerCase()
  if (s === "15m") return "15m"
  if (s === "1h") return "1h"
  if (s === "1d") return "1d"
  return "4h"
}

async function on4hCandleClose(candleClose: number) {
  engine.last4hCandleClose = candleClose

  const cached: {
    coingecko?: { btcDominance?: number; marketCapChange24hPct?: number }
    dxy?: { candles: { open: number; close: number }[] }
  } = {}

  const settings = buildEngineSettings(mode, symbol, timeframe)
  const requested = scanSymbols ?? [...SCAN_SYMBOLS]
  const contracts = await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/contracts", { cache: "no-store" })
    .then((r) => r.json())
    .catch(() => null)
  const contractRows: any[] = Array.isArray((contracts as any)?.data) ? (contracts as any).data : []
  const activeSymbols = contractRows.map((x) => String((x as any)?.symbol ?? "")).filter(Boolean)
  const resolvedInfo = resolveScanSymbols({ requested, active: activeSymbols })
  if (resolvedInfo.skipped.length) log(`▶ Symbols skipped (inactive): ${resolvedInfo.skipped.join(", ")}`)
  if (Object.keys(resolvedInfo.aliasMap).length) log(`▶ Symbol aliases: ${JSON.stringify(resolvedInfo.aliasMap)}`)

  const results = await scanAllSymbols({
    settings,
    symbols: resolvedInfo.resolved,
    maxConcurrent: 5,
    fetchKlines: async (sym, interval, limit) => fetchQuoteKlines(sym, interval, limit),
    fetchFundingRatePct: async (sym) => {
      const apiKey = process.env.BINGX_API_KEY
      const secretKey = process.env.BINGX_SECRET_KEY
      if (!apiKey || !secretKey) return undefined
      const res = await bingxRequest<any>({
        method: "GET",
        path: "/openApi/swap/v2/quote/premiumIndex",
        params: { symbol: sym },
        apiKey,
        secretKey
      })
      const row = res?.data ?? res
      const rate = Number(row?.lastFundingRate)
      return Number.isFinite(rate) ? rate * 100 : undefined
    },
    fetchCoingeckoGlobal: async () => {
      if (cached.coingecko) return cached.coingecko
      const res = await fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
      const json = (await res.json()) as any
      const btcDominance = Number(json?.data?.market_cap_percentage?.btc)
      const marketCapChange24hPct = Number(json?.data?.market_cap_change_percentage_24h_usd)
      cached.coingecko = {
        btcDominance: Number.isFinite(btcDominance) ? btcDominance : undefined,
        marketCapChange24hPct: Number.isFinite(marketCapChange24hPct) ? marketCapChange24hPct : undefined
      }
      return cached.coingecko
    },
    fetchDxyDaily: async () => {
      if (cached.dxy) return cached.dxy
      const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=10d&interval=1d", {
        cache: "no-store"
      })
      const json = (await res.json()) as any
      const result = json?.chart?.result?.[0]
      const quote = result?.indicators?.quote?.[0]
      const opens: any[] = Array.isArray(quote?.open) ? quote.open : []
      const closes: any[] = Array.isArray(quote?.close) ? quote.close : []
      const candles: { open: number; close: number }[] = []
      for (let i = 0; i < Math.min(opens.length, closes.length); i += 1) {
        const o = Number(opens[i])
        const c = Number(closes[i])
        if (Number.isFinite(o) && Number.isFinite(c)) candles.push({ open: o, close: c })
      }
      cached.dxy = { candles: candles.slice(-10) }
      return cached.dxy
    }
  })

  const best = results[0]
  if (!best || best.totalScore < 85) {
    const msg = best ? `▶ No quality setup. Best: ${best.symbol} ${best.totalScore}/100` : "▶ No setups found"
    log(msg)
    return
  }

  engine.lastScanSummary = { symbol: best.symbol, side: best.direction, score: best.totalScore }
  log(`▶ 4H close: Best setup ${best.symbol} ${best.direction} ${best.totalScore}/100 (RR ${best.rr.toFixed(2)}x)`)

  if (mode === "paper") return
  if (!process.env.BINGX_API_KEY || !process.env.BINGX_SECRET_KEY) {
    log("▶ Live/mirror mode requires BINGX_API_KEY and BINGX_SECRET_KEY")
    return
  }
}

function buildEngineSettings(botMode: BotMode, sym: string, tf: BotTimeframe): Settings {
  void botMode
  return {
    mode: botMode,
    symbol: sym,
    timeframe: tf,
    maxTradesPerDay: 1,
    minSetupScore: 75,
    filters: {
      trendEma: true,
      volumeSpike: true,
      atrVolatility: true,
      rsi: true,
      macd: true,
      bbSqueeze: true,
      fibGoldenPocket: true,
      stochRsi: true,
      macdDivergence: true,
      openInterest: true,
      liquidity: true,
      fundingRate: true,
      fundingHardBlock: true,
      session: true,
      htfDailyBias: true,
      newsBlackout: true,
      oiDivergence: true,
      fearGreed: true,
      liquidationTp: false
    },
    thresholds: {
      volumeSpikeMultiplier: 1.5,
      atrMin: 50,
      atrMax: 5000,
      maxSpreadPct: 0.1,
      maxFundingRatePct: 0.01,
      fundingHardBlockPct: 0.05,
      londonNyOverlapStartUtcHour: 13,
      londonNyOverlapEndUtcHour: 16,
      bbSqueezePctOfAvg: 1,
      fibLookbackCandles: 80,
      newsBlackoutMinutes: 30,
      fearGreedLongOnlyBelow: 25,
      fearGreedShortOnlyAbove: 75,
      liquidationExchange: "Binance",
      liquidationSymbol: "BTCUSDT",
      liquidationRange: "24h",
      liquidationTpOffsetPct: 0.2
    },
    features: {
      marketRegime: true,
      correlationFilter: true,
      patternRecognition: false,
      smc: true,
      onChain: false,
      sentiment: false,
      disasterRecovery: true,
      adaptiveLevels: true,
      scanner: true,
      selfLearner: false,
      liquidationHeatmap: true,
      journal: false,
      preTradeAlerts: false,
      marketMonitor: false,
      projection: false,
      partialProfitLock: false,
      newsFilter: false,
      healthCheck: false,
      whaleAlert: false
    },
    notifications: {
      regime: false,
      correlation: false,
      patternRecognition: false,
      smc: false,
      onChain: false,
      sentiment: false,
      disasterRecovery: false,
      scanner: false,
      selfLearner: false,
      liquidationHeatmap: false,
      journal: false,
      preTrade: false,
      marketMonitor: false,
      projection: false,
      partialProfitLock: false,
      health: false,
      whale: false
    },
    capital: { initialCapitalUsd: 20 },
    compounding: { levels: 30, profitTargetPct: 30, riskPctOfBalance: 23 },
    partialProfitLock: { triggerPctOfLevelTarget: 50, lockPctOfProfitSoFar: 25 },
    risk: {
      leverage: 10,
      slMode: "atr",
      slFixedPct: 1,
      slAtrMultiplier: 1.5,
      tpMode: "rr",
      tpFixedPct: 2,
      rrRatio: 2,
      trailingStopEnabled: false,
      trailingActivationPct: 1,
      dailyLossLimitUsd: 10,
      maxDrawdownPct: 30
    }
  }
}

async function fetchQuoteKlines(symbol: string, interval: BotTimeframe, limit: number): Promise<Candle[]> {
  const url = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("interval", interval)
  url.searchParams.set("limit", String(limit))
  const res = await fetch(url.toString(), { cache: "no-store" })
  const json = (await res.json()) as any
  return parseKlines(json)
}

function parseKlines(raw: unknown): Candle[] {
  const data = raw as any
  const rows: any[] =
    Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : []

  const candles: Candle[] = []
  for (const r of rows) {
    if (Array.isArray(r)) {
      const openTime = toNum(r[0])
      const open = toNum(r[1])
      const high = toNum(r[2])
      const low = toNum(r[3])
      const close = toNum(r[4])
      const volume = toNum(r[5])
      if (
        openTime !== null &&
        open !== null &&
        high !== null &&
        low !== null &&
        close !== null &&
        volume !== null
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    } else if (r && typeof r === "object") {
      const openTime = toNum((r as any).time ?? (r as any).openTime)
      const open = toNum((r as any).open)
      const high = toNum((r as any).high)
      const low = toNum((r as any).low)
      const close = toNum((r as any).close)
      const volume = toNum((r as any).volume)
      if (
        openTime !== null &&
        open !== null &&
        high !== null &&
        low !== null &&
        close !== null &&
        volume !== null
      ) {
        candles.push({ openTime, open, high, low, close, volume })
      }
    }
  }

  return candles.sort((a, b) => a.openTime - b.openTime)
}

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function startStateSaver() {
  const tick = async () => {
    await writeJsonAtomic(STATE_PATH, engine).catch(() => undefined)
    await writeJsonAtomic(SCALP_STATE_PATH, buildScalpStateSnapshot()).catch(() => undefined)
    await writeJsonAtomic(SCALP2_STATE_PATH, buildScalp2StateSnapshot()).catch(() => undefined)
    await writeJsonAtomic(SCALP3_STATE_PATH, buildScalp3StateSnapshot()).catch(() => undefined)
    await writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
    await writeJsonAtomic(PUMP2_STATE_PATH, buildPump2StateSnapshot()).catch(() => undefined)
  }
  void tick()
  stateTimer = setInterval(() => void tick(), 5_000)
}

async function writeJsonAtomic(filePath: string, obj: unknown) {
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8")
  await fs.promises.rename(tmp, filePath)
}

async function shutdown(signal: string) {
  if (healthTimer) clearInterval(healthTimer)
  if (stateTimer) clearInterval(stateTimer)
  if (candleTimer) clearInterval(candleTimer)
  if (commandTimer) clearInterval(commandTimer)
  if (scalpScanTimer) clearInterval(scalpScanTimer)
  if (scalpUpdateTimer) clearInterval(scalpUpdateTimer)
  if (scalpCommandTimer) clearInterval(scalpCommandTimer)
  if (scalpSummaryTimer) clearInterval(scalpSummaryTimer)
  if (scalp2ScanTimer) clearInterval(scalp2ScanTimer)
  if (scalp2UpdateTimer) clearInterval(scalp2UpdateTimer)
  if (scalp2CommandTimer) clearInterval(scalp2CommandTimer)
  if (scalp2SummaryTimer) clearInterval(scalp2SummaryTimer)
  if (scalp3ScanTimer) clearInterval(scalp3ScanTimer)
  if (scalp3UpdateTimer) clearInterval(scalp3UpdateTimer)
  if (scalp3CommandTimer) clearInterval(scalp3CommandTimer)
  if (scalp3PendingTimer) clearInterval(scalp3PendingTimer)
  if (pumpScanTimer) clearInterval(pumpScanTimer)
  if (pumpTrailTimer) clearInterval(pumpTrailTimer)
  if (pumpCommandTimer) clearInterval(pumpCommandTimer)
  if (pump2ControlTimer) clearInterval(pump2ControlTimer)
  stopPump2Sockets()
  stopPriceWebSocket()
  await writeJsonAtomic(STATE_PATH, engine).catch(() => undefined)
  await writeJsonAtomic(SCALP_STATE_PATH, buildScalpStateSnapshot()).catch(() => undefined)
  await writeJsonAtomic(SCALP2_STATE_PATH, buildScalp2StateSnapshot()).catch(() => undefined)
  await writeJsonAtomic(SCALP3_STATE_PATH, buildScalp3StateSnapshot()).catch(() => undefined)
  await writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
  await writeJsonAtomic(PUMP2_STATE_PATH, buildPump2StateSnapshot()).catch(() => undefined)
  log(`▶ Bot stopped safely (${signal})`)
  process.exit(0)
}

function startScalpingEngine() {
  reloadScalpEnv()
  engine.scalping.settings = loadScalpSettings()
  engine.scalping.updatedAt = Date.now()

  const scanTick = async () => {
    if (scalpScanInFlight) return
    scalpScanInFlight = true
    try {
    reloadScalpEnv()
    const s = loadScalpSettings()
    engine.scalping.settings = s
    engine.scalping.updatedAt = Date.now()

    applyPaperBalanceFromSettings(s)
    applyDailyLossLock(s)
    if (!s.enabled || s.paused) return
    const newsBlocked = await isScalpNewsBlackoutActive(s).catch(() => false)
    if (newsBlocked) return

    const openGroups = countOpenScalpGroups()
    if (openGroups >= s.maxConcurrent) return

    const today = dayKey(Date.now())
    const todayTrades = countScalpGroupsForDay(today)
    if (todayTrades >= s.maxPerDay) return

    const leaderboard = await scanScalpLeaderboard({
      settings: s,
      fetchKlines: (sym, interval, limit) => fetchScalpKlines(sym, interval, limit),
      fetchOrderbook: (sym) => fetchScalpOrderbook(sym)
    }).catch(() => [])

    engine.scalping.leaderboard = leaderboard.slice(0, 10).map((r) => ({
      symbol: r.symbol,
      score: r.score,
      direction: r.direction,
      pattern: {
        name: r.patternResult?.strongestPattern ?? "No Pattern",
        strength: r.patternResult?.pattern?.strength ?? "NONE",
        reliability: r.patternResult?.pattern?.reliability,
        allowed: r.patternAllowed
      },
      vwapOk: r.vwapOk,
      rsiOk: r.rsiOk,
      volRatio: r.volRatio
    }))

    const best = leaderboard.find((x) => x.score >= s.minScore && x.patternAllowed)
    if (!best) return
    if (hasOpenTradeForSymbol(best.symbol)) return
    await executeScalpTrade(best, s).catch(() => undefined)
    } finally {
      scalpScanInFlight = false
    }
  }

  const updateTick = async () => {
    const s = engine.scalping.settings
    applyDailyLossLock(s)
    if (!s.enabled) return
    const open = engine.scalping.openTrades.filter((t) => t.status === "OPEN")
    if (!open.length) return

    for (const t of open) {
      const price = await fetchLivePrice(t.symbol).catch(() => 0)
      if (!price || price <= 0) continue
      const grossPnl = computePnlUsd(t, price)
      const prevPhase = t.trailing.phase
      const localSettings = await applySmartWickProtection(t, s, grossPnl).catch(() => s)
      const { next, close } = manageScalpTrade(t, price, localSettings)

      Object.assign(t, next)

      if (t.execMode === "paper") {
        const holdingHours = (Date.now() - t.openedAt) / 1000 / 3600
        const fees = calculateFees(t.positionValue, holdingHours)
        const netNow = grossPnl - fees.openFee - fees.closeFee - fees.fundingFee
        t.fees = fees
        t.grossPnlUsd = grossPnl
        t.netPnlUsd = round2(netNow)
        t.pnlUsd = t.netPnlUsd
      } else {
        t.grossPnlUsd = grossPnl
        t.pnlUsd = grossPnl
      }

      if (close) {
        t.closeReason = close.closeReason
        await closeScalpTrade(t, "AUTO", price).catch(() => undefined)
        continue
      }

      if (prevPhase === "INITIAL" && t.trailing.phase === "TRAILING") {
        const worstCase = t.trailing.lockedPnl - s.trailDistance
        const msg = `🎯 <b>[SCALPING 1] TP1 HIT — TRAILING ACTIVE</b>
━━━━━━━━━━━━━━
${t.symbol} ${t.direction}
TP1: +$${s.tp1Amount} reached ✅
Locked: $${t.trailing.lockedPnl.toFixed(2)} profit
Now trailing to $${s.tp2Amount}...
Trail distance: $${s.trailDistance.toFixed(2)}
Worst case now: +$${worstCase.toFixed(2)}
Current: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(2)}`
        await sendTelegram(msg).catch(() => undefined)
      }
      await sendScalpUpdate(t, price).catch(() => undefined)
    }
  }

  const commandTick = async () => {
    const base = String(process.env.SCALPING_COMMAND_URL ?? "http://localhost:3000/api/scalping/command")
    const cmd = await fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)
    const closeTradeId = typeof cmd?.data?.closeTradeId === "string" ? String(cmd.data.closeTradeId) : ""
    const restartScalping = Boolean(cmd?.data?.restartScalping)
    const resetPaperAccountUsd =
      typeof cmd?.data?.resetPaperAccountUsd === "number" && Number.isFinite(cmd.data.resetPaperAccountUsd)
        ? cmd.data.resetPaperAccountUsd
        : undefined

    if (restartScalping) {
      restartScalpingLoops()
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartScalping: false })
      }).catch(() => undefined)
      return
    }

    if (resetPaperAccountUsd !== undefined) {
      resetPaperAccount(resetPaperAccountUsd)
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPaperAccountUsd: null })
      }).catch(() => undefined)
      return
    }
    if (!closeTradeId) return
    const trade = engine.scalping.openTrades.find((t) => t.id === closeTradeId && t.status === "OPEN")
    if (trade) {
      const groupId = trade.groupId
      const group = engine.scalping.openTrades.filter((t) => t.status === "OPEN" && t.groupId === groupId)
      for (const t of group) {
        const price = await fetchLivePrice(t.symbol).catch(() => t.entryPrice)
        await closeScalpTrade(t, "MANUAL", price).catch(() => undefined)
      }
    }
    await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeTradeId: "" })
    }).catch(() => undefined)
  }

  const summaryTick = async () => {
    const s = engine.scalping.settings
    if (!s.enabled) return
    const key = hourKey(Date.now())
    if (engine.scalping.lastHourKey === key) return
    engine.scalping.lastHourKey = key
    const { trades, wins, losses, totalPnl, best, open } = computeScalpHourSummary(key)
    if (trades === 0 && open === 0) return
    const msg = `📊 <b>[SCALPING 1] HOUR SUMMARY</b>
━━━━━━━━━━━━━━
Trades: ${trades} | W:${wins} L:${losses}
PnL: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}
Best: ${best ? `${best.symbol} ${best.pnlUsd !== undefined && best.pnlUsd >= 0 ? "+" : ""}$${(best.pnlUsd ?? 0).toFixed(2)}` : "—"}
Open: ${open} trade`
    await sendTelegram(msg).catch(() => undefined)
  }

  void scanTick()
  scalpScanTimer = setInterval(() => void scanTick(), 60_000)
  scalpUpdateTimer = setInterval(() => void updateTick(), 30_000)
  scalpCommandTimer = setInterval(() => void commandTick(), 3_000)
  scalpSummaryTimer = setInterval(() => void summaryTick(), 60_000)
}

function startScalping2Engine() {
  reloadScalp2Env()
  engine.scalping2.settings = loadScalp2Settings()
  engine.scalping2.updatedAt = Date.now()

  const scanTick = async () => {
    if (scalp2ScanInFlight) return
    scalp2ScanInFlight = true
    try {
      reloadScalp2Env()
      const s = loadScalp2Settings()
      engine.scalping2.settings = s
      engine.scalping2.updatedAt = Date.now()

      applyPaper2BalanceFromSettings(s)
      applyDailyLossLock2(s)
      if (!s.enabled || s.paused) return
      const newsBlocked = await isScalp2NewsBlackoutActive(s).catch(() => false)
      if (newsBlocked) return

      const openGroups = countOpenScalp2Groups()
      if (openGroups >= s.maxConcurrent) return

      const today = dayKey(Date.now())
      const todayTrades = countScalp2GroupsForDay(today)
      if (todayTrades >= s.maxPerDay) return

      const leaderboard = await scanScalp2Leaderboard({
        settings: s,
        fetchKlines: (sym, interval, limit) => fetchScalpKlines(sym, interval, limit)
      }).catch(() => [])

      engine.scalping2.leaderboard = leaderboard.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        score: r.score,
        direction: r.direction,
        pattern: { name: "Checklist", strength: "NONE", allowed: true },
        vwapOk: r.vwapOk,
        rsiOk: r.rsiOk,
        volRatio: r.volRatio
      }))

      const best = leaderboard.find((x) => x.score >= s.minScore)
      if (!best) return
      if (hasOpenScalp2TradeForSymbol(best.symbol)) return
      await executeScalp2Trade(best, s).catch(() => undefined)
    } finally {
      scalp2ScanInFlight = false
    }
  }

  const updateTick = async () => {
    const s = engine.scalping2.settings
    applyDailyLossLock2(s)
    if (!s.enabled) return
    const open = engine.scalping2.openTrades.filter((t) => t.status === "OPEN")
    if (!open.length) return

    for (const t of open) {
      const price = await fetchLivePrice(t.symbol).catch(() => 0)
      if (!price || price <= 0) continue
      const grossPnl = computePnlUsd(t, price)
      const prevPhase = t.trailing.phase
      const localSettings = await applySmartWickProtection2(t, s, grossPnl).catch(() => s)
      const { next, close } = manageScalpTrade(t, price, localSettings as unknown as ScalpSettings)

      Object.assign(t, next)

      if (t.execMode === "paper") {
        const holdingHours = (Date.now() - t.openedAt) / 1000 / 3600
        const fees = calculateFees(t.positionValue, holdingHours)
        const netNow = grossPnl - fees.openFee - fees.closeFee - fees.fundingFee
        t.fees = fees
        t.grossPnlUsd = grossPnl
        t.netPnlUsd = round2(netNow)
        t.pnlUsd = t.netPnlUsd
      } else {
        t.grossPnlUsd = grossPnl
        t.pnlUsd = grossPnl
      }

      if (close) {
        t.closeReason = close.closeReason
        await closeScalp2Trade(t, "AUTO", price).catch(() => undefined)
        continue
      }

      if (prevPhase === "INITIAL" && t.trailing.phase === "TRAILING") {
        const worstCase = t.trailing.lockedPnl - s.trailDistance
        const msg = `🎯 <b>[SCALPING 2] TP1 HIT — TRAILING ACTIVE</b>
━━━━━━━━━━━━━━
${t.symbol} ${t.direction}
TP1: +$${s.tp1Amount} reached ✅
Locked: $${t.trailing.lockedPnl.toFixed(2)} profit
Now trailing to $${s.tp2Amount}...
Trail distance: $${s.trailDistance.toFixed(2)}
Worst case now: +$${worstCase.toFixed(2)}
Current: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(2)}`
        await sendTelegram(msg).catch(() => undefined)
      }

      await sendScalp2Update(t, price).catch(() => undefined)
    }
  }

  const commandTick = async () => {
    const base = String(process.env.SCALPING2_COMMAND_URL ?? "http://localhost:3000/api/scalping2/command")
    const cmd = await fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)
    const closeTradeId = typeof cmd?.data?.closeTradeId === "string" ? String(cmd.data.closeTradeId) : ""
    const restartScalping2 = Boolean(cmd?.data?.restartScalping2)
    const resetPaperAccountUsd =
      typeof cmd?.data?.resetPaperAccountUsd === "number" && Number.isFinite(cmd.data.resetPaperAccountUsd)
        ? cmd.data.resetPaperAccountUsd
        : undefined

    if (restartScalping2) {
      restartScalping2Loops()
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartScalping2: false })
      }).catch(() => undefined)
      return
    }

    if (resetPaperAccountUsd !== undefined) {
      resetPaperAccount2(resetPaperAccountUsd)
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPaperAccountUsd: null })
      }).catch(() => undefined)
      return
    }

    if (!closeTradeId) return
    const trade = engine.scalping2.openTrades.find((t) => t.id === closeTradeId && t.status === "OPEN")
    if (trade) {
      const groupId = trade.groupId
      const group = engine.scalping2.openTrades.filter((t) => t.status === "OPEN" && t.groupId === groupId)
      for (const t of group) {
        const price = await fetchLivePrice(t.symbol).catch(() => t.entryPrice)
        await closeScalp2Trade(t, "MANUAL", price).catch(() => undefined)
      }
    }
    await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeTradeId: "" })
    }).catch(() => undefined)
  }

  const summaryTick = async () => {
    const s = engine.scalping2.settings
    if (!s.enabled) return
    const key = hourKey(Date.now())
    if (engine.scalping2.lastHourKey === key) return
    engine.scalping2.lastHourKey = key
    const { trades, wins, losses, totalPnl, best, open } = computeScalp2HourSummary(key)
    if (trades === 0 && open === 0) return
    const msg = `📊 <b>[SCALPING 2] HOUR SUMMARY</b>
━━━━━━━━━━━━━━
Trades: ${trades} | W:${wins} L:${losses}
PnL: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}
Best: ${best ? `${best.symbol} ${best.pnlUsd !== undefined && best.pnlUsd >= 0 ? "+" : ""}$${(best.pnlUsd ?? 0).toFixed(2)}` : "—"}
Open: ${open} trade`
    await sendTelegram(msg).catch(() => undefined)
  }

  void scanTick()
  scalp2ScanTimer = setInterval(() => void scanTick(), 60_000)
  scalp2UpdateTimer = setInterval(() => void updateTick(), 30_000)
  scalp2CommandTimer = setInterval(() => void commandTick(), 3_000)
  scalp2SummaryTimer = setInterval(() => void summaryTick(), 60_000)
}

function startScalping3Engine() {
  reloadScalp3Env()
  engine.scalping3.settings = loadScalp3Settings()
  engine.scalping3.updatedAt = Date.now()

  const scanTick = async () => {
    if (scalp3ScanInFlight) return
    scalp3ScanInFlight = true
    try {
      reloadScalp3Env()
      const s = loadScalp3Settings()
      engine.scalping3.settings = s
      engine.scalping3.updatedAt = Date.now()

      if (!s.enabled || s.paused) return
      if (engine.scalping3.pending) return
      if (engine.scalping3.openTrades.some((t) => t.status === "OPEN")) return
      if (engine.scalping3.skipOnce) {
        engine.scalping3.skipOnce = false
        return
      }

      const today = dayKey(Date.now())
      const todayTrades = engine.scalping3.closedTrades.filter((t) => (t.openedAt ? dayKey(t.openedAt) === today : false)).length
      if (todayTrades >= s.maxPerDay) return

      const { signal, summary } = await runScalping3Scan(s, (sym, interval, limit) => fetchScalp3Klines(sym, interval, limit)).catch(
        () => ({ signal: null, summary: { scanned: s.enabledSymbols.length, smcValid: 0, volumeConfirmed: 0, reason: "Scan error", nextScanMinutes: 5 } })
      )

      engine.scalping3.lastScan = {
        at: Date.now(),
        session: signal?.sessionData?.currentSession ? String(signal.sessionData.currentSession) : "LONDON_NY_OVERLAP",
        scanned: summary.scanned,
        smcValid: summary.smcValid,
        volumeConfirmed: summary.volumeConfirmed,
        reason: summary.reason
      }

      if (!signal) {
        await sendScalp3NoSignalTelegram(engine.scalping3.lastScan).catch(() => undefined)
        return
      }

      scheduleScalp3Trade(signal, s)
    } finally {
      scalp3ScanInFlight = false
    }
  }

  const updateTick = async () => {
    const open = engine.scalping3.openTrades.filter((t) => t.status === "OPEN")
    if (!open.length) return
    for (const t of open) {
      const price = await fetchLivePrice(t.symbol).catch(() => t.entryPrice)
      const gross = computeScalp3PnlUsd(t, price)

      if (t.execMode === "paper") {
        const holdingHours = (Date.now() - t.openedAt) / 1000 / 3600
        const feesNow = calculateFees(t.positionValue, holdingHours)
        const openFee = t.fees?.openFee ?? 0
        const paidClose = t.feesPaidCloseUsd ?? 0
        const paidFunding = t.feesPaidFundingUsd ?? 0
        const closeFee = paidClose + feesNow.closeFee
        const fundingFee = paidFunding + feesNow.fundingFee
        const totalFee = openFee + closeFee + fundingFee
        const netNow = gross - totalFee
        t.fees = { openFee, closeFee, fundingFee, totalFee }
        t.grossPnlUsd = gross
        t.netPnlUsd = round2(netNow)
        t.pnlUsd = t.netPnlUsd
      } else {
        t.grossPnlUsd = gross
        t.pnlUsd = gross
      }

      const hitSl = t.direction === "LONG" ? price <= t.slPrice : price >= t.slPrice
      if (hitSl) {
        await closeScalp3Trade(t, "AUTO", "SL_HIT", price).catch(() => undefined)
        continue
      }

      if (t.tp2Price && (t.tpStage ?? 1) === 1) {
        const tp1 = t.tp1Price ?? t.tpPrice
        const hitTp1 = t.direction === "LONG" ? price >= tp1 : price <= tp1
        if (hitTp1) {
          await partialCloseScalp3AtTp1(t, tp1).catch(() => undefined)
        }
        continue
      }

      const hitTp = t.direction === "LONG" ? price >= t.tpPrice : price <= t.tpPrice
      if (hitTp) {
        await closeScalp3Trade(t, "AUTO", "TP_HIT", price).catch(() => undefined)
      }
    }
  }

  const commandTick = async () => {
    const base = String(process.env.SCALPING3_COMMAND_URL ?? "http://localhost:3000/api/scalping3/command")
    const cmd = await fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)
    const closeTradeId = typeof cmd?.data?.closeTradeId === "string" ? String(cmd.data.closeTradeId) : ""
    const restartScalping3 = Boolean(cmd?.data?.restartScalping3)
    const skipOnce = Boolean(cmd?.data?.skipOnce)
    const resetPaperAccountUsd =
      typeof cmd?.data?.resetPaperAccountUsd === "number" && Number.isFinite(cmd.data.resetPaperAccountUsd)
        ? cmd.data.resetPaperAccountUsd
        : undefined

    if (restartScalping3) {
      restartScalping3Loops()
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartScalping3: false })
      }).catch(() => undefined)
      return
    }

    if (skipOnce) {
      cancelPendingScalp3Trade()
      engine.scalping3.skipOnce = true
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipOnce: false })
      }).catch(() => undefined)
      return
    }

    if (resetPaperAccountUsd !== undefined) {
      resetPaperAccount3(resetPaperAccountUsd)
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPaperAccountUsd: null })
      }).catch(() => undefined)
      return
    }

    if (!closeTradeId) return
    const trade = engine.scalping3.openTrades.find((t) => t.id === closeTradeId && t.status === "OPEN")
    if (trade) {
      const price = await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
      await closeScalp3Trade(trade, "MANUAL", "MANUAL", price).catch(() => undefined)
    }
    await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeTradeId: "" })
    }).catch(() => undefined)
  }

  const pendingTick = async () => {
    const p = engine.scalping3.pending
    if (!p) return
    if (Date.now() < p.dueAt) return
    reloadScalp3Env()
    const s = loadScalp3Settings()
    engine.scalping3.settings = s
    engine.scalping3.updatedAt = Date.now()
    if (!s.enabled || s.paused) {
      cancelPendingScalp3Trade()
      return
    }
    if (engine.scalping3.openTrades.some((t) => t.status === "OPEN")) {
      cancelPendingScalp3Trade()
      return
    }
    const today = dayKey(Date.now())
    const todayTrades = engine.scalping3.closedTrades.filter((t) => (t.openedAt ? dayKey(t.openedAt) === today : false)).length
    if (todayTrades >= s.maxPerDay) {
      cancelPendingScalp3Trade()
      return
    }
    engine.scalping3.pending = undefined
    await executeScalp3Trade(p.signal, s).catch(() => undefined)
  }

  void scanTick()
  scalp3ScanTimer = setInterval(() => void scanTick(), 5 * 60_000)
  scalp3UpdateTimer = setInterval(() => void updateTick(), 10_000)
  scalp3CommandTimer = setInterval(() => void commandTick(), 2_000)
  scalp3PendingTimer = setInterval(() => void pendingTick(), 1_000)
}

function startPumpEngine() {
  reloadPumpEnv()
  engine.pump.settings = loadPumpSettings()
  engine.pump.updatedAt = Date.now()

  const scanTick = async () => {
    if (pumpScanInFlight) return
    pumpScanInFlight = true
    try {
      reloadPumpEnv()
      const s = loadPumpSettings()
      engine.pump.settings = s
      engine.pump.updatedAt = Date.now()
      if (!s.enabled) return

      prunePumpState()

      const open = engine.pump.openTrades.filter((t) => t.status === "OPEN")
      if (open.length >= s.maxConcurrentPumps) return
      if (countPumpTradesLastHour() >= s.maxPumpsPerHour) return

      const pumps = await scanAllCoinsForPump().catch(() => [])
      if (!pumps.length) return

      for (const pump of pumps) {
        if (s.blacklistedCoins.includes(pump.symbol)) continue
        if (isPumpOnCooldown(pump.symbol)) continue
        if (open.find((t) => t.symbol === pump.symbol)) continue

        const levelEnabled = {
          LOW: s.tradeLow,
          MEDIUM: s.tradeMedium,
          HIGH: s.tradeHigh,
          EXTREME: s.tradeExtreme
        }[pump.pumpLevel]

        if (!levelEnabled) {
          recordRecentPump(pump, "ALERT")
          if (pump.pumpLevel === "LOW") {
            const msg = `🟡 <b>[PUMP ALERT 1] ALERT ONLY</b>\n${pump.symbol}: +${pump.priceChange5m}% in 5m\nVol: ${pump.volumeRatio}x\nConf: ${pump.confidence}%`
            await sendTelegram(msg).catch(() => undefined)
          }
          continue
        }

        if (pump.confidence < s.minConfidence) continue

        recordRecentPump(pump, "SHORT")
        await executePumpShort(pump, s).catch(() => undefined)
        break
      }
    } finally {
      pumpScanInFlight = false
    }
  }

  const trailingTick = async () => {
    const s = engine.pump.settings
    if (!s.enabled) return
    const open = engine.pump.openTrades.filter((t) => t.status === "OPEN")
    if (!open.length) return

    for (const t of open) {
      const price = await fetchLivePrice(t.symbol).catch(() => 0)
      if (!price || price <= 0) continue
      t.currentPrice = price
      t.pnlPercent = ((t.entryPrice - price) / t.entryPrice) * 100

      const levelSettings = s.levels[t.pumpLevel]
      const shouldTrail = t.source === "PUMP2" ? Boolean(t.trailing.enabled) : Boolean(levelSettings.trailingEnabled)

      if (price >= t.slPrice) {
        await closePumpTrade(t, price, "SL_HIT").catch(() => undefined)
        continue
      }

      if (t.source === "PUMP2") {
        const grossPnlUsd = t.positionValue * ((t.pnlPercent ?? 0) / 100)

        if (price <= t.tpPrice) {
          await closePumpTrade(t, price, "TP_HIT").catch(() => undefined)
          continue
        }

        if (shouldTrail) {
          const activateAtUsd = Number(t.trailing.activateAt)
          if (!t.trailing.active) {
            if (Number.isFinite(activateAtUsd) && activateAtUsd > 0 && Number.isFinite(grossPnlUsd) && grossPnlUsd >= activateAtUsd) {
              t.trailing.active = true
              t.phase = "TRAIL"
              t.trailing.bestPrice = price
              t.trailing.bestPnlUsd = grossPnlUsd
              await sendTelegram(
                `📉 <b>[PUMP ALERT 2] PROFIT TRAILING ACTIVE</b>\n${t.symbol} SHORT\nLocked: +$${grossPnlUsd.toFixed(2)}\nTrail distance: $${Number(t.trailing.distance).toFixed(2)}`
              ).catch(() => undefined)
            }
          } else {
            if (price < t.trailing.bestPrice) t.trailing.bestPrice = price
            if (Number.isFinite(grossPnlUsd)) t.trailing.bestPnlUsd = Math.max(t.trailing.bestPnlUsd ?? 0, grossPnlUsd)
            const distUsd = Number(t.trailing.distance)
            const best = Number(t.trailing.bestPnlUsd ?? 0)
            if (!Number.isFinite(distUsd) || distUsd <= 0) continue
            if (!Number.isFinite(best) || best <= 0) continue
            const locked = best - distUsd
            if (Number.isFinite(grossPnlUsd) && grossPnlUsd <= locked) {
              await closePumpTrade(t, price, "TRAIL_STOP").catch(() => undefined)
              continue
            }
          }
        }

        continue
      }

      if (price <= t.tpPrice) {
        if (shouldTrail) {
          if (!t.trailing.active) {
            t.trailing.active = true
            t.phase = "TRAIL"
            t.trailing.bestPrice = price
            const tag = "PUMP ALERT 1"
            await sendTelegram(
              `📉 <b>[${tag}] TP HIT — TRAILING ACTIVE</b>\n${t.symbol} SHORT\nTP reached: -${levelSettings.tpPercent}%\nTrail: ${levelSettings.trailingDistance}%`
            ).catch(() => undefined)
          }
        } else {
          await closePumpTrade(t, price, "TP_HIT").catch(() => undefined)
          continue
        }
      }

      if (t.trailing.active) {
        if (price < t.trailing.bestPrice) t.trailing.bestPrice = price
        const trailStop = t.trailing.bestPrice * (1 + levelSettings.trailingDistance / 100)
        if (price >= trailStop) {
          await closePumpTrade(t, price, "TRAIL_STOP").catch(() => undefined)
          continue
        }
      }
    }
  }

  const commandTick = async () => {
    const base = String(process.env.PUMP_COMMAND_URL ?? "http://localhost:3000/api/pump/command")
    const cmd = await fetch(base, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)
    const closeTradeId = typeof cmd?.data?.closeTradeId === "string" ? String(cmd.data.closeTradeId) : ""
    const restartPump = Boolean(cmd?.data?.restartPump)
    const resetPumpLogs = Boolean(cmd?.data?.resetPumpLogs)

    if (resetPumpLogs) {
      resetPumpLogsData()
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPumpLogs: false })
      }).catch(() => undefined)
      return
    }

    if (restartPump) {
      restartPumpLoops()
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restartPump: false })
      }).catch(() => undefined)
      return
    }

    if (!closeTradeId) return
    const trade = engine.pump.openTrades.find((t) => t.id === closeTradeId && t.status === "OPEN")
    if (trade) {
      const price = await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
      await closePumpTrade(trade, price, "MANUAL").catch(() => undefined)
    }
    await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closeTradeId: "" })
    }).catch(() => undefined)
  }

  void scanTick()
  pumpScanTimer = setInterval(() => void scanTick(), 60_000)
  pumpTrailTimer = setInterval(() => void trailingTick(), 10_000)
  pumpCommandTimer = setInterval(() => void commandTick(), 3_000)
}

function restartPumpLoops() {
  if (pumpScanTimer) clearInterval(pumpScanTimer)
  if (pumpTrailTimer) clearInterval(pumpTrailTimer)
  if (pumpCommandTimer) clearInterval(pumpCommandTimer)
  pumpScanTimer = null
  pumpTrailTimer = null
  pumpCommandTimer = null
  startPumpEngine()
}

function resetPumpLogsData() {
  engine.pump.closedTrades = []
  engine.pump.recentPumps = []
  engine.pump.cooldowns = {}

  engine.pump2.alerts = []
  engine.pump2.debounce = {}
  engine.pump2.pairsCount = 0
  engine.pump2.lastCheckAt = undefined

  void writeJsonAtomic(STATE_PATH, engine).catch(() => undefined)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
  void writeJsonAtomic(PUMP2_STATE_PATH, buildPump2StateSnapshot()).catch(() => undefined)
}

function startPump2Engine() {
  reloadPump2Env()
  engine.pump2.settings = loadPump2Settings()
  engine.pump2.updatedAt = Date.now()

  const controlTick = async () => {
    if (pump2ControlInFlight) return
    pump2ControlInFlight = true
    try {
      reloadPump2Env()
      const s = loadPump2Settings()
      engine.pump2.settings = s
      engine.pump2.updatedAt = Date.now()

      if (!s.enabled) {
        stopPump2Sockets()
        return
      }

      const now = Date.now()
      const refreshMs = 5 * 60 * 1000
      if (!pump2Runtime.lastPairsRefreshAt || now - pump2Runtime.lastPairsRefreshAt >= refreshMs) {
        pump2Runtime.lastPairsRefreshAt = now
        const pairs = await fetchPump2Pairs(s.minVolumeUsd).catch(() => [])
        engine.pump2.pairsCount = pairs.length
        const key = hashSymbolList(pairs)
        if (key && key !== pump2Runtime.symbolsKey) {
          pump2Runtime.symbols = pairs
          pump2Runtime.symbolsKey = key
          restartPump2Sockets()
        } else if (!pump2Runtime.started) {
          pump2Runtime.symbols = pairs
          pump2Runtime.symbolsKey = key
          restartPump2Sockets()
        }
      } else if (!pump2Runtime.started) {
        restartPump2Sockets()
      }
    } finally {
      pump2ControlInFlight = false
    }
  }

  void controlTick()
  pump2ControlTimer = setInterval(() => void controlTick(), 10_000)
}

function stopPump2Sockets() {
  pump2Runtime.started = false
  for (const ws of pump2Runtime.sockets) {
    try {
      ws.close()
    } catch {
      continue
    }
  }
  pump2Runtime.sockets = []
}

function restartPump2Sockets() {
  stopPump2Sockets()
  const symbols = pump2Runtime.symbols
  if (!symbols.length) return
  pump2Runtime.started = true

  const batches: string[][] = []
  const maxPerConn = 180
  for (let i = 0; i < symbols.length; i += maxPerConn) {
    batches.push(symbols.slice(i, i + maxPerConn))
  }

  for (const batch of batches) {
    const ws = new WebSocket("wss://open-api-swap.bingx.com/swap-market")
    pump2Runtime.sockets.push(ws)

    ws.on("open", () => {
      for (const sym of batch) {
        ws.send(JSON.stringify({ id: `pump2-${sym}-${Date.now()}`, reqType: "sub", dataType: `${sym}@ticker` }))
      }
    })

    ws.on("message", (data) => {
      const text = decodeWsPayload(data)
      if (!text) return
      if (text === "Ping") {
        ws.send("Pong")
        return
      }
      const msg = safeJson(text)
      if (!msg) return
      const row = (msg as any).data ?? (msg as any).tick ?? msg
      const symRaw = String((msg as any).symbol ?? (msg as any).dataType?.split?.("@")?.[0] ?? row?.symbol ?? "")
      const sym = symRaw ? symRaw.toUpperCase() : ""
      if (!sym || !sym.endsWith("USDT") || sym.includes("_")) return
      const symbol = sym.includes("-") ? sym : `${sym.slice(0, -4)}-USDT`
      const price = Number(row?.lastPrice ?? row?.last ?? row?.price ?? row?.c ?? row?.close)
      const vol = Number(row?.quoteVolume ?? row?.q ?? row?.vol ?? row?.v)
      if (!Number.isFinite(price) || price <= 0) return
      if (!Number.isFinite(vol) || vol < 0) return
      onPump2Ticker(symbol, price, vol)
    })

    const retry = () => {
      if (!pump2Runtime.started) return
      const now = Date.now()
      if (now < pump2Runtime.reconnectAt) return
      pump2Runtime.reconnectAt = now + 2000
      setTimeout(() => {
        if (pump2Runtime.started) restartPump2Sockets()
      }, 1500)
    }

    ws.on("close", retry)
    ws.on("error", retry)
  }
}

function decodeWsPayload(data: WebSocket.RawData): string {
  try {
    const buf =
      typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.isBuffer(data) ? data : Buffer.from(data as any)
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf as any).toString("utf8")
    return buf.toString("utf8")
  } catch {
    return ""
  }
}

function safeJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function onPump2Ticker(symbol: string, price: number, quoteVol: number) {
  const now = Date.now()
  engine.pump2.lastCheckAt = now
  const s = engine.pump2.settings
  if (!s.enabled) return

  const lastSampleAt = pump2Runtime.lastSampleAt.get(symbol) ?? 0
  const shouldSample = now - lastSampleAt >= 60_000
  if (!shouldSample) return
  pump2Runtime.lastSampleAt.set(symbol, now)

  const arr = pump2Runtime.history.get(symbol) ?? []
  arr.push({ ts: now, price, vol: quoteVol })
  while (arr.length > 800) arr.shift()
  pump2Runtime.history.set(symbol, arr)

  void handlePump2Sample(symbol, arr, s).catch(() => undefined)
}

async function handlePump2Sample(symbol: string, history: Pump2Point[], s: Pump2Settings) {
  const alert = await detectPump2(symbol, history, s).catch(() => null)
  if (!alert) return

  const now = Date.now()
  engine.pump2.alerts.unshift(alert)
  engine.pump2.alerts = engine.pump2.alerts.slice(0, 500)
  engine.pump2.debounce[symbol] = now
  void writeJsonAtomic(PUMP2_STATE_PATH, buildPump2StateSnapshot()).catch(() => undefined)

  const msg = `🚨 <b>[PUMP ALERT 2] ${alert.confidence}</b>
${alert.symbol}
Price: $${alert.price.toFixed(6)}
Move: +${alert.pctChange.toFixed(2)}% | Vol: ${alert.volumeMultiplier.toFixed(2)}x
RSI: ${typeof alert.rsi === "number" ? alert.rsi.toFixed(1) : "—"}
MTC: ${typeof alert.mtcScore === "number" ? alert.mtcScore : "—"}`
  void sendTelegram(msg).catch(() => undefined)

  const trade = engine.pump2.settings.trade
  if (!trade?.enabled) return
  void tryExecutePump2Short(alert, history, trade).catch(() => undefined)
}

async function detectPump2(symbol: string, history: Pump2Point[], s: Pump2Settings): Promise<Pump2Alert | null> {
  if (history.length < 7) return null
  const now = history[history.length - 1]!
  if (now.vol < s.minVolumeUsd) return null
  const lastAlertAt = engine.pump2.debounce[symbol] ?? 0
  if (lastAlertAt && Date.now() - lastAlertAt < s.debounceMinutes * 60_000) return null

  for (const level of ["EXTREME", "HIGH", "MEDIUM", "LOW"] as const) {
    const cfg = s.levels[level]
    if (!cfg.enabled) continue
    const priceAgo = priceNMinutesAgo(history, cfg.timeframeMin)
    if (!priceAgo || priceAgo <= 0) continue
    const pctChange = ((now.price - priceAgo) / priceAgo) * 100
    if (Math.abs(pctChange) < s.minPriceChangeAbs) continue
    if (pctChange < cfg.pct) continue

    const mtc = checkPump2Mtc(history, now.price, s)
    if (!mtc.confirmed) continue

    const volumeRatio = await getPump2VolumeRatio(symbol).catch(() => 0)
    if (volumeRatio < cfg.volX) continue

    const rsi = calcRsi14(history.map((p) => p.price))
    const chg5m = pctChangeFor(history, 5)
    const chg10m = pctChangeFor(history, 10)
    const chg1h = pctChangeFor(history, 60)
    const chg4h = pctChangeFor(history, 240)
    const chg12h = pctChangeFor(history, 720)

    return {
      id: `pump2-${symbol}-${Date.now()}`,
      symbol,
      price: now.price,
      pctChange,
      volumeMultiplier: volumeRatio,
      confidence: level,
      rsi,
      chg5m,
      chg10m,
      chg1h,
      chg4h,
      chg12h,
      mtcScore: mtc.score,
      timestamp: Date.now()
    }
  }
  return null
}

async function getPump2VolumeRatio(symbol: string): Promise<number> {
  const cached = pump2Runtime.volRatioCache.get(symbol)
  const now = Date.now()
  if (cached && now - cached.at < 60_000) return cached.ratio

  const candles = await fetchCandles(symbol, "1m", 30).catch(() => [])
  if (candles.length < 20) return 0
  const current = candles[candles.length - 1]
  if (!current) return 0
  const avg =
    candles
      .slice(-20, -1)
      .reduce((sum, c) => sum + (Number.isFinite(c.volume) ? c.volume : 0), 0) / 19
  const ratio = avg > 0 ? current.volume / avg : 0
  const normalized = Number.isFinite(ratio) && ratio > 0 ? ratio : 0
  pump2Runtime.volRatioCache.set(symbol, { at: now, ratio: normalized })
  return normalized
}

async function tryExecutePump2Short(alert: Pump2Alert, history: Pump2Point[], trade: Pump2Settings["trade"]) {
  const limits = engine.pump.settings
  const open = engine.pump.openTrades.filter((t) => t.status === "OPEN")
  if (open.length >= limits.maxConcurrentPumps) return
  if (countPumpTradesLastHour() >= limits.maxPumpsPerHour) return

  if (limits.blacklistedCoins.includes(alert.symbol)) return
  if (isPumpOnCooldown(alert.symbol)) return
  if (open.find((t) => t.symbol === alert.symbol)) return

  const pump = buildPumpFromPump2(alert, history)
  recordRecentPump(pump, "SHORT")
  await executePump2Trade(pump, trade)
}

function buildPumpFromPump2(alert: Pump2Alert, history: Pump2Point[]): PumpDetection {
  const roundN = (n: number, dp: number) => {
    if (!Number.isFinite(n)) return 0
    const k = 10 ** dp
    return Math.round(n * k) / k
  }
  const priceChange1m = pctChangeFor(history, 1) ?? 0
  const priceChange5m = pctChangeFor(history, 5) ?? alert.pctChange
  const priceChange15m = pctChangeFor(history, 15) ?? 0
  const base =
    alert.confidence === "EXTREME" ? 95 : alert.confidence === "HIGH" ? 90 : alert.confidence === "MEDIUM" ? 80 : 70
  const mtcBonus = typeof alert.mtcScore === "number" ? Math.min(10, alert.mtcScore * 2) : 0
  const confidence = Math.max(0, Math.min(100, Math.round(base + mtcBonus)))

  return {
    symbol: alert.symbol,
    currentPrice: alert.price,
    priceChange1m: roundN(priceChange1m, 3),
    priceChange5m: roundN(priceChange5m, 3),
    priceChange15m: roundN(priceChange15m, 3),
    volumeRatio: roundN(alert.volumeMultiplier, 2),
    pumpLevel: alert.confidence,
    confidence,
    shortEntry: alert.price,
    suggestedTP: 0,
    suggestedSL: 0,
    detectedAt: alert.timestamp
  }
}

function checkPump2Mtc(history: Pump2Point[], currentPrice: number, s: Pump2Settings): { confirmed: boolean; score: number } {
  if (!s.mtcEnabled) return { confirmed: true, score: 0 }
  const baseline = s.levels.LOW.pct
  let score = 0
  let available = 0
  for (const tf of s.mtcTimeframes) {
    const priceAgo = priceNMinutesAgo(history, tf)
    if (!priceAgo || priceAgo <= 0) continue
    available += 1
    const pct = ((currentPrice - priceAgo) / priceAgo) * 100
    if (pct >= baseline) score += 1
  }
  const required = Math.min(s.mtcMinConfirmations, available || 0)
  return { confirmed: required === 0 ? true : score >= required, score }
}

function calcPump2VolumeSpike(history: Pump2Point[]): number {
  const perMin: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!
    const cur = history[i]!
    const dv = cur.vol - prev.vol
    if (Number.isFinite(dv) && dv > 0) perMin.push(dv)
  }
  if (perMin.length < 6) return 0
  const recent = perMin.slice(-5)
  const baseline = perMin.slice(Math.max(0, perMin.length - 35), Math.max(0, perMin.length - 5))
  const avgRecent = recent.reduce((s, n) => s + n, 0) / Math.max(1, recent.length)
  const avgBase = baseline.reduce((s, n) => s + n, 0) / Math.max(1, baseline.length)
  if (!avgBase || avgBase <= 0) return 0
  return avgRecent / avgBase
}

function priceNMinutesAgo(history: Pump2Point[], minutes: number): number | null {
  const target = Date.now() - minutes * 60_000
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i]!
    if (p.ts <= target) return p.price
  }
  return null
}

function pctChangeFor(history: Pump2Point[], minutes: number): number | null {
  const last = history[history.length - 1]
  if (!last) return null
  const ago = priceNMinutesAgo(history, minutes)
  if (!ago || ago <= 0) return null
  return ((last.price - ago) / ago) * 100
}

function calcRsi14(prices: number[]): number | null {
  if (prices.length < 15) return null
  const last15 = prices.slice(-15)
  let gains = 0
  let losses = 0
  for (let i = 1; i < last15.length; i++) {
    const diff = last15[i]! - last15[i - 1]!
    if (diff > 0) gains += diff
    else losses += -diff
  }
  const avgGain = gains / 14
  const avgLoss = losses / 14
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function hashSymbolList(symbols: string[]): string {
  if (!symbols.length) return ""
  let h = 2166136261
  for (const s of symbols) {
    for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619
    h = (h ^ 124) * 16777619
  }
  return String(h >>> 0)
}

async function fetchPump2Pairs(minVolumeUsd: number): Promise<string[]> {
  const url = `https://open-api.bingx.com/openApi/swap/v2/quote/ticker?timestamp=${Date.now()}`
  const res = await fetch(url, { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const data = Array.isArray(json?.data) ? json.data : []
  const pairs: string[] = []
  for (const row of data) {
    const sym = String(row?.symbol ?? row?.s ?? "")
    if (!sym || !sym.endsWith("USDT")) continue
    if (sym.includes("_")) continue
    void minVolumeUsd
    pairs.push(sym.includes("-") ? sym.toUpperCase() : `${sym.slice(0, -4)}-USDT`.toUpperCase())
  }
  return pairs
}

function prunePumpState() {
  const now = Date.now()
  const hourMs = 60 * 60 * 1000
  engine.pump.recentPumps = engine.pump.recentPumps.filter((p) => now - p.detectedAt <= hourMs).slice(0, 500)
  for (const [sym, exp] of Object.entries(engine.pump.cooldowns)) {
    if (!Number.isFinite(exp) || exp <= now) delete engine.pump.cooldowns[sym]
  }
  engine.pump.closedTrades = engine.pump.closedTrades.slice(0, 500)
}

function recordRecentPump(pump: PumpDetection, action: "ALERT" | "SHORT") {
  const key = `${pump.symbol}:${pump.detectedAt}:${action}`
  const existing = engine.pump.recentPumps[0] as any
  const existingKey =
    existing && typeof existing === "object" ? `${String(existing.symbol)}:${Number(existing.detectedAt)}:${String(existing.action ?? "")}` : ""
  if (existingKey === key) return
  engine.pump.recentPumps.unshift({ ...pump, action })
}

function countPumpTradesLastHour(): number {
  const now = Date.now()
  const since = now - 60 * 60 * 1000
  const closed = engine.pump.closedTrades.filter((t) => t.openedAt >= since)
  const open = engine.pump.openTrades.filter((t) => t.openedAt >= since)
  const ids = new Set<string>()
  for (const t of [...closed, ...open]) ids.add(t.id)
  return ids.size
}

function isPumpOnCooldown(symbol: string): boolean {
  const exp = engine.pump.cooldowns[symbol]
  return typeof exp === "number" && Number.isFinite(exp) && Date.now() < exp
}

function addPumpCooldown(symbol: string, minutes: number) {
  const ms = Math.max(0, Math.floor(minutes)) * 60 * 1000
  engine.pump.cooldowns[symbol] = Date.now() + ms
}

async function executePumpShort(pump: PumpDetection, settings: PumpAlertSettings, source: "PUMP1" | "PUMP2" = "PUMP1") {
  const mode = settings.mode
  if (mode === "paper") {
    await openPaperPumpTrade(pump, settings, undefined, source)
    return
  }
  if (mode === "live") {
    await openLivePumpTrade(pump, settings, undefined, source)
    return
  }

  const openedAt = Date.now()
  const id = `pump-${pump.symbol}-${openedAt}`
  const [paperResult, liveResult] = await Promise.allSettled([
    openPaperPumpTrade(pump, settings, { openedAt, id }, source),
    openLivePumpTrade(pump, settings, { openedAt, id }, source)
  ])
  const tag = source === "PUMP2" ? "PUMP ALERT 2" : "PUMP ALERT 1"
  const msg = `🚀 <b>[${tag}] MIRROR MODE</b>\nPaper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}\nLive: ${
    liveResult.status === "fulfilled" ? "✅" : "❌"
  }`
  await sendTelegram(msg).catch(() => undefined)
}

function computePump2TpSl(entryPrice: number, quantity: number, trade: Pump2Settings["trade"]): { tpPrice: number; slPrice: number } | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const tpV = Number(trade.takeProfit.value)
  const slV = Number(trade.stopLoss.value)
  if (!Number.isFinite(tpV) || tpV <= 0) return null
  if (!Number.isFinite(slV) || slV <= 0) return null

  let tpPrice = 0
  if (trade.takeProfit.mode === "USD") {
    tpPrice = entryPrice - tpV / quantity
  } else {
    tpPrice = entryPrice * (1 - tpV / 100)
  }

  let slPrice = 0
  if (trade.stopLoss.mode === "USD") {
    slPrice = entryPrice + slV / quantity
  } else {
    slPrice = entryPrice * (1 + slV / 100)
  }

  if (!Number.isFinite(tpPrice) || tpPrice <= 0) return null
  if (!Number.isFinite(slPrice) || slPrice <= 0) return null
  if (tpPrice >= entryPrice) return null
  if (slPrice <= entryPrice) return null

  return { tpPrice, slPrice }
}

async function executePump2Trade(pump: PumpDetection, trade: Pump2Settings["trade"]) {
  const mode = trade.mode
  if (mode === "paper") {
    await openPaperPump2Trade(pump, trade, undefined)
    return
  }
  if (mode === "live") {
    await openLivePump2Trade(pump, trade, undefined)
    return
  }

  const openedAt = Date.now()
  const id = `pump-${pump.symbol}-${openedAt}`
  const [paperResult, liveResult] = await Promise.allSettled([
    openPaperPump2Trade(pump, trade, { openedAt, id }),
    openLivePump2Trade(pump, trade, { openedAt, id })
  ])
  const msg = `🚀 <b>[PUMP ALERT 2] MIRROR MODE</b>\nPaper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}\nLive: ${
    liveResult.status === "fulfilled" ? "✅" : "❌"
  }`
  await sendTelegram(msg).catch(() => undefined)
}

async function openPaperPump2Trade(pump: PumpDetection, trade: Pump2Settings["trade"], meta?: { openedAt: number; id: string }) {
  const price = pump.currentPrice
  const openedAt = meta?.openedAt ?? Date.now()
  const id = meta?.id ?? `pump-${pump.symbol}-${openedAt}`
  if (engine.pump.openTrades.some((t) => t.status === "OPEN" && t.symbol === pump.symbol)) return

  const leverage = Math.max(1, Math.floor(trade.leverage))
  const margin = Math.max(0, trade.marginUsd)
  const positionValue = margin * leverage
  if (!Number.isFinite(positionValue) || positionValue <= 0) return

  const quantity = positionValue / Math.max(1e-12, price)
  const tpSl = computePump2TpSl(price, quantity, trade)
  if (!tpSl) return

  const t: EnginePumpTrade = {
    id,
    execMode: "paper",
    source: "PUMP2",
    symbol: pump.symbol,
    direction: "SHORT",
    pumpLevel: pump.pumpLevel,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    tpPrice: tpSl.tpPrice,
    slPrice: tpSl.slPrice,
    trailing: {
      enabled: Boolean(trade.trailingStop.enabled),
      mode: "USD",
      activateAt: trade.trailingStop.activateAtUsd,
      distance: trade.trailingStop.distanceUsd,
      active: false,
      bestPrice: price,
      bestPnlUsd: 0
    },
    phase: "OPEN",
    detectedAt: pump.detectedAt,
    openedAt,
    status: "OPEN",
    currentPrice: price,
    pnlPercent: 0
  }

  engine.pump.openTrades.unshift(t)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
  await sendPump2OpenedTelegram(pump, t, trade)
}

async function openLivePump2Trade(pump: PumpDetection, trade: Pump2Settings["trade"], meta?: { openedAt: number; id: string }) {
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) throw new Error("Missing BINGX_API_KEY / BINGX_SECRET_KEY")

  const price = pump.currentPrice
  const openedAt = meta?.openedAt ?? Date.now()
  const id = meta?.id ?? `pump-${pump.symbol}-${openedAt}`
  if (engine.pump.openTrades.some((t) => t.status === "OPEN" && t.symbol === pump.symbol && t.execMode === "live")) return

  const leverage = Math.max(1, Math.floor(trade.leverage))
  const margin = Math.max(0, trade.marginUsd)
  const positionValue = margin * leverage
  if (!Number.isFinite(positionValue) || positionValue <= 0) return

  const quantity = positionValue / Math.max(1e-12, price)
  const tpSl = computePump2TpSl(price, quantity, trade)
  if (!tpSl) return

  const t: EnginePumpTrade = {
    id,
    execMode: "live",
    source: "PUMP2",
    symbol: pump.symbol,
    direction: "SHORT",
    pumpLevel: pump.pumpLevel,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    tpPrice: tpSl.tpPrice,
    slPrice: tpSl.slPrice,
    trailing: {
      enabled: Boolean(trade.trailingStop.enabled),
      mode: "USD",
      activateAt: trade.trailingStop.activateAtUsd,
      distance: trade.trailingStop.distanceUsd,
      active: false,
      bestPrice: price,
      bestPnlUsd: 0
    },
    phase: "OPEN",
    detectedAt: pump.detectedAt,
    openedAt,
    status: "OPEN",
    currentPrice: price,
    pnlPercent: 0
  }

  await setLeverageForSymbol(pump.symbol, "SHORT", leverage, apiKey, secretKey)
  const openOrder = await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "OPEN",
    orderType: "MARKET",
    quantity,
    reduceOnly: false,
    apiKey,
    secretKey
  })
  const orderId = (openOrder as any)?.data?.orderId
  if (orderId) t.orderId = String(orderId)

  await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "CLOSE",
    orderType: "TAKE_PROFIT_MARKET",
    stopPrice: tpSl.tpPrice,
    quantity,
    reduceOnly: true,
    apiKey,
    secretKey
  })

  await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "CLOSE",
    orderType: "STOP_MARKET",
    stopPrice: tpSl.slPrice,
    quantity,
    reduceOnly: true,
    apiKey,
    secretKey
  })

  engine.pump.openTrades.unshift(t)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
  await sendPump2OpenedTelegram(pump, t, trade)
}

async function sendPump2OpenedTelegram(pump: PumpDetection, t: EnginePumpTrade, trade: Pump2Settings["trade"]) {
  const tpLabel = trade.takeProfit.mode === "USD" ? `$${trade.takeProfit.value}` : `${trade.takeProfit.value}%`
  const slLabel = trade.stopLoss.mode === "USD" ? `$${trade.stopLoss.value}` : `${trade.stopLoss.value}%`
  const trailLabel = trade.trailingStop.enabled ? `ON (activate at +$${trade.trailingStop.activateAtUsd})` : "OFF"
  const msg = `🟣 <b>[PUMP ALERT 2] AUTO SHORT OPENED</b>
━━━━━━━━━━━━━━
${pump.symbol} [${pump.pumpLevel}]
Entry: $${t.entryPrice.toFixed(6)}
TP:    $${t.tpPrice.toFixed(6)} (${tpLabel})
SL:    $${t.slPrice.toFixed(6)} (${slLabel})
Margin: $${t.margin} | ${t.leverage}x
Position: $${t.positionValue.toFixed(2)}
Trailing: ${trailLabel}
Mode: ${t.execMode.toUpperCase()}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openPaperPumpTrade(
  pump: PumpDetection,
  settings: PumpAlertSettings,
  meta?: { openedAt: number; id: string },
  source: "PUMP1" | "PUMP2" = "PUMP1"
) {
  const levelSettings = settings.levels[pump.pumpLevel]
  const price = pump.currentPrice
  const openedAt = meta?.openedAt ?? Date.now()
  const id = meta?.id ?? `pump-${pump.symbol}-${openedAt}`
  if (engine.pump.openTrades.some((t) => t.status === "OPEN" && t.symbol === pump.symbol)) return

  const positionValue = levelSettings.margin * levelSettings.leverage
  const tpPrice = price * (1 - levelSettings.tpPercent / 100)
  const slPrice = price * (1 + levelSettings.slPercent / 100)
  const quantity = positionValue / Math.max(1e-12, price)

  const trade: EnginePumpTrade = {
    id,
    execMode: "paper",
    source,
    symbol: pump.symbol,
    direction: "SHORT",
    pumpLevel: pump.pumpLevel,
    entryPrice: price,
    quantity,
    margin: levelSettings.margin,
    leverage: levelSettings.leverage,
    positionValue,
    tpPrice,
    slPrice,
    trailing: {
      enabled: levelSettings.trailingEnabled,
      mode: "PCT",
      activateAt: levelSettings.trailingActivateAt,
      distance: levelSettings.trailingDistance,
      active: false,
      bestPrice: price,
      bestPnlUsd: 0
    },
    phase: "OPEN",
    detectedAt: pump.detectedAt,
    openedAt,
    status: "OPEN",
    currentPrice: price,
    pnlPercent: 0
  }

  engine.pump.openTrades.unshift(trade)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)

  await sendPumpOpenedTelegram(pump, trade, settings)
  addPumpCooldown(pump.symbol, settings.cooldownAfterTrade)
}

async function openLivePumpTrade(
  pump: PumpDetection,
  settings: PumpAlertSettings,
  meta?: { openedAt: number; id: string },
  source: "PUMP1" | "PUMP2" = "PUMP1"
) {
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) throw new Error("Missing BINGX_API_KEY / BINGX_SECRET_KEY")

  const levelSettings = settings.levels[pump.pumpLevel]
  const price = pump.currentPrice
  const openedAt = meta?.openedAt ?? Date.now()
  const id = meta?.id ?? `pump-${pump.symbol}-${openedAt}`
  if (engine.pump.openTrades.some((t) => t.status === "OPEN" && t.symbol === pump.symbol && t.execMode === "live")) return

  const positionValue = levelSettings.margin * levelSettings.leverage
  const tpPrice = price * (1 - levelSettings.tpPercent / 100)
  const slPrice = price * (1 + levelSettings.slPercent / 100)
  const quantity = positionValue / Math.max(1e-12, price)

  const trade: EnginePumpTrade = {
    id,
    execMode: "live",
    source,
    symbol: pump.symbol,
    direction: "SHORT",
    pumpLevel: pump.pumpLevel,
    entryPrice: price,
    quantity,
    margin: levelSettings.margin,
    leverage: levelSettings.leverage,
    positionValue,
    tpPrice,
    slPrice,
    trailing: {
      enabled: levelSettings.trailingEnabled,
      mode: "PCT",
      activateAt: levelSettings.trailingActivateAt,
      distance: levelSettings.trailingDistance,
      active: false,
      bestPrice: price,
      bestPnlUsd: 0
    },
    phase: "OPEN",
    detectedAt: pump.detectedAt,
    openedAt,
    status: "OPEN",
    currentPrice: price,
    pnlPercent: 0
  }

  await setLeverageForSymbol(pump.symbol, "SHORT", Math.max(1, Math.floor(levelSettings.leverage)), apiKey, secretKey)
  const openOrder = await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "OPEN",
    orderType: "MARKET",
    quantity,
    reduceOnly: false,
    apiKey,
    secretKey
  })
  const orderId = (openOrder as any)?.data?.orderId
  if (orderId) trade.orderId = String(orderId)

  await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "CLOSE",
    orderType: "TAKE_PROFIT_MARKET",
    stopPrice: tpPrice,
    quantity,
    reduceOnly: true,
    apiKey,
    secretKey
  })

  await placeOrder({
    symbol: pump.symbol,
    tradeSide: "SHORT",
    intent: "CLOSE",
    orderType: "STOP_MARKET",
    stopPrice: slPrice,
    quantity,
    reduceOnly: true,
    apiKey,
    secretKey
  })

  engine.pump.openTrades.unshift(trade)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)
  await sendPumpOpenedTelegram(pump, trade, settings)
  addPumpCooldown(pump.symbol, settings.cooldownAfterTrade)
}

async function sendPumpOpenedTelegram(pump: PumpDetection, trade: EnginePumpTrade, settings: PumpAlertSettings) {
  const levelSettings = settings.levels[pump.pumpLevel]
  const emoji = PUMP_THRESHOLDS[pump.pumpLevel].color
  const tag = trade.source === "PUMP2" ? "PUMP ALERT 2" : "PUMP ALERT 1"
  const msg = `${emoji} <b>[${tag}] PUMP DETECTED — SHORT OPENED</b>
━━━━━━━━━━━━━━
🚀 ${pump.symbol} PUMPED ${pump.pumpLevel}
━━━━━━━━━━━━━━
📈 Price change:
1m: +${pump.priceChange1m}%
5m: +${pump.priceChange5m}%
15m: +${pump.priceChange15m}%
📊 Volume: ${pump.volumeRatio}x average
🎯 Confidence: ${pump.confidence}%
━━━━━━━━━━━━━━
📉 SHORT TRADE:
Entry: $${trade.entryPrice.toFixed(6)}
TP:    $${trade.tpPrice.toFixed(6)} (-${levelSettings.tpPercent}%)
SL:    $${trade.slPrice.toFixed(6)} (+${levelSettings.slPercent}%)
Margin: $${levelSettings.margin} | ${levelSettings.leverage}x
Position: $${trade.positionValue.toFixed(2)}
Trailing: ${levelSettings.trailingEnabled ? `ON (activate at -${levelSettings.trailingActivateAt}%)` : "OFF"}
Mode: ${trade.execMode.toUpperCase()}`
  await sendTelegram(msg).catch(() => undefined)
}

async function closePumpTrade(trade: EnginePumpTrade, closePrice: number, reason: string) {
  if (engine.pump.closedTrades.some((t) => t.id === trade.id && t.status === "CLOSED")) return
  if (!engine.pump.openTrades.some((t) => t.id === trade.id && t.status === "OPEN")) return

  const now = Date.now()
  const price = Number.isFinite(closePrice) && closePrice > 0 ? closePrice : await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
  const pnlPercent = ((trade.entryPrice - price) / trade.entryPrice) * 100
  const grossPnlUsd = trade.positionValue * (pnlPercent / 100)
  const feesUsd = trade.positionValue * 0.001
  const netPnlUsd = grossPnlUsd - feesUsd

  if (trade.execMode === "live") {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (apiKey && secretKey) {
      await placeOrder({
        symbol: trade.symbol,
        tradeSide: "SHORT",
        intent: "CLOSE",
        orderType: "MARKET",
        quantity: trade.quantity,
        reduceOnly: true,
        apiKey,
        secretKey
      }).catch(() => undefined)
    }
  }

  const closed: EnginePumpTrade = {
    ...trade,
    status: "CLOSED",
    closePrice: price,
    closedAt: now,
    closeReason: reason,
    pnlPercent,
    grossPnlUsd,
    feesUsd,
    netPnlUsd
  }

  engine.pump.openTrades = engine.pump.openTrades.filter((t) => t.id !== trade.id)
  engine.pump.closedTrades = engine.pump.closedTrades.filter((t) => t.id !== trade.id)
  engine.pump.closedTrades.unshift(closed)
  void writeJsonAtomic(PUMP_STATE_PATH, buildPumpStateSnapshot()).catch(() => undefined)

  const emoji = netPnlUsd > 0 ? "✅" : "❌"
  const tag = trade.source === "PUMP2" ? "PUMP ALERT 2" : "PUMP ALERT 1"
  const msg = `${emoji} <b>[${tag}] PUMP SHORT CLOSED</b>
━━━━━━━━━━━━━━
${trade.symbol} SHORT [${trade.pumpLevel}]
Entry: $${trade.entryPrice.toFixed(6)}
Exit:  $${price.toFixed(6)}
Reason: ${reason}
━━━━━━━━━━━━━━
PnL%: ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(3)}%
Gross: ${grossPnlUsd >= 0 ? "+" : ""}$${grossPnlUsd.toFixed(4)}
Fees: -$${feesUsd.toFixed(4)}
NET: ${netPnlUsd >= 0 ? "+" : ""}$${netPnlUsd.toFixed(4)}`
  await sendTelegram(msg).catch(() => undefined)
}

function loadPumpSettings(): PumpAlertSettings {
  const s = DEFAULT_PUMP_SETTINGS
  const mode = normalizePumpMode(process.env.PUMP_MODE ?? s.mode)
  const levels: any = {}
  for (const level of ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const) {
    const p = `PUMP_${level}_`
    const fallback = s.levels[level]
    levels[level] = {
      margin: clampNum(process.env[`${p}MARGIN`], fallback.margin, 0, 1_000_000),
      leverage: clampInt(process.env[`${p}LEVERAGE`], fallback.leverage, 1, 50),
      tpPercent: clampNum(process.env[`${p}TP_PCT`], fallback.tpPercent, 0, 100),
      slPercent: clampNum(process.env[`${p}SL_PCT`], fallback.slPercent, 0, 100),
      trailingEnabled: normalizeBool(process.env[`${p}TRAILING`], fallback.trailingEnabled),
      trailingActivateAt: clampNum(process.env[`${p}TRAIL_ACTIVATE_PCT`], fallback.trailingActivateAt, 0, 100),
      trailingDistance: clampNum(process.env[`${p}TRAIL_DISTANCE_PCT`], fallback.trailingDistance, 0, 100)
    }
  }

  const blacklist = String(process.env.PUMP_BLACKLIST ?? s.blacklistedCoins.join(","))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

  return {
    enabled: normalizeBool(process.env.PUMP_ALERT_ENABLED, s.enabled),
    mode,
    tradeLow: normalizeBool(process.env.PUMP_TRADE_LOW, s.tradeLow),
    tradeMedium: normalizeBool(process.env.PUMP_TRADE_MEDIUM, s.tradeMedium),
    tradeHigh: normalizeBool(process.env.PUMP_TRADE_HIGH, s.tradeHigh),
    tradeExtreme: normalizeBool(process.env.PUMP_TRADE_EXTREME, s.tradeExtreme),
    levels,
    maxConcurrentPumps: clampInt(process.env.PUMP_MAX_CONCURRENT, s.maxConcurrentPumps, 1, 20),
    maxPumpsPerHour: clampInt(process.env.PUMP_MAX_PER_HOUR, s.maxPumpsPerHour, 1, 100),
    cooldownAfterTrade: clampInt(process.env.PUMP_COOLDOWN_MIN, s.cooldownAfterTrade, 0, 3600),
    minConfidence: clampInt(process.env.PUMP_MIN_CONFIDENCE, s.minConfidence, 0, 100),
    blacklistedCoins: blacklist.length ? blacklist : s.blacklistedCoins
  }
}

function loadPump2Settings(): Pump2Settings {
  const s = DEFAULT_PUMP2_SETTINGS
  const levels: any = {}
  for (const level of ["LOW", "MEDIUM", "HIGH", "EXTREME"] as const) {
    const p = `PUMP2_${level}_`
    const fallback = s.levels[level]
    levels[level] = {
      enabled: normalizeBool(process.env[`${p}ENABLED`], fallback.enabled),
      pct: clampNum(process.env[`${p}PCT`], fallback.pct, 0, 100),
      timeframeMin: clampInt(process.env[`${p}TF_MIN`], fallback.timeframeMin, 1, 720),
      volX: clampNum(process.env[`${p}VOLX`], fallback.volX, 0, 1_000_000)
    }
  }

  const mtcTimeframes = String(process.env.PUMP2_MTC_TIMEFRAMES ?? s.mtcTimeframes.join(","))
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)

  const slModeRaw = String(process.env.PUMP2_TRADE_SL_MODE ?? s.trade.stopLoss.mode).toUpperCase()
  const slMode = slModeRaw === "USD" ? "USD" : "PCT"
  const tpModeRaw = String(process.env.PUMP2_TRADE_TP_MODE ?? s.trade.takeProfit.mode).toUpperCase()
  const tpMode = tpModeRaw === "USD" ? "USD" : "PCT"

  return {
    enabled: normalizeBool(process.env.PUMP2_ENABLED, s.enabled),
    minVolumeUsd: clampNum(process.env.PUMP2_MIN_VOL_USD, s.minVolumeUsd, 0, 1_000_000_000),
    debounceMinutes: clampInt(process.env.PUMP2_DEBOUNCE_MIN, s.debounceMinutes, 0, 3600),
    minPriceChangeAbs: clampNum(process.env.PUMP2_MIN_PRICE_CHANGE_ABS, s.minPriceChangeAbs, 0, 100),
    mtcEnabled: normalizeBool(process.env.PUMP2_MTC_ENABLED, s.mtcEnabled),
    mtcTimeframes: mtcTimeframes.length ? mtcTimeframes : s.mtcTimeframes,
    mtcMinConfirmations: clampInt(process.env.PUMP2_MTC_MIN_CONFIRM, s.mtcMinConfirmations, 0, 20),
    levels,
    trade: {
      enabled: normalizeBool(process.env.PUMP2_TRADE_ENABLED, s.trade.enabled),
      mode: normalizePumpMode(process.env.PUMP2_TRADE_MODE ?? s.trade.mode),
      leverage: clampInt(process.env.PUMP2_TRADE_LEVERAGE, s.trade.leverage, 1, 50),
      marginUsd: clampNum(process.env.PUMP2_TRADE_MARGIN_USD, s.trade.marginUsd, 0, 1_000_000_000),
      stopLoss: {
        mode: slMode,
        value: clampNum(process.env.PUMP2_TRADE_SL_VALUE, s.trade.stopLoss.value, 0, 1_000_000_000)
      },
      takeProfit: {
        mode: tpMode,
        value: clampNum(process.env.PUMP2_TRADE_TP_VALUE, s.trade.takeProfit.value, 0, 1_000_000_000)
      },
      trailingStop: {
        enabled: normalizeBool(process.env.PUMP2_TRADE_TRAILING_ENABLED, s.trade.trailingStop.enabled),
        activateAtUsd: clampNum(process.env.PUMP2_TRADE_TRAIL_ACTIVATE_USD, s.trade.trailingStop.activateAtUsd, 0, 1_000_000_000),
        distanceUsd: clampNum(process.env.PUMP2_TRADE_TRAIL_DISTANCE_USD, s.trade.trailingStop.distanceUsd, 0, 1_000_000_000)
      }
    }
  }
}

function reloadPumpEnv() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key.startsWith("PUMP_")) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function reloadPump2Env() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key.startsWith("PUMP2_")) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function normalizePumpMode(v: unknown): "paper" | "live" | "mirror" {
  const s = String(v ?? "paper").toLowerCase()
  if (s === "live") return "live"
  if (s === "mirror") return "mirror"
  return "paper"
}

function normalizeBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  const s = String(v ?? "").toLowerCase().trim()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const x = Number.isFinite(n) ? n : fallback
  return Math.max(min, Math.min(max, x))
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  const x = Number.isFinite(n) ? Math.floor(n) : fallback
  return Math.max(min, Math.min(max, x))
}

async function applySmartWickProtection(trade: EngineScalpTrade, s: ScalpSettings, grossPnl: number): Promise<ScalpSettings> {
  if (!s.filters.wick_ratio) return s
  const now = Date.now()
  if (trade.lastWickCheckAt && now - trade.lastWickCheckAt < 60_000) return s
  trade.lastWickCheckAt = now

  const candles = await fetchScalpKlines(trade.symbol, s.timeframe, 30).catch(() => [])
  if (candles.length < 10) return s

  const last = candles[candles.length - 1]
  if (!last) return s
  const body = Math.abs(last.close - last.open)
  const range = Math.max(1e-12, last.high - last.low)
  const upperWick = last.high - Math.max(last.open, last.close)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const wickRatio = upperWick / (body + 1e-6)
  const lowerWickRatio = lowerWick / (body + 1e-6)
  const isWickCandle = wickRatio > 1.5 || lowerWickRatio > 1.5
  if (!isWickCandle) return s

  const prev3 = candles.slice(-4, -1)
  if (prev3.length < 3) return s
  const trendStrong =
    prev3.filter((c) => (trade.direction === "LONG" ? c.close > c.open : c.close < c.open)).length >= 2
  const avgVol = prev3.reduce((sum, c) => sum + c.volume, 0) / prev3.length
  const wickVolumeHigh = avgVol > 0 ? last.volume > avgVol * 1.5 : false
  const mid = (last.high + last.low) / 2
  const recoveredFromWick = trade.direction === "LONG" ? last.close > mid : last.close < mid
  const dangerous = wickVolumeHigh && !recoveredFromWick && !trendStrong
  if (!dangerous) return s

  if (grossPnl <= 0) {
    trade.closeReason = "MANUAL"
    await closeScalpTrade(trade, "AUTO", last.close).catch(() => undefined)
    return s
  }

  const tightened = Math.max(0.5, s.trailDistance * 0.6)
  if (tightened >= s.trailDistance) return s
  await sendTelegram(
    `⚠️ <b>[SCALPING 1] WICK DANGER — TIGHTEN TRAIL</b>\n${trade.symbol} ${trade.direction}\nTrail: ${s.trailDistance.toFixed(
      2
    )} → ${tightened.toFixed(2)}`
  ).catch(() => undefined)
  return { ...s, trailDistance: tightened }
}

function restartScalpingLoops() {
  if (scalpScanTimer) clearInterval(scalpScanTimer)
  if (scalpUpdateTimer) clearInterval(scalpUpdateTimer)
  if (scalpCommandTimer) clearInterval(scalpCommandTimer)
  if (scalpSummaryTimer) clearInterval(scalpSummaryTimer)
  scalpScanTimer = null
  scalpUpdateTimer = null
  scalpCommandTimer = null
  scalpSummaryTimer = null
  startScalpingEngine()
}

function restartScalping2Loops() {
  if (scalp2ScanTimer) clearInterval(scalp2ScanTimer)
  if (scalp2UpdateTimer) clearInterval(scalp2UpdateTimer)
  if (scalp2CommandTimer) clearInterval(scalp2CommandTimer)
  if (scalp2SummaryTimer) clearInterval(scalp2SummaryTimer)
  scalp2ScanTimer = null
  scalp2UpdateTimer = null
  scalp2CommandTimer = null
  scalp2SummaryTimer = null
  startScalping2Engine()
}

function restartScalping3Loops() {
  if (scalp3ScanTimer) clearInterval(scalp3ScanTimer)
  if (scalp3UpdateTimer) clearInterval(scalp3UpdateTimer)
  if (scalp3CommandTimer) clearInterval(scalp3CommandTimer)
  if (scalp3PendingTimer) clearInterval(scalp3PendingTimer)
  scalp3ScanTimer = null
  scalp3UpdateTimer = null
  scalp3CommandTimer = null
  scalp3PendingTimer = null
  startScalping3Engine()
}

function resetPaperAccount(totalUsd: number) {
  const v = Math.max(0, Number(totalUsd))
  engine.scalping.paperAccount = {
    balance: v,
    totalDeposited: v,
    totalFeesPaid: 0,
    totalGrossPnl: 0,
    totalNetPnl: 0
  }
  engine.scalping.openTrades = engine.scalping.openTrades.filter((t) => t.execMode !== "paper")
  engine.scalping.closedTrades = engine.scalping.closedTrades.filter((t) => t.execMode !== "paper")
  engine.scalping.paperBalanceApplied = v
  engine.scalping.dailyLossLock = { day: dayKey(Date.now()), hit: false }
}

function resetPaperAccount2(totalUsd: number) {
  const v = Math.max(0, Number(totalUsd))
  engine.scalping2.paperAccount = {
    balance: v,
    totalDeposited: v,
    totalFeesPaid: 0,
    totalGrossPnl: 0,
    totalNetPnl: 0
  }
  engine.scalping2.openTrades = engine.scalping2.openTrades.filter((t) => t.execMode !== "paper")
  engine.scalping2.closedTrades = engine.scalping2.closedTrades.filter((t) => t.execMode !== "paper")
  engine.scalping2.paperBalanceApplied = v
  engine.scalping2.dailyLossLock = { day: dayKey(Date.now()), hit: false }
}

function resetPaperAccount3(totalUsd: number) {
  const v = Math.max(0, Number(totalUsd))
  engine.scalping3.paperAccount = {
    balance: v,
    totalDeposited: v,
    totalFeesPaid: 0,
    totalGrossPnl: 0,
    totalNetPnl: 0
  }
  engine.scalping3.openTrades = engine.scalping3.openTrades.filter((t) => t.execMode !== "paper")
  engine.scalping3.closedTrades = engine.scalping3.closedTrades.filter((t) => t.execMode !== "paper")
  engine.scalping3.paperBalanceApplied = v
}

function hasOpenTradeForSymbol(symbol: string): boolean {
  return engine.scalping.openTrades.some((t) => t.status === "OPEN" && t.symbol === symbol)
}

function hasOpenScalp2TradeForSymbol(symbol: string): boolean {
  return engine.scalping2.openTrades.some((t) => t.status === "OPEN" && t.symbol === symbol)
}

function hasOpenScalp3TradeForSymbol(symbol: string): boolean {
  return engine.scalping3.openTrades.some((t) => t.status === "OPEN" && t.symbol === symbol)
}

function acquireOpenLock(symbol: string, ttlMs: number): boolean {
  const now = Date.now()
  const prev = scalpOpenLocks.get(symbol) ?? 0
  if (prev > 0 && now - prev < ttlMs) return false
  scalpOpenLocks.set(symbol, now)
  return true
}

function releaseOpenLock(symbol: string) {
  scalpOpenLocks.delete(symbol)
}

function acquireScalp2OpenLock(symbol: string, ttlMs: number): boolean {
  const now = Date.now()
  const prev = scalp2OpenLocks.get(symbol) ?? 0
  if (prev > 0 && now - prev < ttlMs) return false
  scalp2OpenLocks.set(symbol, now)
  return true
}

function releaseScalp2OpenLock(symbol: string) {
  scalp2OpenLocks.delete(symbol)
}

function dedupeOpenTrades(trades: EngineScalpTrade[]): EngineScalpTrade[] {
  const seen = new Set<string>()
  const out: EngineScalpTrade[] = []
  for (const t of trades) {
    const key = `${t.execMode}:${t.symbol}:${t.direction}:${t.status}`
    if (t.status === "OPEN") {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(t)
  }
  return out
}

function dedupeOpenScalp3Trades(trades: EngineScalp3Trade[]): EngineScalp3Trade[] {
  const seen = new Set<string>()
  const out: EngineScalp3Trade[] = []
  for (const t of trades) {
    const key = `${t.execMode}:${t.symbol}:${t.direction}:${t.status}`
    if (t.status === "OPEN") {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(t)
  }
  return out
}

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function applyPaperBalanceFromSettings(s: ScalpSettings) {
  const desired = Number(s.paperBalanceUsd)
  if (!Number.isFinite(desired) || desired <= 0) return
  const applied = engine.scalping.paperBalanceApplied
  if (applied === desired) return
  engine.scalping.paperBalanceApplied = desired

  const hasTrades = engine.scalping.openTrades.length > 0 || engine.scalping.closedTrades.length > 0
  if (hasTrades) return
  engine.scalping.paperAccount.balance = desired
  engine.scalping.paperAccount.totalDeposited = desired
}

function applyPaper2BalanceFromSettings(s: Scalp2Settings) {
  const desired = Number(s.paperBalanceUsd)
  if (!Number.isFinite(desired) || desired <= 0) return
  const applied = engine.scalping2.paperBalanceApplied
  if (applied === desired) return
  engine.scalping2.paperBalanceApplied = desired

  const hasTrades = engine.scalping2.openTrades.length > 0 || engine.scalping2.closedTrades.length > 0
  if (hasTrades) return
  engine.scalping2.paperAccount.balance = desired
  engine.scalping2.paperAccount.totalDeposited = desired
}

function applyDailyLossLock(s: ScalpSettings) {
  if (!s.filters.daily_loss_lock) return
  const maxLoss = Math.max(0, Number(s.maxDailyLossUsd))
  const today = dayKey(Date.now())
  if (!engine.scalping.dailyLossLock || engine.scalping.dailyLossLock.day !== today) {
    engine.scalping.dailyLossLock = { day: today, hit: false }
  }
  if (!maxLoss || maxLoss <= 0) return
  if (engine.scalping.dailyLossLock.hit) {
    engine.scalping.settings.paused = true
    return
  }

  const pnlToday = engine.scalping.closedTrades
    .filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
    .reduce((sum, t) => sum + Number(t.pnlUsd ?? 0), 0)

  if (pnlToday <= -maxLoss) {
    engine.scalping.dailyLossLock.hit = true
    engine.scalping.settings.paused = true
    void sendTelegram(
      `🛑 <b>[SCALPING 1] DAILY LOSS LIMIT HIT</b>\nLoss today: $${Math.abs(pnlToday).toFixed(2)}\nLimit: $${maxLoss.toFixed(
        2
      )}\nScalping paused until next UTC day`
    )
  }
}

function applyDailyLossLock2(s: Scalp2Settings) {
  if (!s.filters.daily_loss_lock) return
  const maxLoss = Math.max(0, Number(s.maxDailyLossUsd))
  const today = dayKey(Date.now())
  if (!engine.scalping2.dailyLossLock || engine.scalping2.dailyLossLock.day !== today) {
    engine.scalping2.dailyLossLock = { day: today, hit: false }
  }
  if (!maxLoss || maxLoss <= 0) return
  if (engine.scalping2.dailyLossLock.hit) {
    engine.scalping2.settings.paused = true
    return
  }

  const pnlToday = engine.scalping2.closedTrades
    .filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
    .reduce((sum, t) => sum + Number(t.pnlUsd ?? 0), 0)

  if (pnlToday <= -maxLoss) {
    engine.scalping2.dailyLossLock.hit = true
    engine.scalping2.settings.paused = true
    void sendTelegram(
      `🛑 <b>[SCALPING 2] DAILY LOSS LIMIT HIT</b>\nLoss today: $${Math.abs(pnlToday).toFixed(2)}\nLimit: $${maxLoss.toFixed(
        2
      )}\nScalping 2 paused until next UTC day`
    )
  }
}

async function isScalpNewsBlackoutActive(s: ScalpSettings): Promise<boolean> {
  if (!s.filters.news_blackout) return false
  const now = Date.now()
  const raw = await fetchForexFactoryWeek()
  const status = computeNewsStatus({ eventsRaw: raw, now, blackoutMinutes: 15, currencies: ["USD"], impact: "High" })
  if (status.state === "ACTIVE") {
    return true
  }
  return false
}

async function isScalp2NewsBlackoutActive(s: Scalp2Settings): Promise<boolean> {
  if (!s.filters.news_blackout) return false
  const now = Date.now()
  const raw = await fetchForexFactoryWeek()
  const status = computeNewsStatus({ eventsRaw: raw, now, blackoutMinutes: 15, currencies: ["USD"], impact: "High" })
  if (status.state === "ACTIVE") {
    return true
  }
  return false
}

function buildScalpStateSnapshot() {
  const today = dayKey(Date.now())
  const closedToday = engine.scalping.closedTrades.filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
  const trades = closedToday.length
  const wins = closedToday.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const losses = closedToday.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const totalPnl = round2(closedToday.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))
  const best = closedToday.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
  const worst = closedToday.slice().sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0]

  const closedAll = engine.scalping.closedTrades
  const allTrades = closedAll.length
  const allWins = closedAll.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const allLosses = closedAll.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const allTotalPnl = round2(closedAll.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))

  const paperClosedToday = closedToday.filter((t) => t.execMode === "paper")
  const paperTodayGross = round2(paperClosedToday.reduce((a, b) => a + (b.grossPnlUsd ?? 0), 0))
  const paperTodayFees = round2(paperClosedToday.reduce((a, b) => a + (b.fees?.totalFee ?? 0), 0))
  const paperTodayNet = round2(paperClosedToday.reduce((a, b) => a + (b.netPnlUsd ?? b.pnlUsd ?? 0), 0))

  const paperOpen = engine.scalping.openTrades.filter((t) => t.status === "OPEN" && t.execMode === "paper")

  return {
    ok: true,
    data: {
      updatedAt: Date.now(),
      settings: engine.scalping.settings,
      mode: engine.scalping.settings.mode,
      openTrades: engine.scalping.openTrades
        .filter((t) => t.status === "OPEN")
        .map((t) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryPrice: t.entryPrice,
          quantity: t.quantity,
          pnlUsd: t.pnlUsd,
          execMode: t.execMode,
          grossPnlUsd: t.grossPnlUsd,
          netPnlUsd: t.netPnlUsd,
          fees: t.fees,
          phase: t.trailing.phase,
          openedAt: t.openedAt
        })),
      stats: {
        trades,
        wins,
        losses,
        winRate: trades ? (wins / trades) * 100 : 0,
        totalPnl,
        best: best ? { symbol: best.symbol, pnlUsd: best.pnlUsd ?? 0, reason: best.closeReason } : undefined,
        worst: worst ? { symbol: worst.symbol, pnlUsd: worst.pnlUsd ?? 0, reason: worst.closeReason } : undefined,
        allTime: {
          trades: allTrades,
          wins: allWins,
          losses: allLosses,
          winRate: allTrades ? (allWins / allTrades) * 100 : 0,
          totalPnl: allTotalPnl
        }
      },
      paperAccount: {
        balance: engine.scalping.paperAccount.balance,
        totalDeposited: engine.scalping.paperAccount.totalDeposited,
        totalFeesPaid: engine.scalping.paperAccount.totalFeesPaid,
        totalGrossPnl: engine.scalping.paperAccount.totalGrossPnl,
        totalNetPnl: engine.scalping.paperAccount.totalNetPnl,
        today: {
          trades: paperClosedToday.length,
          gross: paperTodayGross,
          fees: paperTodayFees,
          net: paperTodayNet
        },
        openPositions: paperOpen.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryPrice: t.entryPrice,
          grossPnlUsd: t.grossPnlUsd ?? 0,
          netPnlUsd: t.netPnlUsd ?? t.pnlUsd ?? 0,
          fees: t.fees,
          openedAt: t.openedAt
        })),
        history: engine.scalping.closedTrades
          .filter((t) => t.execMode === "paper")
          .slice(0, 50)
          .map((t) => ({
            id: t.id,
            symbol: t.symbol,
            direction: t.direction,
            entryPrice: t.entryPrice,
            exitPrice: t.closePrice ?? 0,
            grossPnlUsd: t.grossPnlUsd ?? 0,
            fees: t.fees,
            netPnlUsd: t.netPnlUsd ?? t.pnlUsd ?? 0,
            reason: t.closeReason ?? "CLOSED",
            openedAt: t.openedAt,
            closedAt: t.closedAt ?? 0
          }))
      },
      leaderboard: engine.scalping.leaderboard
    }
  }
}

function buildScalp2StateSnapshot() {
  const today = dayKey(Date.now())
  const closedToday = engine.scalping2.closedTrades.filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
  const trades = closedToday.length
  const wins = closedToday.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const losses = closedToday.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const totalPnl = round2(closedToday.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))
  const best = closedToday.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
  const worst = closedToday.slice().sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0]

  const closedAll = engine.scalping2.closedTrades
  const allTrades = closedAll.length
  const allWins = closedAll.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const allLosses = closedAll.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const allTotalPnl = round2(closedAll.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))

  const paperClosedToday = closedToday.filter((t) => t.execMode === "paper")
  const paperTodayGross = round2(paperClosedToday.reduce((a, b) => a + (b.grossPnlUsd ?? 0), 0))
  const paperTodayFees = round2(paperClosedToday.reduce((a, b) => a + (b.fees?.totalFee ?? 0), 0))
  const paperTodayNet = round2(paperClosedToday.reduce((a, b) => a + (b.netPnlUsd ?? b.pnlUsd ?? 0), 0))

  const paperOpen = engine.scalping2.openTrades.filter((t) => t.status === "OPEN" && t.execMode === "paper")

  return {
    ok: true,
    data: {
      updatedAt: Date.now(),
      settings: engine.scalping2.settings,
      mode: engine.scalping2.settings.mode,
      openTrades: engine.scalping2.openTrades
        .filter((t) => t.status === "OPEN")
        .map((t) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryPrice: t.entryPrice,
          quantity: t.quantity,
          pnlUsd: t.pnlUsd,
          execMode: t.execMode,
          grossPnlUsd: t.grossPnlUsd,
          netPnlUsd: t.netPnlUsd,
          fees: t.fees,
          phase: t.trailing.phase,
          openedAt: t.openedAt
        })),
      stats: {
        trades,
        wins,
        losses,
        winRate: trades ? (wins / trades) * 100 : 0,
        totalPnl,
        best: best ? { symbol: best.symbol, pnlUsd: best.pnlUsd ?? 0, reason: best.closeReason } : undefined,
        worst: worst ? { symbol: worst.symbol, pnlUsd: worst.pnlUsd ?? 0, reason: worst.closeReason } : undefined,
        allTime: {
          trades: allTrades,
          wins: allWins,
          losses: allLosses,
          winRate: allTrades ? (allWins / allTrades) * 100 : 0,
          totalPnl: allTotalPnl
        }
      },
      paperAccount: {
        balance: engine.scalping2.paperAccount.balance,
        totalDeposited: engine.scalping2.paperAccount.totalDeposited,
        totalFeesPaid: engine.scalping2.paperAccount.totalFeesPaid,
        totalGrossPnl: engine.scalping2.paperAccount.totalGrossPnl,
        totalNetPnl: engine.scalping2.paperAccount.totalNetPnl,
        today: {
          trades: paperClosedToday.length,
          gross: paperTodayGross,
          fees: paperTodayFees,
          net: paperTodayNet
        },
        openPositions: paperOpen.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryPrice: t.entryPrice,
          grossPnlUsd: t.grossPnlUsd ?? 0,
          netPnlUsd: t.netPnlUsd ?? t.pnlUsd ?? 0,
          fees: t.fees,
          openedAt: t.openedAt
        })),
        history: engine.scalping2.closedTrades
          .filter((t) => t.execMode === "paper")
          .slice(0, 50)
          .map((t) => ({
            id: t.id,
            symbol: t.symbol,
            direction: t.direction,
            entryPrice: t.entryPrice,
            exitPrice: t.closePrice ?? 0,
            grossPnlUsd: t.grossPnlUsd ?? 0,
            fees: t.fees,
            netPnlUsd: t.netPnlUsd ?? t.pnlUsd ?? 0,
            reason: t.closeReason ?? "CLOSED",
            openedAt: t.openedAt,
            closedAt: t.closedAt ?? 0
          }))
      },
      leaderboard: engine.scalping2.leaderboard
    }
  }
}

function buildScalp3StateSnapshot() {
  const today = dayKey(Date.now())
  const closedToday = engine.scalping3.closedTrades.filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
  const trades = closedToday.length
  const wins = closedToday.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const losses = closedToday.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const totalPnl = round2(closedToday.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))
  const best = closedToday.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
  const worst = closedToday.slice().sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0]

  const closedAll = engine.scalping3.closedTrades
  const allTrades = closedAll.length
  const allWins = closedAll.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const allLosses = closedAll.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const allTotalPnl = round2(closedAll.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))

  const paperClosedToday = closedToday.filter((t) => t.execMode === "paper")
  const paperTodayGross = round2(paperClosedToday.reduce((a, b) => a + (b.grossPnlUsd ?? 0), 0))
  const paperTodayFees = round2(paperClosedToday.reduce((a, b) => a + (b.fees?.totalFee ?? 0), 0))
  const paperTodayNet = round2(paperClosedToday.reduce((a, b) => a + (b.netPnlUsd ?? b.pnlUsd ?? 0), 0))

  return {
    ok: true,
    data: {
      updatedAt: Date.now(),
      settings: engine.scalping3.settings,
      mode: engine.scalping3.settings.mode,
      openTrades: engine.scalping3.openTrades
        .filter((t) => t.status === "OPEN")
        .map((t) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entryPrice: t.entryPrice,
          quantity: t.quantity,
          pnlUsd: t.pnlUsd,
          execMode: t.execMode,
          grossPnlUsd: t.grossPnlUsd,
          netPnlUsd: t.netPnlUsd,
          fees: t.fees,
          tpPrice: t.tpPrice,
          tp1Price: t.tp1Price,
          tp2Price: t.tp2Price,
          tpStage: t.tpStage,
          slPrice: t.slPrice,
          rr: t.rr,
          openedAt: t.openedAt
        })),
      stats: {
        trades,
        wins,
        losses,
        winRate: trades ? (wins / trades) * 100 : 0,
        totalPnl,
        best: best ? { symbol: best.symbol, pnlUsd: best.pnlUsd ?? 0, reason: best.closeReason } : undefined,
        worst: worst ? { symbol: worst.symbol, pnlUsd: worst.pnlUsd ?? 0, reason: worst.closeReason } : undefined,
        allTime: {
          trades: allTrades,
          wins: allWins,
          losses: allLosses,
          winRate: allTrades ? (allWins / allTrades) * 100 : 0,
          totalPnl: allTotalPnl
        }
      },
      paperAccount: {
        balance: engine.scalping3.paperAccount.balance,
        totalDeposited: engine.scalping3.paperAccount.totalDeposited,
        totalFeesPaid: engine.scalping3.paperAccount.totalFeesPaid,
        totalGrossPnl: engine.scalping3.paperAccount.totalGrossPnl,
        totalNetPnl: engine.scalping3.paperAccount.totalNetPnl,
        today: {
          trades: paperClosedToday.length,
          gross: paperTodayGross,
          fees: paperTodayFees,
          net: paperTodayNet
        }
      },
      lastScan: engine.scalping3.lastScan,
      pending: engine.scalping3.pending
        ? {
            createdAt: engine.scalping3.pending.createdAt,
            dueAt: engine.scalping3.pending.dueAt,
            signal: engine.scalping3.pending.signal
          }
        : undefined,
      leaderboard: []
    }
  }
}

function buildPumpStateSnapshot() {
  const now = Date.now()
  const today = dayKey(now)
  const closedToday = engine.pump.closedTrades.filter((t) => (t.closedAt ? dayKey(t.closedAt) === today : false))
  const traded = closedToday.length
  const wins = closedToday.filter((t) => (t.netPnlUsd ?? 0) > 0).length
  const losses = closedToday.filter((t) => (t.netPnlUsd ?? 0) < 0).length
  const todayPnl = round2(closedToday.reduce((s, t) => s + Number(t.netPnlUsd ?? 0), 0))
  const pumpsDetected = engine.pump.recentPumps.filter((p) => now - p.detectedAt <= 60 * 60 * 1000).length

  const openTrades = engine.pump.openTrades
    .filter((t) => t.status === "OPEN")
    .map((t) => ({
      id: t.id,
      source: t.source ?? "PUMP1",
      symbol: t.symbol,
      pumpLevel: t.pumpLevel,
      entryPrice: t.entryPrice,
      currentPrice: t.currentPrice,
      pnlPercent: t.pnlPercent,
      phase: t.phase,
      tpPrice: t.tpPrice,
      slPrice: t.slPrice,
      margin: t.margin,
      leverage: t.leverage,
      positionValue: t.positionValue,
      openedAt: t.openedAt,
      execMode: t.execMode
    }))

  const recentPumps = engine.pump.recentPumps
    .filter((p) => now - p.detectedAt <= 60 * 60 * 1000)
    .slice(-200)
    .sort((a, b) => b.detectedAt - a.detectedAt)
    .map((p) => ({
      symbol: p.symbol,
      level: p.pumpLevel,
      priceChange5m: p.priceChange5m,
      volumeRatio: p.volumeRatio,
      confidence: p.confidence,
      action: p.action,
      detectedAt: p.detectedAt
    }))

  return {
    ok: true,
    data: {
      updatedAt: now,
      settings: engine.pump.settings,
      recentPumps,
      openTrades,
      closedTrades: engine.pump.closedTrades
        .filter((t) => t.status === "CLOSED")
        .slice(0, 300)
        .map((t) => ({
          id: t.id,
          source: t.source ?? "PUMP1",
          symbol: t.symbol,
          pumpLevel: t.pumpLevel,
          entryPrice: t.entryPrice,
          closePrice: t.closePrice,
          grossPnlUsd: t.grossPnlUsd,
          netPnlUsd: t.netPnlUsd,
          feesUsd: t.feesUsd,
          reason: t.closeReason,
          openedAt: t.openedAt,
          closedAt: t.closedAt,
          execMode: t.execMode
        })),
      history: engine.pump.recentPumps
        .slice(-500)
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .map((p) => ({
          symbol: p.symbol,
          level: p.pumpLevel,
          priceChange1m: p.priceChange1m,
          priceChange5m: p.priceChange5m,
          priceChange15m: p.priceChange15m,
          volumeRatio: p.volumeRatio,
          confidence: p.confidence,
          action: p.action,
          detectedAt: p.detectedAt
        })),
      stats: {
        pumpsDetected,
        traded,
        wins,
        losses,
        winRate: traded ? (wins / traded) * 100 : 0,
        todayPnl
      }
    }
  }
}

function buildPump2StateSnapshot() {
  const now = Date.now()
  const alerts = engine.pump2.alerts
    .slice(0, 200)
    .map((a) => ({
      id: a.id,
      symbol: a.symbol,
      confidence: a.confidence,
      price: a.price,
      pctChange: a.pctChange,
      volumeMultiplier: a.volumeMultiplier,
      rsi: a.rsi ?? null,
      chg5m: a.chg5m ?? null,
      chg10m: a.chg10m ?? null,
      chg1h: a.chg1h ?? null,
      chg4h: a.chg4h ?? null,
      chg12h: a.chg12h ?? null,
      mtcScore: a.mtcScore ?? null,
      timestamp: a.timestamp
    }))

  return {
    ok: true,
    data: {
      updatedAt: now,
      settings: engine.pump2.settings,
      pairsCount: engine.pump2.pairsCount,
      lastCheckAt: engine.pump2.lastCheckAt ?? null,
      alerts
    }
  }
}

function loadScalpSettings(): ScalpSettings {
  return settingsFromEnv(process.env)
}

function loadScalp2Settings(): Scalp2Settings {
  return settingsFromScalp2Env(process.env)
}

function loadScalp3Settings(): Scalping3Settings {
  return settingsFromScalp3Env(process.env)
}

function reloadScalpEnv() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key.startsWith("SCALPING_")) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function reloadScalp2Env() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key.startsWith("SCALPING2_")) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function reloadScalp3Env() {
  const envPath = path.join(ROOT, ".env.local")
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, "utf8")
  const lines = raw.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key.startsWith("SCALPING3_")) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function hourKey(ts: number): string {
  const d = new Date(ts)
  return `${dayKey(ts)}-${String(d.getUTCHours()).padStart(2, "0")}`
}

function countOpenScalpGroups(): number {
  const set = new Set<string>()
  for (const t of engine.scalping.openTrades) {
    if (t.status !== "OPEN") continue
    set.add(t.groupId)
  }
  return set.size
}

function countOpenScalp2Groups(): number {
  const set = new Set<string>()
  for (const t of engine.scalping2.openTrades) {
    if (t.status !== "OPEN") continue
    set.add(t.groupId)
  }
  return set.size
}

function countScalpGroupsForDay(day: string): number {
  const set = new Set<string>()
  for (const t of engine.scalping.openTrades) {
    if (dayKey(t.openedAt) === day) set.add(t.groupId)
  }
  for (const t of engine.scalping.closedTrades) {
    if (t.openedAt && dayKey(t.openedAt) === day) set.add(t.groupId)
  }
  return set.size
}

function countScalp2GroupsForDay(day: string): number {
  const set = new Set<string>()
  for (const t of engine.scalping2.openTrades) {
    if (dayKey(t.openedAt) === day) set.add(t.groupId)
  }
  for (const t of engine.scalping2.closedTrades) {
    if (t.openedAt && dayKey(t.openedAt) === day) set.add(t.groupId)
  }
  return set.size
}

async function fetchScalpKlines(symbol: string, interval: ScalpTimeframe, limit: number): Promise<Candle[]> {
  const url = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("interval", interval)
  url.searchParams.set("limit", String(limit))
  const res = await fetch(url.toString(), { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const code = Number(json?.code)
  if (code === 100410) {
    const msg = String(json?.msg ?? "")
    const m = msg.match(/after\s+(\d{10,13})/)
    const unblockAt = m ? Number(m[1]) : NaN
    if (Number.isFinite(unblockAt)) {
      const waitMs = Math.min(10_000, Math.max(0, unblockAt - Date.now() + 50))
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
      const res2 = await fetch(url.toString(), { cache: "no-store" })
      const json2 = (await res2.json().catch(() => null)) as any
      return parseKlines(json2)
    }
  }
  return parseKlines(json)
}

async function fetchScalp3Klines(symbol: string, interval: Scalping3Timeframe | "1h", limit: number): Promise<Candle[]> {
  const url = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("interval", interval)
  url.searchParams.set("limit", String(limit))
  const res = await fetch(url.toString(), { cache: "no-store" })
  const json = (await res.json().catch(() => null)) as any
  const code = Number(json?.code)
  if (code === 100410) {
    const msg = String(json?.msg ?? "")
    const m = msg.match(/after\s+(\d{10,13})/)
    const unblockAt = m ? Number(m[1]) : NaN
    if (Number.isFinite(unblockAt)) {
      const waitMs = Math.min(10_000, Math.max(0, unblockAt - Date.now() + 50))
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
      const res2 = await fetch(url.toString(), { cache: "no-store" })
      const json2 = (await res2.json().catch(() => null)) as any
      return parseKlines(json2)
    }
  }
  return parseKlines(json)
}

async function fetchScalpOrderbook(symbol: string): Promise<{ bids: Array<[string, string]>; asks: Array<[string, string]> }> {
  const url = new URL("https://open-api.bingx.com/openApi/swap/v2/quote/depth")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("limit", "20")
  const res = await fetch(url.toString(), { cache: "no-store" })
  const json = (await res.json()) as any
  const data = json?.data ?? json
  const bids = Array.isArray(data?.bids) ? (data.bids as Array<[string, string]>) : []
  const asks = Array.isArray(data?.asks) ? (data.asks as Array<[string, string]>) : []
  return { bids, asks }
}

async function fetchLivePrice(symbol: string): Promise<number> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal
    })
    const json = (await res.json()) as any
    const price = Number(json?.data?.price)
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price")
    return price
  } finally {
    clearTimeout(timeout)
  }
}

async function executeScalpTrade(signal: ScalpSignal, settings: ScalpSettings) {
  if (hasOpenTradeForSymbol(signal.symbol)) return
  const lockOk = acquireOpenLock(signal.symbol, 90_000)
  if (!lockOk) return
  try {
  const mode = settings.mode
  if (mode === "paper") {
    await openPaperScalpTrade(signal, settings).catch(() => undefined)
    return
  }
  if (mode === "live") {
    await openLiveScalpTrade(signal, settings).catch(() => undefined)
    return
  }

  const openedAt = Date.now()
  const groupId = `${signal.symbol}-${openedAt}`
  const meta = { openedAt, groupId }
  const [paperResult, liveResult] = await Promise.allSettled([openPaperScalpTrade(signal, settings, meta), openLiveScalpTrade(signal, settings, meta)])
  const msg = `⚡ <b>[SCALPING 1] MIRROR MODE</b>
━━━━━━━━━━━━━━
Paper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}
Live: ${liveResult.status === "fulfilled" ? "✅" : "❌"}`
  await sendTelegram(msg).catch(() => undefined)
  } finally {
    releaseOpenLock(signal.symbol)
  }
}

async function executeScalp2Trade(signal: Scalp2Signal, settings: Scalp2Settings) {
  if (hasOpenScalp2TradeForSymbol(signal.symbol)) return
  const lockOk = acquireScalp2OpenLock(signal.symbol, 90_000)
  if (!lockOk) return
  try {
    const mode = settings.mode
    if (mode === "paper") {
      await openPaperScalp2Trade(signal, settings).catch(() => undefined)
      return
    }
    if (mode === "live") {
      await openLiveScalp2Trade(signal, settings).catch(() => undefined)
      return
    }

    const openedAt = Date.now()
    const groupId = `${signal.symbol}-${openedAt}`
    const meta = { openedAt, groupId }
    const [paperResult, liveResult] = await Promise.allSettled([
      openPaperScalp2Trade(signal, settings, meta),
      openLiveScalp2Trade(signal, settings, meta)
    ])
    const msg = `⚡ <b>[SCALPING 2] MIRROR MODE</b>
━━━━━━━━━━━━━━
Paper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}
Live: ${liveResult.status === "fulfilled" ? "✅" : "❌"}`
    await sendTelegram(msg).catch(() => undefined)
  } finally {
    releaseScalp2OpenLock(signal.symbol)
  }
}

function cancelPendingScalp3Trade() {
  engine.scalping3.pending = undefined
}

function scheduleScalp3Trade(signal: Scalping3Signal, settings: Scalping3Settings) {
  const now = Date.now()
  const dueAt = now + 5 * 60_000
  engine.scalping3.pending = { createdAt: now, signal, dueAt }
  const targets = computeScalp3Targets(signal, settings, signal.entryPrice)
  const msg = `🧠 <b>[SCALPING 3] SETUP FOUND</b>
━━━━━━━━━━━━━━
${signal.symbol} ${signal.direction}
Entry: $${signal.entryPrice.toFixed(6)}
TP1:   $${targets.tp1Price.toFixed(6)}
TP2:   ${targets.tp2Price ? `$${targets.tp2Price.toFixed(6)}` : "—"}
SL:    $${targets.slPrice.toFixed(6)}
RR: ${signal.rr.toFixed(2)} | Score: ${Math.round(signal.totalScore)}
SMC: ${Math.round(signal.smcScore)} | Vol: ${Math.round(signal.volumeScore)} | Session: ${Math.round(signal.sessionScore)}
━━━━━━━━━━━━━━
Mode: ${String(settings.mode).toUpperCase()}
Planned entry: ${new Date(dueAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })} IST`
  void sendTelegram(msg)
}

function computeScalp3Targets(
  signal: Scalping3Signal,
  settings: Scalping3Settings,
  entryPrice: number
): { slPrice: number; tp1Price: number; tp2Price?: number } {
  if (!settings.useGlobalTargets) return { slPrice: signal.slPrice, tp1Price: signal.tpPrice }

  const slPct = Math.max(0, Number(settings.globalSlPct))
  const tp1Pct = Math.max(0, Number(settings.globalTp1Pct))
  const tp2Pct = Math.max(0, Number(settings.globalTp2Pct))
  const hasValid = Number.isFinite(entryPrice) && entryPrice > 0 && slPct > 0 && tp1Pct > 0
  if (!hasValid) return { slPrice: signal.slPrice, tp1Price: signal.tpPrice }

  const sl = signal.direction === "LONG" ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100)
  const tp1 = signal.direction === "LONG" ? entryPrice * (1 + tp1Pct / 100) : entryPrice * (1 - tp1Pct / 100)
  const tp2 =
    tp2Pct > 0 ? (signal.direction === "LONG" ? entryPrice * (1 + tp2Pct / 100) : entryPrice * (1 - tp2Pct / 100)) : undefined

  return { slPrice: sl, tp1Price: tp1, tp2Price: tp2 }
}

async function executeScalp3Trade(signal: Scalping3Signal, settings: Scalping3Settings) {
  if (hasOpenScalp3TradeForSymbol(signal.symbol)) return
  const mode = settings.mode
  if (mode === "paper") {
    await openPaperScalp3Trade(signal, settings).catch(() => undefined)
    return
  }
  if (mode === "live") {
    await openLiveScalp3Trade(signal, settings).catch(() => undefined)
    return
  }

  const openedAt = Date.now()
  const groupId = `${signal.symbol}-${openedAt}`
  const meta = { openedAt, groupId }
  const [paperResult, liveResult] = await Promise.allSettled([
    openPaperScalp3Trade(signal, settings, meta),
    openLiveScalp3Trade(signal, settings, meta)
  ])
  const msg = `⚡ <b>[SCALPING 3] MIRROR MODE</b>
━━━━━━━━━━━━━━
Paper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}
Live: ${liveResult.status === "fulfilled" ? "✅" : "❌"}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openPaperScalp3Trade(signal: Scalping3Signal, settings: Scalping3Settings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenScalp3TradeForSymbol(signal.symbol)) return
  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price
  const targets = computeScalp3Targets(signal, settings, price)
  const denom = Math.abs(price - targets.slPrice)
  const numer = Math.abs((targets.tp2Price ?? targets.tp1Price) - price)
  const rr = denom > 0 ? numer / denom : signal.rr
  const fees = calculateFees(positionValue, 0)

  const required = margin + fees.openFee
  if (engine.scalping3.paperAccount.balance < required) {
    await sendTelegram(
      `🚨 <b>[PAPER SCALPING 3] CANCELLED — INSUFFICIENT BALANCE</b>\nRequired: $${required.toFixed(2)}\nAvailable: $${engine.scalping3.paperAccount.balance.toFixed(2)}`
    ).catch(() => undefined)
    return
  }

  engine.scalping3.paperAccount.balance = round2(engine.scalping3.paperAccount.balance - required)
  engine.scalping3.paperAccount.totalFeesPaid = round2(engine.scalping3.paperAccount.totalFeesPaid + fees.openFee)

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `paper3-${groupId}`

  const trade: EngineScalp3Trade = {
    id,
    execMode: "paper",
    groupId,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    tpPrice: targets.tp1Price,
    tp1Price: targets.tp1Price,
    tp2Price: targets.tp2Price,
    tpStage: targets.tp2Price ? 1 : 2,
    slPrice: targets.slPrice,
    rr,
    scores: { smc: signal.smcScore, volume: signal.volumeScore, session: signal.sessionScore, total: signal.totalScore },
    openedAt,
    status: "OPEN",
    fees,
    feesPaidCloseUsd: 0,
    feesPaidFundingUsd: 0,
    grossPnlUsd: 0,
    netPnlUsd: round2(-fees.openFee),
    pnlUsd: round2(-fees.openFee)
  }

  engine.scalping3.openTrades.unshift(trade)

  const msg = `⚡ <b>[PAPER SCALPING 3] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
🎯 TP1:  $${targets.tp1Price.toFixed(6)}
🎯 TP2:  ${targets.tp2Price ? `$${targets.tp2Price.toFixed(6)}` : "—"}
🛑 SL:   $${targets.slPrice.toFixed(6)}
RR: ${rr.toFixed(2)} | Score: ${Math.round(signal.totalScore)}
━━━━━━━━━━━━━━
💸 Open Fee: -$${fees.openFee.toFixed(4)} (0.05%)
💳 Balance after fee: $${engine.scalping3.paperAccount.balance.toFixed(4)}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openLiveScalp3Trade(signal: Scalping3Signal, settings: Scalping3Settings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenScalp3TradeForSymbol(signal.symbol)) return
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) return

  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price
  const targets = computeScalp3Targets(signal, settings, price)
  const denom = Math.abs(price - targets.slPrice)
  const numer = Math.abs((targets.tp2Price ?? targets.tp1Price) - price)
  const rr = denom > 0 ? numer / denom : signal.rr

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `live3-${groupId}`

  const trade: EngineScalp3Trade = {
    id,
    execMode: "live",
    groupId,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    tpPrice: targets.tp1Price,
    tp1Price: targets.tp1Price,
    tp2Price: targets.tp2Price,
    tpStage: targets.tp2Price ? 1 : 2,
    slPrice: targets.slPrice,
    rr,
    scores: { smc: signal.smcScore, volume: signal.volumeScore, session: signal.sessionScore, total: signal.totalScore },
    openedAt,
    status: "OPEN"
  }

  await setLeverageForSymbol(signal.symbol, signal.direction, leverage, apiKey, secretKey).catch(() => undefined)
  const order = await placeOrder({
    symbol: signal.symbol,
    tradeSide: signal.direction,
    intent: "OPEN",
    orderType: "MARKET",
    quantity,
    reduceOnly: false,
    apiKey,
    secretKey
  }).catch(() => null)
  const orderId = (order as any)?.data?.orderId
  if (orderId) trade.orderId = String(orderId)

  engine.scalping3.openTrades.unshift(trade)

  const msg = `⚡ <b>[LIVE SCALPING 3] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
🎯 TP1:  $${targets.tp1Price.toFixed(6)}
🎯 TP2:  ${targets.tp2Price ? `$${targets.tp2Price.toFixed(6)}` : "—"}
🛑 SL:   $${targets.slPrice.toFixed(6)}
RR: ${rr.toFixed(2)} | Score: ${Math.round(signal.totalScore)}
🆔 Order: ${trade.orderId ?? "—"}`
  await sendTelegram(msg).catch(() => undefined)
}

function computeScalp3PnlUsd(
  trade: Pick<EngineScalp3Trade, "direction" | "entryPrice" | "quantity" | "realizedPnlUsd">,
  currentPrice: number
): number {
  return computePnlUsd(trade, currentPrice) + (trade.realizedPnlUsd ?? 0)
}

async function partialCloseScalp3AtTp1(trade: EngineScalp3Trade, tp1Price: number) {
  if (!trade.tp2Price) return
  const now = Date.now()
  const closeQty = trade.quantity * 0.5
  if (!Number.isFinite(closeQty) || closeQty <= 0) return

  if (trade.execMode === "live") {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (apiKey && secretKey) {
      await placeOrder({
        symbol: trade.symbol,
        tradeSide: trade.direction,
        intent: "CLOSE",
        orderType: "MARKET",
        quantity: closeQty,
        reduceOnly: true,
        apiKey,
        secretKey
      }).catch(() => undefined)
    }
  }

  const grossPartial = computePnlUsd({ direction: trade.direction, entryPrice: trade.entryPrice, quantity: closeQty }, tp1Price)
  const closeRatio = closeQty / trade.quantity
  const marginReleased = trade.margin * closeRatio
  const valueReleased = trade.positionValue * closeRatio

  if (trade.execMode === "paper") {
    const holdingHours = (now - trade.openedAt) / 1000 / 3600
    const feesNow = calculateFees(valueReleased, holdingHours)
    const closeFee = feesNow.closeFee
    const fundingFee = feesNow.fundingFee
    trade.feesPaidCloseUsd = round2((trade.feesPaidCloseUsd ?? 0) + closeFee)
    trade.feesPaidFundingUsd = round2((trade.feesPaidFundingUsd ?? 0) + fundingFee)
    engine.scalping3.paperAccount.balance = round2(
      engine.scalping3.paperAccount.balance + marginReleased + grossPartial - closeFee - fundingFee
    )
    engine.scalping3.paperAccount.totalFeesPaid = round2(engine.scalping3.paperAccount.totalFeesPaid + closeFee + fundingFee)
  }

  trade.realizedPnlUsd = round2((trade.realizedPnlUsd ?? 0) + grossPartial)
  trade.quantity = trade.quantity - closeQty
  trade.margin = round2(trade.margin - marginReleased)
  trade.positionValue = round2(trade.positionValue - valueReleased)
  trade.tpStage = 2
  trade.tpPrice = trade.tp2Price
  trade.slPrice = trade.entryPrice

  const prefix = trade.execMode === "paper" ? "[PAPER SCALPING 3]" : "[LIVE SCALPING 3]"
  const msg = `🎯 <b>${prefix} TP1 HIT (PARTIAL)</b>
━━━━━━━━━━━━━━
📊 ${trade.symbol} ${trade.direction}
TP1: $${tp1Price.toFixed(6)} (50% closed)
SL moved to BE: $${trade.entryPrice.toFixed(6)}
Next TP: $${trade.tp2Price.toFixed(6)}`
  await sendTelegram(msg).catch(() => undefined)
}

async function closeScalp3Trade(
  trade: EngineScalp3Trade,
  source: "AUTO" | "MANUAL",
  reason: "SL_HIT" | "TP_HIT" | "MANUAL",
  currentPrice: number
) {
  if (engine.scalping3.closedTrades.some((t) => t.id === trade.id && t.status === "CLOSED")) return
  if (!engine.scalping3.openTrades.some((t) => t.id === trade.id && t.status === "OPEN")) return

  const now = Date.now()
  const closePrice =
    Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
  const grossPnl = computeScalp3PnlUsd(trade, closePrice)
  const unrealizedPnl = computePnlUsd(trade, closePrice)

  if (trade.execMode === "live") {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (apiKey && secretKey) {
      await placeOrder({
        symbol: trade.symbol,
        tradeSide: trade.direction,
        intent: "CLOSE",
        orderType: "MARKET",
        quantity: trade.quantity,
        reduceOnly: true,
        apiKey,
        secretKey
      }).catch(() => undefined)
    }
  }

  let netPnl = grossPnl
  let fees = trade.fees
  if (trade.execMode === "paper") {
    const holdingHours = (now - trade.openedAt) / 1000 / 3600
    const feeOpen = trade.fees?.openFee ?? 0
    const feePaidClose = trade.feesPaidCloseUsd ?? 0
    const feePaidFunding = trade.feesPaidFundingUsd ?? 0
    const feesNow = calculateFees(trade.positionValue, holdingHours)
    const feeClose = feePaidClose + feesNow.closeFee
    const feeFunding = feePaidFunding + feesNow.fundingFee
    const totalFee = feeOpen + feeClose + feeFunding
    fees = { openFee: feeOpen, closeFee: feeClose, fundingFee: feeFunding, totalFee }
    netPnl = grossPnl - totalFee
    engine.scalping3.paperAccount.balance = round2(
      engine.scalping3.paperAccount.balance + trade.margin + unrealizedPnl - feesNow.closeFee - feesNow.fundingFee
    )
    engine.scalping3.paperAccount.totalFeesPaid = round2(engine.scalping3.paperAccount.totalFeesPaid + feesNow.closeFee + feesNow.fundingFee)
    engine.scalping3.paperAccount.totalGrossPnl = round2(engine.scalping3.paperAccount.totalGrossPnl + grossPnl)
    engine.scalping3.paperAccount.totalNetPnl = round2(engine.scalping3.paperAccount.totalNetPnl + netPnl)
  }

  const closed: EngineScalp3Trade = {
    ...trade,
    status: "CLOSED",
    closedAt: now,
    closePrice,
    grossPnlUsd: round2(grossPnl),
    netPnlUsd: round2(netPnl),
    pnlUsd: round2(trade.execMode === "paper" ? netPnl : grossPnl),
    fees,
    closeReason: source === "MANUAL" ? "MANUAL" : reason
  }

  engine.scalping3.openTrades = engine.scalping3.openTrades.filter((t) => t.id !== trade.id)
  engine.scalping3.closedTrades = engine.scalping3.closedTrades.filter((t) => t.id !== trade.id)
  engine.scalping3.closedTrades.unshift(closed)

  const r = closed.closeReason ?? "CLOSED"
  const prefix = trade.execMode === "paper" ? "[PAPER SCALPING 3]" : "[LIVE SCALPING 3]"
  const title = r === "SL_HIT" ? `❌ <b>${prefix} SL HIT</b>` : r === "TP_HIT" ? `🎯 <b>${prefix} TP HIT</b>` : `✅ <b>${prefix} CLOSED</b>`
  const pnl = trade.execMode === "paper" ? netPnl : grossPnl
  if (trade.execMode === "paper") {
    const f = closed.fees ?? calculateFees(trade.positionValue, 0)
    const msg = `${title}
━━━━━━━━━━━━━━
📊 ${trade.symbol} ${trade.direction}
💵 Entry: $${trade.entryPrice.toFixed(6)}
💵 Exit:  $${closePrice.toFixed(6)}
Reason: ${r}
━━━━━━━━━━━━━━
Gross PnL: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(4)}
Fees: -$${f.totalFee.toFixed(4)}
NET PnL: ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(4)}
Balance: $${engine.scalping3.paperAccount.balance.toFixed(4)}`
    await sendTelegram(msg).catch(() => undefined)
    return
  }
  await sendTelegram(`${title}\n${trade.symbol} ${trade.direction}\nPnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}\nReason: ${r}`).catch(() => undefined)
}

async function sendScalp3NoSignalTelegram(lastScan: {
  at: number
  session: string
  scanned: number
  smcValid: number
  volumeConfirmed: number
  reason: string
}) {
  const now = Date.now()
  const prev = engine.scalping3.lastNoSignalTelegramAt ?? 0
  if (prev > 0 && now - prev < 15 * 60_000) return
  engine.scalping3.lastNoSignalTelegramAt = now
  const msg = `🔎 <b>[SCALPING 3] NO SIGNAL</b>
━━━━━━━━━━━━━━
Session: ${lastScan.session}
Scanned: ${lastScan.scanned}
SMC valid: ${lastScan.smcValid}
Vol confirmed: ${lastScan.volumeConfirmed}
Reason: ${lastScan.reason}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openPaperScalp2Trade(signal: Scalp2Signal, settings: Scalp2Settings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenScalp2TradeForSymbol(signal.symbol)) return
  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price
  const fees = calculateFees(positionValue, 0)

  const required = margin + fees.openFee
  if (engine.scalping2.paperAccount.balance < required) {
    await sendTelegram(
      `🚨 <b>[PAPER SCALPING 2] CANCELLED — INSUFFICIENT BALANCE</b>\nRequired: $${required.toFixed(2)}\nAvailable: $${engine.scalping2.paperAccount.balance.toFixed(2)}`
    ).catch(() => undefined)
    return
  }

  engine.scalping2.paperAccount.balance = round2(engine.scalping2.paperAccount.balance - required)
  engine.scalping2.paperAccount.totalFeesPaid = round2(engine.scalping2.paperAccount.totalFeesPaid + fees.openFee)

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `paper2-${groupId}`

  const trade: EngineScalpTrade = {
    id,
    groupId,
    execMode: "paper",
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    score: signal.score,
    topFilters: signal.topFilters,
    openedAt,
    status: "OPEN",
    fees,
    grossPnlUsd: 0,
    netPnlUsd: round2(-fees.openFee),
    pnlUsd: round2(-fees.openFee),
    trailing: {
      phase: "INITIAL",
      tp1Amount: settings.tp1Amount,
      tp2Amount: settings.tp2Amount,
      slAmount: settings.slAmount,
      trailDistance: settings.trailDistance,
      lockedPnl: 0,
      highWaterMark: 0,
      active: settings.trailingEnabled
    }
  }

  engine.scalping2.openTrades.unshift(trade)

  const checks = signal.topFilters.length ? signal.topFilters.join(", ") : "—"
  const msg = `⚡ <b>[PAPER SCALPING 2] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
💰 Margin: $${margin.toFixed(2)} | Lev: ${leverage}x
📊 Position: $${positionValue.toFixed(2)}
━━━━━━━━━━━━━━
✅ Checklist: ${checks}
━━━━━━━━━━━━━━
💸 Open Fee: -$${fees.openFee.toFixed(4)} (0.05%)
💳 Balance after fee: $${engine.scalping2.paperAccount.balance.toFixed(4)}
━━━━━━━━━━━━━━
🎯 TP1: +$${settings.tp1Amount} → then trail
🎯 TP2: +$${settings.tp2Amount}
🛑 SL:  -$${settings.slAmount}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openLiveScalp2Trade(signal: Scalp2Signal, settings: Scalp2Settings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenScalp2TradeForSymbol(signal.symbol)) return
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) return

  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `live2-${groupId}`

  const trade: EngineScalpTrade = {
    id,
    groupId,
    execMode: "live",
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    score: signal.score,
    topFilters: signal.topFilters,
    openedAt,
    status: "OPEN",
    trailing: {
      phase: "INITIAL",
      tp1Amount: settings.tp1Amount,
      tp2Amount: settings.tp2Amount,
      slAmount: settings.slAmount,
      trailDistance: settings.trailDistance,
      lockedPnl: 0,
      highWaterMark: 0,
      active: settings.trailingEnabled
    }
  }

  await setLeverageForSymbol(signal.symbol, signal.direction, leverage, apiKey, secretKey).catch(() => undefined)
  const order = await placeOrder({
    symbol: signal.symbol,
    tradeSide: signal.direction,
    intent: "OPEN",
    orderType: "MARKET",
    quantity,
    reduceOnly: false,
    apiKey,
    secretKey
  })
  const orderId = (order as any)?.data?.orderId
  if (orderId) trade.orderId = String(orderId)

  engine.scalping2.openTrades.unshift(trade)

  const checks = signal.topFilters.length ? signal.topFilters.join(", ") : "—"
  const msg = `⚡ <b>[LIVE SCALPING 2] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
💰 Margin: $${margin.toFixed(2)} | Lev: ${leverage}x
🆔 Order: ${trade.orderId ?? "—"}
━━━━━━━━━━━━━━
✅ Checklist: ${checks}
━━━━━━━━━━━━━━
🎯 TP1: +$${settings.tp1Amount}
🎯 TP2: +$${settings.tp2Amount}
🛑 SL:  -$${settings.slAmount}`
  await sendTelegram(msg).catch(() => undefined)
}

async function closeScalp2Trade(trade: EngineScalpTrade, source: "AUTO" | "MANUAL", currentPrice: number) {
  if (engine.scalping2.closedTrades.some((t) => t.id === trade.id && t.status === "CLOSED")) return
  if (!engine.scalping2.openTrades.some((t) => t.id === trade.id && t.status === "OPEN")) return

  const s = engine.scalping2.settings
  const now = Date.now()
  const closePrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
  const grossPnl = computePnlUsd(trade, closePrice)

  if (trade.execMode === "live") {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (apiKey && secretKey) {
      await placeOrder({
        symbol: trade.symbol,
        tradeSide: trade.direction,
        intent: "CLOSE",
        orderType: "MARKET",
        quantity: trade.quantity,
        reduceOnly: true,
        apiKey,
        secretKey
      }).catch(() => undefined)
    }
  }

  let netPnl = grossPnl
  let fees = trade.fees
  if (trade.execMode === "paper") {
    const holdingHours = (now - trade.openedAt) / 1000 / 3600
    fees = calculateFees(trade.positionValue, holdingHours)
    netPnl = grossPnl - fees.totalFee
    engine.scalping2.paperAccount.balance = round2(
      engine.scalping2.paperAccount.balance + trade.margin + grossPnl - fees.closeFee - fees.fundingFee
    )
    engine.scalping2.paperAccount.totalFeesPaid = round2(engine.scalping2.paperAccount.totalFeesPaid + fees.closeFee + fees.fundingFee)
    engine.scalping2.paperAccount.totalGrossPnl = round2(engine.scalping2.paperAccount.totalGrossPnl + grossPnl)
    engine.scalping2.paperAccount.totalNetPnl = round2(engine.scalping2.paperAccount.totalNetPnl + netPnl)
  }

  const closed: EngineScalpTrade = {
    ...trade,
    status: "CLOSED",
    closedAt: now,
    closePrice,
    grossPnlUsd: round2(grossPnl),
    netPnlUsd: round2(netPnl),
    pnlUsd: round2(trade.execMode === "paper" ? netPnl : grossPnl),
    fees,
    closeReason: source === "MANUAL" ? "MANUAL" : trade.closeReason
  }

  engine.scalping2.openTrades = engine.scalping2.openTrades.filter((t) => t.id !== trade.id)
  engine.scalping2.closedTrades = engine.scalping2.closedTrades.filter((t) => t.id !== trade.id)
  engine.scalping2.closedTrades.unshift(closed)

  const reason = closed.closeReason ?? "CLOSED"
  const prefix = trade.execMode === "paper" ? "[PAPER SCALPING 2]" : "[LIVE SCALPING 2]"
  const title =
    reason === "SL_HIT"
      ? `❌ <b>${prefix} SL HIT</b>`
      : reason === "TP2_HIT"
        ? `🎯🎯 <b>${prefix} TP2 HIT — FULL TARGET</b>`
        : reason === "TRAIL_STOP"
          ? `✅ <b>${prefix} TRAIL STOP HIT</b>`
          : `✅ <b>${prefix} TRADE CLOSED</b>`

  if (trade.execMode === "paper") {
    const f = closed.fees ?? calculateFees(trade.positionValue, 0)
    const msg = `${title}
━━━━━━━━━━━━━━
📊 ${trade.symbol} ${trade.direction}
💵 Entry: $${trade.entryPrice.toFixed(6)}
💵 Exit:  $${closePrice.toFixed(6)}
Reason: ${reason}
━━━━━━━━━━━━━━
Gross PnL: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(4)}
━━━━━━━━━━━━━━
💸 Open fee:  -$${f.openFee.toFixed(4)}
💸 Close fee: -$${f.closeFee.toFixed(4)}
💸 Funding:   -$${f.fundingFee.toFixed(4)}
💸 Total fees:-$${f.totalFee.toFixed(4)}
━━━━━━━━━━━━━━
💰 NET PnL:  ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(4)}
━━━━━━━━━━━━━━
📈 Balance: $${engine.scalping2.paperAccount.balance.toFixed(4)}
📈 Total Net PnL: ${engine.scalping2.paperAccount.totalNetPnl >= 0 ? "+" : ""}$${engine.scalping2.paperAccount.totalNetPnl.toFixed(4)}
📈 Total Fees Paid: $${engine.scalping2.paperAccount.totalFeesPaid.toFixed(4)}`
    await sendTelegram(msg).catch(() => undefined)

    const analysis = await analyzeClosedScalpTrade({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      closePrice,
      grossPnlUsd: grossPnl,
      netPnlUsd: netPnl,
      totalFeesUsd: f.totalFee,
      openedAt: trade.openedAt,
      closedAt: now,
      closeReason: reason,
      timeframe: s.timeframe,
      score: trade.score,
      topFilters: trade.topFilters
    }).catch(() => null)
    if (analysis) {
      const verdict = typeof analysis.verdict === "string" ? analysis.verdict : "—"
      const reasonsArr = Array.isArray(analysis.reasons) ? analysis.reasons.map(String).filter(Boolean).slice(0, 6) : []
      const improvement = typeof analysis.improvement === "string" ? analysis.improvement : ""
      const confidence = typeof analysis.confidence_score === "number" ? analysis.confidence_score : undefined
      const msg2 = `🤖 <b>[SCALPING 2] AI ANALYSIS</b>
━━━━━━━━━━━━━━
${trade.symbol} ${trade.direction} | ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}
Verdict: ${verdict}
${reasonsArr.length ? reasonsArr.map((r: string) => `• ${r}`).join("\n") : "• —"}
${improvement ? `\nIMPROVEMENT: ${improvement}` : ""}
${confidence !== undefined ? `\nCONFIDENCE: ${confidence}/10` : ""}`
      await sendTelegram(msg2).catch(() => undefined)
    }
    return
  }

  const msg = `${title}
━━━━━━━━━━━━━━
${trade.symbol} ${trade.direction}
PnL: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(2)}
Reason: ${reason}`
  await sendTelegram(msg).catch(() => undefined)
  void s
}

async function sendScalp2Update(trade: EngineScalpTrade, currentPrice: number) {
  const now = Date.now()
  if (trade.lastTelegramAt && now - trade.lastTelegramAt < 10 * 60_000) return
  trade.lastTelegramAt = now
  const gross = computePnlUsd(trade, currentPrice)
  const pnl = trade.execMode === "paper" ? trade.netPnlUsd ?? trade.pnlUsd ?? gross : gross
  const hw = trade.trailing.highWaterMark
  const stop = hw - engine.scalping2.settings.trailDistance
  const msg = `⚡ <b>[SCALPING 2] UPDATE</b>
${trade.symbol} ${trade.direction} | ${pnl !== undefined && pnl >= 0 ? "+" : ""}$${(pnl ?? 0).toFixed(2)}
Phase: ${trade.trailing.phase} | HW: $${hw.toFixed(2)}
Trail stop: $${stop.toFixed(2)}`
  await sendTelegram(msg).catch(() => undefined)
}

function computeScalp2HourSummary(hour: string) {
  const closed = engine.scalping2.closedTrades.filter((t) => (t.closedAt ? hourKey(t.closedAt) === hour : false))
  const trades = closed.length
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const losses = closed.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const totalPnl = round2(closed.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))
  const best = closed.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
  const open = countOpenScalp2Groups()
  return { trades, wins, losses, totalPnl, best, open }
}

async function applySmartWickProtection2(trade: EngineScalpTrade, s: Scalp2Settings, grossPnl: number): Promise<Scalp2Settings> {
  if (!s.filters.wick_ratio) return s
  const now = Date.now()
  if (trade.lastWickCheckAt && now - trade.lastWickCheckAt < 60_000) return s
  trade.lastWickCheckAt = now

  const candles = await fetchScalpKlines(trade.symbol, s.timeframe, 30).catch(() => [])
  if (candles.length < 10) return s

  const last = candles[candles.length - 1]
  if (!last) return s
  const body = Math.abs(last.close - last.open)
  const upperWick = last.high - Math.max(last.open, last.close)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const wickRatio = upperWick / (body + 1e-6)
  const lowerWickRatio = lowerWick / (body + 1e-6)
  const isWickCandle = wickRatio > 1.5 || lowerWickRatio > 1.5
  if (!isWickCandle) return s

  const prev3 = candles.slice(-4, -1)
  if (prev3.length < 3) return s
  const trendStrong = prev3.filter((c) => (trade.direction === "LONG" ? c.close > c.open : c.close < c.open)).length >= 2
  const avgVol = prev3.reduce((sum, c) => sum + c.volume, 0) / prev3.length
  const wickVolumeHigh = avgVol > 0 ? last.volume > avgVol * 1.5 : false
  const mid = (last.high + last.low) / 2
  const recoveredFromWick = trade.direction === "LONG" ? last.close > mid : last.close < mid
  const dangerous = wickVolumeHigh && !recoveredFromWick && !trendStrong
  if (!dangerous) return s

  if (grossPnl <= 0) {
    trade.closeReason = "MANUAL"
    await closeScalp2Trade(trade, "AUTO", last.close).catch(() => undefined)
    return s
  }

  const tightened = Math.max(0.5, s.trailDistance * 0.6)
  if (tightened >= s.trailDistance) return s
  await sendTelegram(
    `⚠️ <b>[SCALPING 2] WICK DANGER — TIGHTEN TRAIL</b>\n${trade.symbol} ${trade.direction}\nTrail: ${s.trailDistance.toFixed(
      2
    )} → ${tightened.toFixed(2)}`
  ).catch(() => undefined)
  return { ...s, trailDistance: tightened }
}

async function openPaperScalpTrade(signal: ScalpSignal, settings: ScalpSettings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenTradeForSymbol(signal.symbol)) return
  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price
  const fees = calculateFees(positionValue, 0)

  const required = margin + fees.openFee
  if (engine.scalping.paperAccount.balance < required) {
    await sendTelegram(
      `🚨 <b>[PAPER SCALPING 1] CANCELLED — INSUFFICIENT BALANCE</b>\nRequired: $${required.toFixed(2)}\nAvailable: $${engine.scalping.paperAccount.balance.toFixed(2)}`
    ).catch(() => undefined)
    return
  }

  engine.scalping.paperAccount.balance = round2(engine.scalping.paperAccount.balance - required)
  engine.scalping.paperAccount.totalFeesPaid = round2(engine.scalping.paperAccount.totalFeesPaid + fees.openFee)

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `paper-${groupId}`

  const trade: EngineScalpTrade = {
    id,
    groupId,
    execMode: "paper",
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    score: signal.score,
    topFilters: signal.topFilters,
    openedAt,
    status: "OPEN",
    fees,
    grossPnlUsd: 0,
    netPnlUsd: round2(-fees.openFee),
    pnlUsd: round2(-fees.openFee),
    trailing: {
      phase: "INITIAL",
      tp1Amount: settings.tp1Amount,
      tp2Amount: settings.tp2Amount,
      slAmount: settings.slAmount,
      trailDistance: settings.trailDistance,
      lockedPnl: 0,
      highWaterMark: 0,
      active: settings.trailingEnabled
    }
  }

  engine.scalping.openTrades.unshift(trade)

  const pr = signal.patternResult
  const patternList = pr?.allPatterns?.length
    ? pr.allPatterns
        .map((p) => `${p.strength === "STRONG" ? "🔥" : p.strength === "MODERATE" ? "✅" : "⚡"} ${p.name} (${p.reliability}%)`)
        .join("\n")
    : pr?.strongestPattern ?? "—"
  const strongest = pr?.pattern?.name ?? pr?.strongestPattern ?? "—"
  const strength = pr?.pattern?.strength ?? "—"
  const reliability = pr?.pattern?.reliability ?? pr?.reliability ?? 0
  const patternScore = pr?.score ?? 0

  const msg = `⚡ <b>[PAPER SCALPING 1] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
💰 Margin: $${margin.toFixed(2)} | Lev: ${leverage}x
📊 Position: $${positionValue.toFixed(2)}
━━━━━━━━━━━━━━
💸 Open Fee: -$${fees.openFee.toFixed(4)} (0.05%)
💳 Balance after fee: $${engine.scalping.paperAccount.balance.toFixed(4)}
━━━━━━━━━━━━━━
🕯 PATTERN DETECTED:
${patternList}
━━━━━━━━━━━━━━
Strongest: ${strongest}
Strength: ${strength}
Reliability: ${reliability}%
Pattern score: +${patternScore}/30
━━━━━━━━━━━━━━
🎯 TP1: +$${settings.tp1Amount} → then trail
🎯 TP2: +$${settings.tp2Amount}
🛑 SL:  -$${settings.slAmount}`
  await sendTelegram(msg).catch(() => undefined)
}

async function openLiveScalpTrade(signal: ScalpSignal, settings: ScalpSettings, meta?: { openedAt: number; groupId: string }) {
  if (hasOpenTradeForSymbol(signal.symbol)) return
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) return

  const price = await fetchLivePrice(signal.symbol)
  const margin = Math.max(0, settings.marginPerTrade)
  const leverage = Math.max(1, Math.floor(settings.leverage))
  const positionValue = margin * leverage
  const quantity = positionValue / price

  const openedAt = meta?.openedAt ?? Date.now()
  const groupId = meta?.groupId ?? `${signal.symbol}-${openedAt}`
  const id = `live-${groupId}`

  const trade: EngineScalpTrade = {
    id,
    groupId,
    execMode: "live",
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: price,
    quantity,
    margin,
    leverage,
    positionValue,
    score: signal.score,
    topFilters: signal.topFilters,
    openedAt,
    status: "OPEN",
    trailing: {
      phase: "INITIAL",
      tp1Amount: settings.tp1Amount,
      tp2Amount: settings.tp2Amount,
      slAmount: settings.slAmount,
      trailDistance: settings.trailDistance,
      lockedPnl: 0,
      highWaterMark: 0,
      active: settings.trailingEnabled
    }
  }

  await setLeverageForSymbol(signal.symbol, signal.direction, leverage, apiKey, secretKey).catch(() => undefined)
  const order = await placeOrder({
    symbol: signal.symbol,
    tradeSide: signal.direction,
    intent: "OPEN",
    orderType: "MARKET",
    quantity,
    reduceOnly: false,
    apiKey,
    secretKey
  })
  const orderId = (order as any)?.data?.orderId
  if (orderId) trade.orderId = String(orderId)

  engine.scalping.openTrades.unshift(trade)

  const pr = signal.patternResult
  const patternList = pr?.allPatterns?.length
    ? pr.allPatterns
        .map((p) => `${p.strength === "STRONG" ? "🔥" : p.strength === "MODERATE" ? "✅" : "⚡"} ${p.name} (${p.reliability}%)`)
        .join("\n")
    : pr?.strongestPattern ?? "—"
  const strongest = pr?.pattern?.name ?? pr?.strongestPattern ?? "—"
  const strength = pr?.pattern?.strength ?? "—"
  const reliability = pr?.pattern?.reliability ?? pr?.reliability ?? 0
  const patternScore = pr?.score ?? 0

  const msg = `⚡ <b>[LIVE SCALPING 1] TRADE OPENED</b>
━━━━━━━━━━━━━━
📊 ${signal.symbol} ${signal.direction}
💵 Entry: $${price.toFixed(6)}
💰 Margin: $${margin.toFixed(2)} | Lev: ${leverage}x
🆔 Order: ${trade.orderId ?? "—"}
━━━━━━━━━━━━━━
🕯 PATTERN DETECTED:
${patternList}
━━━━━━━━━━━━━━
Strongest: ${strongest}
Strength: ${strength}
Reliability: ${reliability}%
Pattern score: +${patternScore}/30
━━━━━━━━━━━━━━
🎯 TP1: +$${settings.tp1Amount}
🎯 TP2: +$${settings.tp2Amount}
🛑 SL:  -$${settings.slAmount}`
  await sendTelegram(msg).catch(() => undefined)
}

async function closeScalpTrade(trade: EngineScalpTrade, source: "AUTO" | "MANUAL", currentPrice: number) {
  if (engine.scalping.closedTrades.some((t) => t.id === trade.id && t.status === "CLOSED")) return
  if (!engine.scalping.openTrades.some((t) => t.id === trade.id && t.status === "OPEN")) return

  const s = engine.scalping.settings
  const now = Date.now()
  const closePrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : await fetchLivePrice(trade.symbol).catch(() => trade.entryPrice)
  const grossPnl = computePnlUsd(trade, closePrice)

  if (trade.execMode === "live") {
    const apiKey = process.env.BINGX_API_KEY
    const secretKey = process.env.BINGX_SECRET_KEY
    if (apiKey && secretKey) {
      await placeOrder({
        symbol: trade.symbol,
        tradeSide: trade.direction,
        intent: "CLOSE",
        orderType: "MARKET",
        quantity: trade.quantity,
        reduceOnly: true,
        apiKey,
        secretKey
      }).catch(() => undefined)
    }
  }

  let netPnl = grossPnl
  let fees = trade.fees
  if (trade.execMode === "paper") {
    const holdingHours = (now - trade.openedAt) / 1000 / 3600
    fees = calculateFees(trade.positionValue, holdingHours)
    netPnl = grossPnl - fees.totalFee
    engine.scalping.paperAccount.balance = round2(
      engine.scalping.paperAccount.balance + trade.margin + grossPnl - fees.closeFee - fees.fundingFee
    )
    engine.scalping.paperAccount.totalFeesPaid = round2(engine.scalping.paperAccount.totalFeesPaid + fees.closeFee + fees.fundingFee)
    engine.scalping.paperAccount.totalGrossPnl = round2(engine.scalping.paperAccount.totalGrossPnl + grossPnl)
    engine.scalping.paperAccount.totalNetPnl = round2(engine.scalping.paperAccount.totalNetPnl + netPnl)
  }

  const closed: EngineScalpTrade = {
    ...trade,
    status: "CLOSED",
    closedAt: now,
    closePrice,
    grossPnlUsd: round2(grossPnl),
    netPnlUsd: round2(netPnl),
    pnlUsd: round2(trade.execMode === "paper" ? netPnl : grossPnl),
    fees,
    closeReason: source === "MANUAL" ? "MANUAL" : trade.closeReason
  }

  engine.scalping.openTrades = engine.scalping.openTrades.filter((t) => t.id !== trade.id)
  engine.scalping.closedTrades = engine.scalping.closedTrades.filter((t) => t.id !== trade.id)
  engine.scalping.closedTrades.unshift(closed)

  const reason = closed.closeReason ?? "CLOSED"
  const prefix = trade.execMode === "paper" ? "[PAPER SCALPING 1]" : "[LIVE SCALPING 1]"
  const title =
    reason === "SL_HIT"
      ? `❌ <b>${prefix} SL HIT</b>`
      : reason === "TP2_HIT"
        ? `🎯🎯 <b>${prefix} TP2 HIT — FULL TARGET</b>`
        : reason === "TRAIL_STOP"
          ? `✅ <b>${prefix} TRAIL STOP HIT</b>`
          : `✅ <b>${prefix} TRADE CLOSED</b>`

  if (trade.execMode === "paper") {
    const f = closed.fees ?? calculateFees(trade.positionValue, 0)
    const msg = `${title}
━━━━━━━━━━━━━━
📊 ${trade.symbol} ${trade.direction}
💵 Entry: $${trade.entryPrice.toFixed(6)}
💵 Exit:  $${closePrice.toFixed(6)}
Reason: ${reason}
━━━━━━━━━━━━━━
Gross PnL: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(4)}
━━━━━━━━━━━━━━
💸 Open fee:  -$${f.openFee.toFixed(4)}
💸 Close fee: -$${f.closeFee.toFixed(4)}
💸 Funding:   -$${f.fundingFee.toFixed(4)}
💸 Total fees:-$${f.totalFee.toFixed(4)}
━━━━━━━━━━━━━━
💰 NET PnL:  ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(4)}
━━━━━━━━━━━━━━
📈 Balance: $${engine.scalping.paperAccount.balance.toFixed(4)}
📈 Total Net PnL: ${engine.scalping.paperAccount.totalNetPnl >= 0 ? "+" : ""}$${engine.scalping.paperAccount.totalNetPnl.toFixed(4)}
📈 Total Fees Paid: $${engine.scalping.paperAccount.totalFeesPaid.toFixed(4)}`
    await sendTelegram(msg).catch(() => undefined)

    const analysis = await analyzeClosedScalpTrade({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      closePrice,
      grossPnlUsd: grossPnl,
      netPnlUsd: netPnl,
      totalFeesUsd: f.totalFee,
      openedAt: trade.openedAt,
      closedAt: now,
      closeReason: reason,
      timeframe: s.timeframe,
      score: trade.score,
      topFilters: trade.topFilters
    }).catch(() => null)
    if (analysis) {
      const verdict = typeof analysis.verdict === "string" ? analysis.verdict : "—"
      const reasonsArr = Array.isArray(analysis.reasons) ? analysis.reasons.map(String).filter(Boolean).slice(0, 6) : []
      const improvement = typeof analysis.improvement === "string" ? analysis.improvement : ""
      const confidence = typeof analysis.confidence_score === "number" ? analysis.confidence_score : undefined
      const msg2 = `🤖 <b>[SCALPING 1] AI ANALYSIS</b>
━━━━━━━━━━━━━━
${trade.symbol} ${trade.direction} | ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}
Verdict: ${verdict}
${reasonsArr.length ? reasonsArr.map((r: string) => `• ${r}`).join("\n") : "• —"}
${improvement ? `\nIMPROVEMENT: ${improvement}` : ""}
${confidence !== undefined ? `\nCONFIDENCE: ${confidence}/10` : ""}`
      await sendTelegram(msg2).catch(() => undefined)
    }
    return
  }

  const msg = `${title}
━━━━━━━━━━━━━━
${trade.symbol} ${trade.direction}
PnL: ${grossPnl >= 0 ? "+" : ""}$${grossPnl.toFixed(2)}
Reason: ${reason}`
  await sendTelegram(msg).catch(() => undefined)
  void s
}

async function sendScalpUpdate(trade: EngineScalpTrade, currentPrice: number) {
  const now = Date.now()
  if (trade.lastTelegramAt && now - trade.lastTelegramAt < 10 * 60_000) return
  trade.lastTelegramAt = now
  const gross = computePnlUsd(trade, currentPrice)
  const pnl = trade.execMode === "paper" ? trade.netPnlUsd ?? trade.pnlUsd ?? gross : gross
  const hw = trade.trailing.highWaterMark
  const stop = hw - engine.scalping.settings.trailDistance
  const msg = `⚡ <b>[SCALPING 1] UPDATE</b>
${trade.symbol} ${trade.direction} | ${pnl !== undefined && pnl >= 0 ? "+" : ""}$${(pnl ?? 0).toFixed(2)}
Phase: ${trade.trailing.phase} | HW: $${hw.toFixed(2)}
Trail stop: $${stop.toFixed(2)}`
  await sendTelegram(msg).catch(() => undefined)
}

function computeScalpHourSummary(hour: string) {
  const closed = engine.scalping.closedTrades.filter((t) => (t.closedAt ? hourKey(t.closedAt) === hour : false))
  const trades = closed.length
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const losses = closed.filter((t) => (t.pnlUsd ?? 0) < 0).length
  const totalPnl = round2(closed.reduce((a, b) => a + (b.pnlUsd ?? 0), 0))
  const best = closed.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
  const open = countOpenScalpGroups()
  return { trades, wins, losses, totalPnl, best, open }
}

async function sendTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (token && chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" })
    }).catch(() => undefined)
    return
  }

  const url = String(process.env.BOT_TELEGRAM_SEND_URL ?? "http://localhost:3000/api/telegram/send")
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  }).catch(() => undefined)
}

async function sendTelegramDocument(opts: { caption: string; base64: string; filename: string; mimeType?: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (token && chatId) {
    const bytes = Buffer.from(opts.base64, "base64")
    const blob = new Blob([Uint8Array.from(bytes)], { type: opts.mimeType ?? "application/octet-stream" })
    const form = new FormData()
    form.set("chat_id", chatId)
    form.set("caption", opts.caption)
    form.set("parse_mode", "HTML")
    form.set("document", blob, opts.filename || "report.pdf")
    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form as any }).catch(() => undefined)
    return
  }

  const url = String(process.env.BOT_TELEGRAM_SEND_URL ?? "http://localhost:3000/api/telegram/send")
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.caption,
      documentBase64: opts.base64,
      filename: opts.filename,
      mimeType: opts.mimeType
    })
  }).catch(() => undefined)
}

async function sendWeeklyPdfReport() {
  log("▶ Weekly PDF report job triggered (Sunday 09:00 UTC)")
  const input = buildWeeklyReportFromBotState({ nowMs: Date.now() })
  const pdf = generateWeeklyPerformancePdfBase64(input)
  const caption = buildWeeklyReportTelegramCaption(pdf)
  await sendTelegramDocument({ caption, base64: pdf.base64, filename: pdf.filename, mimeType: pdf.mimeType })
}

async function analyzeClosedScalpTrade(trade: {
  symbol: string
  direction: "LONG" | "SHORT"
  entryPrice: number
  closePrice: number
  grossPnlUsd: number
  netPnlUsd: number
  totalFeesUsd: number
  openedAt: number
  closedAt: number
  closeReason: string
  timeframe: string
  score: number
  topFilters: string[]
}): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  const holdMins = (trade.closedAt - trade.openedAt) / 60000
  const prompt = `
You are an expert crypto scalping analyst.
Analyze this completed scalp trade and give direct, actionable feedback.
Respond ONLY in JSON.

TRADE:
Symbol: ${trade.symbol}
Direction: ${trade.direction}
Entry: ${trade.entryPrice}
Exit: ${trade.closePrice}
Duration minutes: ${holdMins.toFixed(1)}
Close reason: ${trade.closeReason}
Timeframe: ${trade.timeframe}
Score at entry: ${trade.score}/100
Top filters: ${trade.topFilters.join(", ")}
Gross PnL: ${trade.grossPnlUsd.toFixed(4)}
Fees: ${trade.totalFeesUsd.toFixed(4)}
Net PnL: ${trade.netPnlUsd.toFixed(4)}

Return JSON:
{
  "verdict": "one line summary",
  "result": "WIN" or "LOSS",
  "reasons": ["reason1", "reason2", "reason3"],
  "what_worked": "string or null",
  "what_failed": "string or null",
  "key_mistake": "biggest error made or null",
  "improvement": "one specific thing to do better",
  "should_have_taken": true or false,
  "confidence_score": 1-10,
  "pattern_quality": "EXCELLENT/GOOD/AVERAGE/POOR",
  "timing_quality": "EXCELLENT/GOOD/AVERAGE/POOR"
}
`.trim()

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
      })
    })
    const data = (await res.json()) as any
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== "string" || !text.trim()) return null
    const cleaned = text.replace(/```json|```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

async function setLeverageForSymbol(symbol: string, tradeSide: "LONG" | "SHORT", leverage: number, apiKey: string, secretKey: string) {
  const trySet = async (side: "LONG" | "SHORT" | "BOTH") => {
    return bingxRequest<any>({
      method: "POST",
      path: "/openApi/swap/v2/trade/leverage",
      params: { symbol, leverage, side },
      apiKey,
      secretKey
    })
  }
  try {
    await trySet(tradeSide)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    const oneWay = msg.includes("PositionSide") || msg.toLowerCase().includes("one-way") || msg.toLowerCase().includes("one way")
    if (!oneWay) throw e
    await trySet("BOTH")
  }
}

async function placeOrder(opts: {
  symbol: string
  tradeSide: "LONG" | "SHORT"
  intent: "OPEN" | "CLOSE"
  orderType: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET"
  quantity: number
  price?: number
  stopPrice?: number
  reduceOnly: boolean
  apiKey: string
  secretKey: string
}) {
  const openSide = opts.tradeSide === "LONG" ? "BUY" : "SELL"
  const closeSide = opts.tradeSide === "LONG" ? "SELL" : "BUY"
  const side = opts.intent === "CLOSE" ? closeSide : openSide

  const place = async (reduceOnly: boolean) => {
    return bingxRequest<any>({
      method: "POST",
      path: "/openApi/swap/v2/trade/order",
      params: {
        symbol: opts.symbol,
        type: opts.orderType,
        side,
        positionSide: opts.tradeSide,
        quantity: opts.quantity,
        price: opts.orderType === "LIMIT" ? opts.price : undefined,
        stopPrice: opts.stopPrice,
        reduceOnly: reduceOnly ? "true" : undefined
      },
      apiKey: opts.apiKey,
      secretKey: opts.secretKey
    })
  }

  try {
    return await place(opts.reduceOnly)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    const hedgeReduceOnlyError = msg.includes("code=109400") || msg.toLowerCase().includes("hedge mode") || msg.toLowerCase().includes("reduceonly")
    if (opts.intent === "CLOSE" && opts.reduceOnly && hedgeReduceOnlyError) return await place(false)
    throw e
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function parseSymbolsEnv(v: unknown): string[] | null {
  const s = String(v ?? "").trim()
  if (!s) return null
  const out = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
  return out.length ? out : null
}
