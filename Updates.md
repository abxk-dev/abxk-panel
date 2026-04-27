Add new "SCALPING 3" module to the bot.
Strategy: SMC + Volume only — clean and powerful.

═══════════════════════════════════════
SIDEBAR — Add new item
═══════════════════════════════════════

Add to sidebar:
{ icon: '⚡', label: 'Scalping 3', path: '/dashboard/scalping-3' }

═══════════════════════════════════════
PART 1 — SMC ENGINE
/lib/scalping3/smcEngine.ts
═══════════════════════════════════════

Best timeframe for SMC + Volume scalping:
PRIMARY:   5M  (entry trigger)
CONFIRM:   15M (structure confirmation)
BIAS:      1H  (overall direction)

Best sessions:
BEST:    London/NY Overlap 13:00-16:00 UTC (18:30-21:30 IST)
GOOD:    NY Open 13:00-17:00 UTC
GOOD:    London Open 08:00-11:00 UTC
AVOID:   Asian session 00:00-07:00 UTC (low volume)
AVOID:   Weekend

interface SMCData {
  // Order Blocks
  demandOB: OrderBlock | null    // bullish OB
  supplyOB: OrderBlock | null    // bearish OB
  atOBZone: boolean              // price at OB right now
  obType: 'DEMAND' | 'SUPPLY' | 'NONE'

  // Fair Value Gaps
  bullishFVG: FVG | null
  bearishFVG: FVG | null
  atFVGZone: boolean

  // Break of Structure
  bos: BOS
  bosDirection: 'BULLISH' | 'BEARISH' | 'NONE'
  bosConfirmed: boolean

  // Liquidity
  liquidityAbove: number    // where stops are above
  liquidityBelow: number    // where stops are below
  sweepDetected: boolean
  sweepType: 'HIGH' | 'LOW' | 'NONE'

  // Overall SMC bias
  smcBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  smcScore: number           // 0-100
  entryValid: boolean
  entryDirection: 'LONG' | 'SHORT' | 'NONE'
}

// ─── ORDER BLOCK DETECTION ───
function detectOrderBlocks(candles: Candle[]): {
  demand: OrderBlock | null
  supply: OrderBlock | null
} {
  const demand: OrderBlock[] = []
  const supply: OrderBlock[] = []

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]
    const prev = candles[i - 1]
    const next1 = candles[i + 1]
    const next2 = candles[i + 2]

    const bodySize = Math.abs(c.close - c.open)
    const isBearish = c.close < c.open
    const isBullish = c.close > c.open

    // DEMAND Order Block:
    // Last bearish candle before strong bullish move
    const bullMoveAfter = next1.close > c.high && next2.close > c.high
    if (isBearish && bullMoveAfter) {
      const moveStrength = (next2.close - c.low) / c.low * 100
      if (moveStrength > 0.3) {
        demand.push({
          high:   c.open,         // top of OB (bearish candle open)
          low:    c.low,          // bottom with wick
          mid:    (c.open + c.low) / 2,
          index:  i,
          strength: moveStrength > 1 ? 'STRONG' : 'MODERATE',
          tested: false,
          valid:  true,
          timestamp: c.time
        })
      }
    }

    // SUPPLY Order Block:
    // Last bullish candle before strong bearish move
    const bearMoveAfter = next1.close < c.low && next2.close < c.low
    if (isBullish && bearMoveAfter) {
      const moveStrength = (c.high - next2.close) / c.high * 100
      if (moveStrength > 0.3) {
        supply.push({
          high:   c.high,
          low:    c.close,        // bottom of OB (bullish candle close)
          mid:    (c.high + c.close) / 2,
          index:  i,
          strength: moveStrength > 1 ? 'STRONG' : 'MODERATE',
          tested: false,
          valid:  true,
          timestamp: c.time
        })
      }
    }
  }

  // Get most recent valid OBs
  const currentPrice = candles[candles.length - 1].close

  // Filter: only OBs that haven't been violated
  const validDemand = demand.filter(ob => currentPrice > ob.low * 0.998)
  const validSupply = supply.filter(ob => currentPrice < ob.high * 1.002)

  // Get nearest relevant OB
  const nearestDemand = validDemand
    .filter(ob => ob.high < currentPrice)
    .sort((a, b) => b.high - a.high)[0] || null

  const nearestSupply = validSupply
    .filter(ob => ob.low > currentPrice)
    .sort((a, b) => a.low - b.low)[0] || null

  return { demand: nearestDemand, supply: nearestSupply }
}

