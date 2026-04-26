import fs from "fs"
import path from "path"
import cron from "node-cron"
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
  calculateFees,
  computePnlUsd,
  manageScalpTrade,
  scanScalpLeaderboard,
  settingsFromEnv,
  type ScalpSettings,
  type ScalpSignal,
  type ScalpTimeframe,
  type ScalpTrade
} from "@/lib/scalpEngine"
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
}

const ROOT = path.resolve(__dirname, "..")
const STATE_PATH = path.join(ROOT, "bot-state.json")
const SCALP_STATE_PATH = path.join(ROOT, "scalp-state.json")

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
  }
}

restoreScalpingStateFromDisk()

log(`▶ Bot engine started — ${mode.toUpperCase()} MODE`)

let healthTimer: NodeJS.Timeout | null = null
let stateTimer: NodeJS.Timeout | null = null
let candleTimer: NodeJS.Timeout | null = null
let commandTimer: NodeJS.Timeout | null = null
let scalpScanTimer: NodeJS.Timeout | null = null
let scalpUpdateTimer: NodeJS.Timeout | null = null
let scalpCommandTimer: NodeJS.Timeout | null = null
let scalpSummaryTimer: NodeJS.Timeout | null = null
let scalpScanInFlight = false
const scalpOpenLocks = new Map<string, number>()

startWebSocketPriceFeed(scanSymbols ?? [symbol])
startHealthMonitor()
startScheduledJobs()
startMainLoop()
startStateSaver()
startCommandListener()
startScalpingEngine()

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

    if (openTrades.length) engine.scalping.openTrades = dedupeOpenTrades(openTrades)
    if (closedTrades.length) engine.scalping.closedTrades = closedTrades
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
  }
  void tick()
  stateTimer = setInterval(() => void tick(), 30_000)
}

async function writeJsonAtomic(filePath: string, obj: unknown) {
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp`
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
  stopPriceWebSocket()
  await writeJsonAtomic(STATE_PATH, engine).catch(() => undefined)
  await writeJsonAtomic(SCALP_STATE_PATH, buildScalpStateSnapshot()).catch(() => undefined)
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
        const msg = `🎯 <b>[SCALP] TP1 HIT — TRAILING ACTIVE</b>
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
    const msg = `📊 <b>[SCALP] HOUR SUMMARY</b>
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
    `⚠️ <b>[SCALP] WICK DANGER — TIGHTEN TRAIL</b>\n${trade.symbol} ${trade.direction}\nTrail: ${s.trailDistance.toFixed(
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

function hasOpenTradeForSymbol(symbol: string): boolean {
  return engine.scalping.openTrades.some((t) => t.status === "OPEN" && t.symbol === symbol)
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
      `🛑 <b>[SCALP] DAILY LOSS LIMIT HIT</b>\nLoss today: $${Math.abs(pnlToday).toFixed(2)}\nLimit: $${maxLoss.toFixed(
        2
      )}\nScalping paused until next UTC day`
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

function loadScalpSettings(): ScalpSettings {
  return settingsFromEnv(process.env)
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

async function fetchScalpKlines(symbol: string, interval: ScalpTimeframe, limit: number): Promise<Candle[]> {
  const url = new URL("https://open-api.bingx.com/openApi/swap/v3/quote/klines")
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("interval", interval)
  url.searchParams.set("limit", String(limit))
  const res = await fetch(url.toString(), { cache: "no-store" })
  const json = (await res.json()) as any
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
  const msg = `⚡ <b>[SCALP] MIRROR MODE</b>
━━━━━━━━━━━━━━
Paper: ${paperResult.status === "fulfilled" ? "✅" : "❌"}
Live: ${liveResult.status === "fulfilled" ? "✅" : "❌"}`
  await sendTelegram(msg).catch(() => undefined)
  } finally {
    releaseOpenLock(signal.symbol)
  }
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
      `🚨 <b>[PAPER SCALP] CANCELLED — INSUFFICIENT BALANCE</b>\nRequired: $${required.toFixed(2)}\nAvailable: $${engine.scalping.paperAccount.balance.toFixed(2)}`
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

  const msg = `⚡ <b>[PAPER SCALP] TRADE OPENED</b>
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

  const msg = `⚡ <b>[LIVE SCALP] TRADE OPENED</b>
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
  engine.scalping.closedTrades.unshift(closed)

  const reason = closed.closeReason ?? "CLOSED"
  const prefix = trade.execMode === "paper" ? "[PAPER SCALP]" : "[LIVE SCALP]"
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
      const msg2 = `🤖 <b>[SCALP] AI ANALYSIS</b>
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
  const msg = `⚡ <b>[SCALP] UPDATE</b>
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
  const url = String(process.env.BOT_TELEGRAM_SEND_URL ?? "http://localhost:3000/api/telegram/send")
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  }).catch(() => undefined)
}

async function sendTelegramDocument(opts: { caption: string; base64: string; filename: string; mimeType?: string }) {
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
  orderType: "MARKET" | "LIMIT"
  quantity: number
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

