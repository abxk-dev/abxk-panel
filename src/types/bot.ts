export type ExecutionMode = "paper" | "live" | "mirror"

export type Timeframe = "15m" | "1h" | "4h" | "1d"

export type TradeSide = "LONG" | "SHORT"

export type OrderType = "MARKET" | "LIMIT"

export type SlMode = "fixedPct" | "atr"

export type TpMode = "fixedPct" | "rr"

export type WorkingType = "MARK_PRICE" | "CONTRACT_PRICE" | "INDEX_PRICE"

export type FilterKey =
  | "trendEma"
  | "volumeSpike"
  | "atrVolatility"
  | "rsi"
  | "macd"
  | "bbSqueeze"
  | "fibGoldenPocket"
  | "stochRsi"
  | "macdDivergence"
  | "openInterest"
  | "liquidity"
  | "fundingRate"
  | "fundingHardBlock"
  | "session"
  | "htfDailyBias"
  | "newsBlackout"
  | "oiDivergence"
  | "fearGreed"
  | "liquidationTp"

export type Candle = {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type FilterToggles = Record<FilterKey, boolean>

export type FilterScores = Record<FilterKey, number>

export type StrategySnapshot = {
  totalScore: number
  scores: FilterScores
  reasons: string[]
  blocked: boolean
  blocks: string[]
  indicators: StrategyIndicators
  asOf: number
}

export type StrategyIndicators = {
  ema20?: number
  ema50?: number
  ema200?: number
  rsi14?: number
  atr14?: number
  volumeRatio?: number
  bbBandwidthPct?: number
  bbBandwidthPctAvg20?: number
  fibInGoldenPocket?: boolean
  fibLevel?: number
  stochRsiK?: number
  stochRsiD?: number
  macdLine?: number
  macdSignal?: number
  macdHist?: number
  macdDivergence?: "REGULAR_BULLISH" | "HIDDEN_BULLISH" | "REGULAR_BEARISH" | "HIDDEN_BEARISH" | "NONE"
  openInterest?: number
  openInterestChangePct?: number
  spreadPct?: number
  fundingRatePct?: number
  fearGreed?: number
  dailyBias?: TradeSide
  inNewsBlackout?: boolean
}

export type TradeResult = "WIN" | "LOSS"

export type TradeExitReason = "TP hit" | "SL hit" | "Trailing" | "Manual"

export type MarketRegime = "TRENDING_BULL" | "TRENDING_BEAR" | "RANGING" | "VOLATILE"

export type JournalExitReason = "TP_HIT" | "SL_HIT" | "MANUAL" | "TRAILING"

export type TradeJournalEntry = {
  id: string
  timestamp: number
  symbol: string
  direction: "LONG" | "SHORT"
  chartImageBase64?: string
  entryPrice: number
  exitPrice: number
  stopLoss: number
  takeProfit: number
  result: "WIN" | "LOSS" | "OPEN"
  pnl: number
  pnlPercent: number
  duration: string
  setupScore: number
  compoundLevel: number
  equityBefore: number
  equityAfter: number
  timeframe: string
  regime: string
  exitReason: JournalExitReason
  filters: {
    emaTrend: string
    rsi: number
    volumeRatio: number
    atr: number
    macd: string
    fundingRate: number
    oiChange: number
    fearGreed: number
    fibLevel: string
    session: string
    dailyBias: string
    regime: string
    btcCorrelation: string
    dxy: string
  }
  aiAnalysis: string
  notes: string
}

export type Trade = {
  id: string
  mode: "paper" | "live"
  symbol: string
  timeframe: Timeframe
  side: TradeSide
  orderType: OrderType
  quantity: number
  leverage: number
  entryPrice: number
  initialStopLossPrice?: number
  stopLossPrice: number
  takeProfitPrice: number
  tp2Price?: number
  tp3Price?: number
  tpStage?: 1 | 2 | 3
  realizedPnlUsd?: number
  peakPrice?: number
  trailingActive?: boolean
  lastTrailingUpdateAt?: number
  setupScore?: number
  indicators?: StrategyIndicators
  openedAt: number
  closedAt?: number
  exitPrice?: number
  pnlUsd?: number
  pnlPct?: number
  status: "OPEN" | "CLOSED"
  exitReason?: TradeExitReason
  aiProvider?: "Gemini" | "Groq"
  aiAnalysis?: string
  regime?: MarketRegime
}

export type EquityPoint = {
  time: number
  equity: number
}

export type DailyPnlPoint = {
  day: string
  pnlUsd: number
}

export type Settings = {
  mode: ExecutionMode
  symbol: string
  timeframe: Timeframe
  maxTradesPerDay: number
  minSetupScore: number
  filters: FilterToggles
  thresholds: {
    volumeSpikeMultiplier: number
    atrMin: number
    atrMax: number
    maxSpreadPct: number
    maxFundingRatePct: number
    fundingHardBlockPct: number
    londonNyOverlapStartUtcHour: number
    londonNyOverlapEndUtcHour: number
    bbSqueezePctOfAvg: number
    fibLookbackCandles: number
    newsBlackoutMinutes: number
    fearGreedLongOnlyBelow: number
    fearGreedShortOnlyAbove: number
    liquidationExchange: string
    liquidationSymbol: string
    liquidationRange: string
    liquidationTpOffsetPct: number
  }
  features: {
    marketRegime: boolean
    correlationFilter: boolean
    patternRecognition: boolean
    smc: boolean
    onChain: boolean
    sentiment: boolean
    disasterRecovery: boolean
    adaptiveLevels: boolean
    scanner: boolean
    selfLearner: boolean
    liquidationHeatmap: boolean
    journal: boolean
    preTradeAlerts: boolean
    marketMonitor: boolean
    projection: boolean
    partialProfitLock: boolean
    newsFilter: boolean
    healthCheck: boolean
    whaleAlert: boolean
  }
  notifications: {
    regime: boolean
    correlation: boolean
    patternRecognition: boolean
    smc: boolean
    onChain: boolean
    sentiment: boolean
    disasterRecovery: boolean
    scanner: boolean
    selfLearner: boolean
    liquidationHeatmap: boolean
    journal: boolean
    preTrade: boolean
    marketMonitor: boolean
    projection: boolean
    partialProfitLock: boolean
    health: boolean
    whale: boolean
  }
  capital: {
    initialCapitalUsd: number
  }
  compounding: {
    levels: number
    profitTargetPct: number
    riskPctOfBalance: number
  }
  partialProfitLock: {
    triggerPctOfLevelTarget: number
    lockPctOfProfitSoFar: number
  }
  risk: {
    leverage: number
    slMode: SlMode
    slFixedPct: number
    slAtrMultiplier: number
    tpMode: TpMode
    tpFixedPct: number
    rrRatio: number
    trailingStopEnabled: boolean
    trailingActivationPct: number
    dailyLossLimitUsd: number
    maxDrawdownPct: number
  }
}