// ─── FVG DETECTION ───
function detectFVG(candles: Candle[]): {
  bullish: FVG | null
  bearish: FVG | null
} {
  const bullishFVGs: FVG[] = []
  const bearishFVGs: FVG[] = []
  const currentPrice = candles[candles.length - 1].close

  for (let i = 1; i < candles.length - 1; i++) {
    const c1 = candles[i - 1]
    const c2 = candles[i]      // impulse candle
    const c3 = candles[i + 1]

    // Bullish FVG: gap between c1 high and c3 low
    if (c1.high < c3.low && c2.close > c2.open) {
      const gapSize = (c3.low - c1.high) / c2.close * 100
      if (gapSize > 0.05) {
        bullishFVGs.push({
          top:      c3.low,
          bottom:   c1.high,
          mid:      (c3.low + c1.high) / 2,
          size:     gapSize,
          filled:   currentPrice < c1.high || currentPrice > c3.low,
          timestamp:c2.time
        })
      }
    }

    // Bearish FVG: gap between c1 low and c3 high
    if (c1.low > c3.high && c2.close < c2.open) {
      const gapSize = (c1.low - c3.high) / c2.close * 100
      if (gapSize > 0.05) {
        bearishFVGs.push({
          top:      c1.low,
          bottom:   c3.high,
          mid:      (c1.low + c3.high) / 2,
          size:     gapSize,
          filled:   currentPrice > c1.low || currentPrice < c3.high,
          timestamp:c2.time
        })
      }
    }
  }

  // Get nearest unfilled FVG
  const nearestBullFVG = bullishFVGs
    .filter(fvg => !fvg.filled && fvg.top < currentPrice)
    .sort((a, b) => b.top - a.top)[0] || null

  const nearestBearFVG = bearishFVGs
    .filter(fvg => !fvg.filled && fvg.bottom > currentPrice)
    .sort((a, b) => a.bottom - b.bottom)[0] || null

  return { bullish: nearestBullFVG, bearish: nearestBearFVG }
}

// ─── BREAK OF STRUCTURE ───
function detectBOS(candles: Candle[]): BOS {
  const last30 = candles.slice(-30)
  const current = candles[candles.length - 1]

  // Find swing points
  const swingHighs: number[] = []
  const swingLows: number[] = []

  for (let i = 2; i < last30.length - 2; i++) {
    const c = last30[i]
    const isSwingHigh =
      c.high > last30[i-1].high &&
      c.high > last30[i-2].high &&
      c.high > last30[i+1].high &&
      c.high > last30[i+2].high
    const isSwingLow =
      c.low < last30[i-1].low &&
      c.low < last30[i-2].low &&
      c.low < last30[i+1].low &&
      c.low < last30[i+2].low

    if (isSwingHigh) swingHighs.push(c.high)
    if (isSwingLow)  swingLows.push(c.low)
  }

  const lastSwingHigh = swingHighs[swingHighs.length - 1]
  const lastSwingLow  = swingLows[swingLows.length - 1]

  const bullishBOS = lastSwingHigh &&
    current.close > lastSwingHigh

  const bearishBOS = lastSwingLow &&
    current.close < lastSwingLow

  return {
    direction:  bullishBOS ? 'BULLISH' : bearishBOS ? 'BEARISH' : 'NONE',
    level:      bullishBOS ? lastSwingHigh : bearishBOS ? lastSwingLow : 0,
    confirmed:  bullishBOS || bearishBOS,
    strength:   Math.abs(
      current.close - (bullishBOS ? lastSwingHigh : lastSwingLow || 0)
    ) / current.close * 100
  }
}

// ─── LIQUIDITY SWEEP ───
function detectLiquiditySweep(candles: Candle[]): LiquiditySweep {
  const last20 = candles.slice(-20)
  const last   = candles[candles.length - 1]
  const prev   = candles[candles.length - 2]

  const recentHigh = Math.max(...last20.map(c => c.high))
  const recentLow  = Math.min(...last20.map(c => c.low))

  // Sweep of highs (bearish — longs trapped)
  const highSweep =
    last.high > recentHigh &&
    last.close < recentHigh &&
    last.close < last.open   // closed bearish after sweep

  // Sweep of lows (bullish — shorts trapped)
  const lowSweep =
    last.low < recentLow &&
    last.close > recentLow &&
    last.close > last.open   // closed bullish after sweep

  return {
    detected:    highSweep || lowSweep,
    type:        highSweep ? 'HIGH' : lowSweep ? 'LOW' : 'NONE',
    level:       highSweep ? recentHigh : lowSweep ? recentLow : 0,
    liquidityAbove: recentHigh,
    liquidityBelow: recentLow
  }
}

// ─── MAIN SMC ANALYZER ───
export async function analyzeSMC(
  symbol: string,
  timeframe: string = '5m'
): Promise<SMCData> {

  // Fetch candles for entry TF and confirmation TF
  const [candles5m, candles15m, candles1h] = await Promise.all([
    fetchCandles(symbol, '5m',  100),
    fetchCandles(symbol, '15m', 50),
    fetchCandles(symbol, '1h',  30)
  ])

  const currentPrice = candles5m[candles5m.length - 1].close

  // Run all SMC detection
  const { demand: demandOB, supply: supplyOB } = detectOrderBlocks(candles5m)
  const { bullish: bullFVG, bearish: bearFVG }  = detectFVG(candles5m)
  const bos     = detectBOS(candles15m)
  const sweep   = detectLiquiditySweep(candles5m)

  // 1H bias
  const bos1h   = detectBOS(candles1h)
  const htfBias = bos1h.direction !== 'NONE'
    ? bos1h.direction
    : candles1h[candles1h.length-1].close >
      candles1h[candles1h.length-1].open
      ? 'BULLISH' : 'BEARISH'

  // Check if price is AT an OB zone
  const atDemandOB = demandOB &&
    currentPrice >= demandOB.low * 0.999 &&
    currentPrice <= demandOB.high * 1.001

  const atSupplyOB = supplyOB &&
    currentPrice >= supplyOB.low * 0.999 &&
    currentPrice <= supplyOB.high * 1.001

  // Check if price is in FVG
  const atBullFVG = bullFVG &&
    currentPrice >= bullFVG.bottom &&
    currentPrice <= bullFVG.top

  const atBearFVG = bearFVG &&
    currentPrice >= bearFVG.bottom &&
    currentPrice <= bearFVG.top

  // SMC Score calculation
  let smcScore = 0
  let entryDirection: 'LONG' | 'SHORT' | 'NONE' = 'NONE'

  // LONG setup scoring
  let longScore = 0
  if (atDemandOB)                              longScore += 35
  if (atBullFVG)                               longScore += 20
  if (bos.direction === 'BULLISH')             longScore += 25
  if (sweep.type === 'LOW')                    longScore += 20
  if (htfBias === 'BULLISH')                   longScore += 15
  if (demandOB?.strength === 'STRONG')         longScore += 10

  // SHORT setup scoring
  let shortScore = 0
  if (atSupplyOB)                              shortScore += 35
  if (atBearFVG)                               shortScore += 20
  if (bos.direction === 'BEARISH')             shortScore += 25
  if (sweep.type === 'HIGH')                   shortScore += 20
  if (htfBias === 'BEARISH')                   shortScore += 15
  if (supplyOB?.strength === 'STRONG')         shortScore += 10

  if (longScore > shortScore && longScore >= 55) {
    smcScore       = longScore
    entryDirection = 'LONG'
  } else if (shortScore > longScore && shortScore >= 55) {
    smcScore       = shortScore
    entryDirection = 'SHORT'
  }

  return {
    demandOB,
    supplyOB,
    atOBZone:       !!(atDemandOB || atSupplyOB),
    obType:         atDemandOB ? 'DEMAND' : atSupplyOB ? 'SUPPLY' : 'NONE',
    bullishFVG:     bullFVG,
    bearishFVG:     bearFVG,
    atFVGZone:      !!(atBullFVG || atBearFVG),
    bos,
    bosDirection:   bos.direction,
    bosConfirmed:   bos.confirmed,
    liquidityAbove: sweep.liquidityAbove,
    liquidityBelow: sweep.liquidityBelow,
    sweepDetected:  sweep.detected,
    sweepType:      sweep.type,
    smcBias:        entryDirection === 'LONG' ? 'BULLISH' :
                    entryDirection === 'SHORT' ? 'BEARISH' : 'NEUTRAL',
    smcScore,
    entryValid:     smcScore >= 55,
    entryDirection
  }
}

═══════════════════════════════════════
PART 2 — VOLUME ENGINE
/lib/scalping3/volumeEngine.ts
═══════════════════════════════════════

interface VolumeData {
  currentVolume:  number
  avgVolume:      number
  volumeRatio:    number
  volumeScore:    number
  isSurge:        boolean
  surgeLevel:     'NORMAL' | 'ELEVATED' | 'SURGE' | 'EXTREME'
  volumeTrend:    'INCREASING' | 'DECREASING' | 'STABLE'
  deltaVolume:    number      // buy vol - sell vol (approximated)
  deltaPositive:  boolean     // more buyers than sellers
  confirmed:      boolean     // volume confirms SMC direction
}

export function analyzeVolume(
  candles: Candle[],
  smcDirection: 'LONG' | 'SHORT' | 'NONE'
): VolumeData {

  const last    = candles[candles.length - 1]
  const prev3   = candles.slice(-4, -1)
  const last20  = candles.slice(-21, -1)

  // Average volume (20 candles)
  const avgVolume = last20.reduce(
    (s, c) => s + parseFloat(c.volume.toString()), 0
  ) / 20

  const currentVolume = parseFloat(last.volume.toString())
  const volumeRatio   = currentVolume / avgVolume

  // Volume surge level
  const surgeLevel: VolumeData['surgeLevel'] =
    volumeRatio >= 5   ? 'EXTREME'  :
    volumeRatio >= 3   ? 'SURGE'    :
    volumeRatio >= 1.5 ? 'ELEVATED' : 'NORMAL'

  // Volume trend (last 3 candles increasing?)
  const volTrend = prev3.map(c => parseFloat(c.volume.toString()))
  const volumeTrend: VolumeData['volumeTrend'] =
    volTrend[2] > volTrend[1] && volTrend[1] > volTrend[0]
      ? 'INCREASING'
      : volTrend[2] < volTrend[1] && volTrend[1] < volTrend[0]
        ? 'DECREASING'
        : 'STABLE'

  // Delta volume approximation
  // Bull candle = buy volume dominant
  // Bear candle = sell volume dominant
  const isBullCandle = last.close > last.open
  const bodyPercent  = Math.abs(last.close - last.open) / (last.high - last.low)
  const deltaVolume  = isBullCandle
    ? currentVolume * bodyPercent
    : -currentVolume * bodyPercent

  const deltaPositive = deltaVolume > 0

  // Volume confirms SMC direction?
  const confirmed =
    volumeRatio >= 1.5 &&
    (smcDirection === 'LONG'  ? deltaPositive  : true) &&
    (smcDirection === 'SHORT' ? !deltaPositive : true)

  // Volume score
  const volumeScore =
    (volumeRatio >= 5   ? 40 :
     volumeRatio >= 3   ? 30 :
     volumeRatio >= 2   ? 20 :
     volumeRatio >= 1.5 ? 10 : 0) +
    (volumeTrend === 'INCREASING' ? 15 : 0) +
    (confirmed ? 20 : 0) +
    (surgeLevel !== 'NORMAL' ? 10 : 0)

  return {
    currentVolume,
    avgVolume,
    volumeRatio,
    volumeScore,
    isSurge:       volumeRatio >= 1.5,
    surgeLevel,
    volumeTrend,
    deltaVolume,
    deltaPositive,
    confirmed
  }
}

═══════════════════════════════════════
PART 3 — SESSION & TIME FILTER
/lib/scalping3/sessionFilter.ts
═══════════════════════════════════════

interface SessionData {
  currentSession:  string
  sessionScore:    number
  isOptimal:       boolean
  allowTrade:      boolean
  nextOptimalTime: string
  reason:          string
}

const SESSIONS = {
  LONDON_NY_OVERLAP: {
    name:       'London/NY Overlap',
    utcStart:   13,
    utcEnd:     16,
    istStart:   '18:30',
    istEnd:     '21:30',
    score:      30,
    optimal:    true,
    description:'BEST — Maximum liquidity + volatility'
  },
  NEW_YORK: {
    name:       'New York',
    utcStart:   13,
    utcEnd:     21,
    istStart:   '18:30',
    istEnd:     '02:30+1',
    score:      20,
    optimal:    true,
    description:'GOOD — High volume US session'
  },
  LONDON: {
    name:       'London',
    utcStart:   8,
    utcEnd:     13,
    istStart:   '13:30',
    istEnd:     '18:30',
    score:      15,
    optimal:    true,
    description:'GOOD — European session'
  },
  ASIAN: {
    name:       'Asian',
    utcStart:   0,
    utcEnd:     8,
    istStart:   '05:30',
    istEnd:     '13:30',
    score:      0,
    optimal:    false,
    description:'AVOID — Low volume, choppy'
  }
}

export function checkSession(
  settings: Scalping3Settings
): SessionData {

  const now     = new Date()
  const utcHour = now.getUTCHours()
  const utcMin  = now.getUTCMinutes()
  const utcTime = utcHour + utcMin / 60

  // Determine current session
  let currentSession = 'DEAD_HOURS'
  let sessionScore   = 0
  let isOptimal      = false
  let allowTrade     = false

  // London/NY Overlap (BEST)
  if (utcTime >= 13 && utcTime < 16) {
    currentSession = 'LONDON_NY_OVERLAP'
    sessionScore   = 30
    isOptimal      = true
    allowTrade     = settings.allowLondonNY
  }
  // NY Only
  else if (utcTime >= 16 && utcTime < 21) {
    currentSession = 'NEW_YORK'
    sessionScore   = 20
    isOptimal      = true
    allowTrade     = settings.allowNY
  }
  // London Only
  else if (utcTime >= 8 && utcTime < 13) {
    currentSession = 'LONDON'
    sessionScore   = 15
    isOptimal      = true
    allowTrade     = settings.allowLondon
  }
  // Asian
  else if (utcTime >= 0 && utcTime < 8) {
    currentSession = 'ASIAN'
    sessionScore   = 0
    isOptimal      = false
    allowTrade     = settings.allowAsian  // default OFF
  }

  // Calculate next optimal time
  let nextOptimalTime = ''
  if (!isOptimal || !allowTrade) {
    const hoursToLondon = utcHour < 8  ? 8 - utcHour  : 32 - utcHour
    const hoursToNY     = utcHour < 13 ? 13 - utcHour : 37 - utcHour
    const hoursToNext   = Math.min(hoursToLondon, hoursToNY)
    const nextTime      = new Date(now.getTime() + hoursToNext * 3600000)
    const istOffset     = 5.5 * 3600000
    const nextIST       = new Date(nextTime.getTime() + istOffset)
    nextOptimalTime     = `${nextIST.getUTCHours()}:${String(nextIST.getUTCMinutes()).padStart(2,'0')} IST`
  }

  return {
    currentSession,
    sessionScore,
    isOptimal,
    allowTrade,
    nextOptimalTime,
    reason: allowTrade
      ? `${currentSession.replace(/_/g,' ')} — trading allowed`
      : `${currentSession.replace(/_/g,' ')} — waiting for ${nextOptimalTime}`
  }
}

═══════════════════════════════════════
PART 4 — MAIN STRATEGY ENGINE
/lib/scalping3/strategy.ts
═══════════════════════════════════════

export async function runScalping3(
  settings: Scalping3Settings
): Promise<Scalping3Signal | null> {

  // GATE 1: Session check
  const session = checkSession(settings)
  if (!session.allowTrade) {
    console.log(`[S3] Session blocked: ${session.reason}`)
    return null
  }

  // GATE 2: Scan enabled symbols
  const results: Scalping3Signal[] = []

  for (const symbol of settings.enabledSymbols) {

    // Run SMC analysis
    const smc = await analyzeSMC(symbol, settings.timeframe)

    // GATE 3: SMC must be valid
    if (!smc.entryValid) {
      console.log(`[S3] ${symbol} SMC invalid (score ${smc.smcScore})`)
      continue
    }

    // Run Volume analysis
    const candles = await fetchCandles(symbol, settings.timeframe, 50)
    const volume  = analyzeVolume(candles, smc.entryDirection)

    // GATE 4: Volume must confirm
    if (!volume.isSurge) {
      console.log(`[S3] ${symbol} Volume not surging (${volume.volumeRatio}x)`)
      continue
    }

    if (!volume.confirmed) {
      console.log(`[S3] ${symbol} Volume not confirming direction`)
      continue
    }

    // BOTH conditions met — calculate trade
    const currentPrice = candles[candles.length - 1].close
    const atr          = calculateATR(candles, 14)

    // TP/SL based on SMC structure
    let tpPrice: number
    let slPrice: number

    if (smc.entryDirection === 'LONG') {
      // SL: below demand OB or recent swing low
      slPrice = smc.demandOB
        ? smc.demandOB.low * 0.998
        : currentPrice - atr * 1.5

      // TP: at supply OB or recent swing high
      tpPrice = smc.supplyOB
        ? smc.supplyOB.low * 0.999
        : currentPrice + atr * 2.5
    } else {
      // SL: above supply OB
      slPrice = smc.supplyOB
        ? smc.supplyOB.high * 1.002
        : currentPrice + atr * 1.5

      // TP: at demand OB
      tpPrice = smc.demandOB
        ? smc.demandOB.high * 1.001
        : currentPrice - atr * 2.5
    }

    const slDistance = Math.abs(currentPrice - slPrice)
    const tpDistance = Math.abs(tpPrice - currentPrice)
    const rr         = tpDistance / slDistance

    // Minimum RR check
    if (rr < settings.minRR) {
      console.log(`[S3] ${symbol} RR too low: ${rr.toFixed(2)}`)
      continue
    }

    // Combined score
    const totalScore = smc.smcScore + volume.volumeScore + session.sessionScore

    results.push({
      symbol,
      direction:      smc.entryDirection,
      entryPrice:     currentPrice,
      tpPrice,
      slPrice,
      rr:             parseFloat(rr.toFixed(2)),
      smcScore:       smc.smcScore,
      volumeScore:    volume.volumeScore,
      sessionScore:   session.sessionScore,
      totalScore,
      smcData:        smc,
      volumeData:     volume,
      sessionData:    session,
      timestamp:      Date.now()
    })
  }

  if (results.length === 0) return null

  // Return highest scoring signal
  return results.sort((a, b) => b.totalScore - a.totalScore)[0]
}

═══════════════════════════════════════
PART 5 — SETTINGS UI
/app/dashboard/scalping-3/page.tsx
═══════════════════════════════════════

Page title: ⚡ SCALPING 3
Subtitle: SMC + Volume Strategy

SETTINGS PANEL:

┌─────────────────────────────────────┐
│ STRATEGY ENGINE                     │
│ Status: [ON ●] [OFF]               │
│ Mode:   [PAPER] [LIVE] [MIRROR]    │
├─────────────────────────────────────┤
│ TIMEFRAME                           │
│ Entry:   [1M] [3M] [●5M] [15M]    │
│ Confirm: [●15M] [1H]               │
│ Bias:    [●1H] [4H]                │
├─────────────────────────────────────┤
│ SMC SETTINGS                        │
│ Min SMC score:    [55] slider       │
│ Require OB:       [ON ✅]          │
│ Require FVG:      [OFF]            │
│ Require BOS:      [ON ✅]          │
│ Require Sweep:    [OFF]            │
│ HTF bias align:   [ON ✅]          │
├─────────────────────────────────────┤
│ VOLUME SETTINGS                     │
│ Min volume ratio: [1.5]x           │
│ Require surge:    [ON ✅]          │
│ Min volume score: [25]             │
│ Volume trend:     [INCREASING]     │
├─────────────────────────────────────┤
│ SESSION FILTER                      │
│ London/NY Overlap [ON ✅] BEST     │
│ New York          [ON ✅] GOOD     │
│ London            [ON ✅] GOOD     │
│ Asian             [OFF ❌] AVOID   │
│                                     │
│ Current session: NY OVERLAP ✅     │
│ IST time now: 19:45                │
│ Next optimal: NOW ✅               │
├─────────────────────────────────────┤
│ TRADE SETTINGS                      │
│ Margin ($):   [20] input           │
│ Leverage:     [10]x slider         │
│ Min RR:       [1.5] input          │
│ Max trades/day: [5]                │
│ Max concurrent: [2]                │
├─────────────────────────────────────┤
│ TP/SL METHOD                        │
│ ● SMC Structure (auto from OB/FVG) │
│ ○ Fixed % from entry               │
│ ○ ATR based                        │
├─────────────────────────────────────┤
│ TRAILING STOP                       │
│ Enable: [ON ✅]                    │
│ Activate at: [40]% of TP           │
│ Distance: [0.5]% ATR               │
├─────────────────────────────────────┤
│ SYMBOLS (select to enable)          │
│ ✅ BTC  ✅ ETH  ✅ SOL  ✅ BNB    │
│ ✅ ARB  ✅ LINK ✅ INJ  ❌ DOGE   │
│ [Select All] [Top 10] [Custom]     │
└─────────────────────────────────────┘

[SAVE SETTINGS]

═══════════════════════════════════════
PART 6 — LIVE SIGNAL DISPLAY
═══════════════════════════════════════

LIVE SMC ANALYSIS panel:

┌─────────────────────────────────────┐
│ LIVE ANALYSIS — BTC-USDT           │
├──────────────┬──────────────────────┤
│ SMC          │                      │
│ OB Zone:     │ DEMAND ✅ $83,200   │
│ FVG:         │ Bullish $83,100     │
│ BOS:         │ BULLISH ✅           │
│ Sweep:       │ LOW swept ✅         │
│ HTF Bias:    │ BULLISH (1H) ✅      │
│ SMC Score:   │ 80/100               │
├──────────────┼──────────────────────┤
│ VOLUME       │                      │
│ Ratio:       │ 3.2x avg ✅          │
│ Surge:       │ SURGE ✅             │
│ Trend:       │ INCREASING ✅        │
│ Delta:       │ BUYERS ✅            │
│ Vol Score:   │ 45/100               │
├──────────────┼──────────────────────┤
│ SESSION      │                      │
│ Current:     │ NY OVERLAP ✅        │
│ IST Time:    │ 19:45                │
│ Score:       │ +30                  │
├──────────────┼──────────────────────┤
│ TOTAL SCORE  │ 155/230              │
│ SIGNAL:      │ ✅ LONG VALID        │
│ Entry:       │ $83,450              │
│ TP:          │ $85,200 (+2.1%)      │
│ SL:          │ $83,000 (-0.54%)     │
│ RR:          │ 1:3.8 🔥             │
└──────────────┴──────────────────────┘

═══════════════════════════════════════
PART 7 — TELEGRAM MESSAGES
═══════════════════════════════════════

On signal found:
⚡ SCALPING 3 SIGNAL
━━━━━━━━━━━━━━
📊 BTC-USDT LONG
Strategy: SMC + Volume
━━━━━━━━━━━━━━
🏦 SMC Analysis:
OB Zone: DEMAND at $83,200 ✅
BOS: Bullish confirmed ✅
Sweep: Low swept ✅
SMC Score: 80/100

📊 Volume Analysis:
Ratio: 3.2x average ✅
Surge: ACTIVE ✅
Delta: Buyers dominant ✅
Vol Score: 45/100

🕐 Session: NY Overlap ✅
━━━━━━━━━━━━━━
💵 Entry:  $83,450
🎯 TP:     $85,200 (+2.1%)
🛑 SL:     $83,000 (-0.54%)
📊 RR:     1:3.8 🔥
💰 Margin: $20 | 10x
━━━━━━━━━━━━━━
Placing trade in 15 seconds...
[CANCEL: /skip_s3]

On no signal:
⚡ S3 SCAN — NO SETUP
Session: NY Overlap ✅
Scanned: 8 symbols
SMC valid: 2 (BTC, ETH)
Volume confirmed: 0
Reason: Volume not surging
Next scan: 5 min

═══════════════════════════════════════
PART 8 — SCHEDULE
═══════════════════════════════════════

In scheduledJobs.ts:

// Scalping 3 — runs every 5 minutes
setInterval(async () => {
  const settings = getScalping3Settings()
  if (!settings.enabled) return

  const signal = await runScalping3(settings)
  if (signal) {
    await executeScalping3Trade(signal, settings)
  }
}, 5 * 60 * 1000)  // every 5 minutes

═══════════════════════════════════════
PART 9 — ENV VARIABLES
═══════════════════════════════════════

Add to .env.local:
SCALPING3_ENABLED=false
SCALPING3_MODE=paper
SCALPING3_TIMEFRAME=5m
SCALPING3_MIN_SMC_SCORE=55
SCALPING3_MIN_VOLUME_RATIO=1.5
SCALPING3_MARGIN=20
SCALPING3_LEVERAGE=10
SCALPING3_MIN_RR=1.5
SCALPING3_MAX_TRADES=5