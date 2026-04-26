import type { Candle, TradeSide } from "@/types/bot"

export type CandlePattern = {
  name: string
  type: "BULLISH" | "BEARISH"
  strength: "STRONG" | "MODERATE" | "WEAK"
  reliability: number
  description: string
  candlesNeeded: number
}

export type PatternResult = {
  found: boolean
  pattern: CandlePattern | null
  allPatterns: CandlePattern[]
  direction: "BULLISH" | "BEARISH" | "NONE"
  strongestPattern: string
  score: number
  reliability?: number
  allPatternNames?: string
}

export function detectAllPatterns(candles: Candle[], direction: TradeSide): PatternResult {
  if (!candles || candles.length < 6) {
    return { found: false, pattern: null, allPatterns: [], direction: "NONE", strongestPattern: "Insufficient candle data", score: 0 }
  }

  const c0 = candles[candles.length - 1]!
  const c1 = candles[candles.length - 2]!
  const c2 = candles[candles.length - 3]!

  const atr = calculateATR(candles, 14)

  const body = (c: Candle) => Math.abs(c.close - c.open)
  const range = (c: Candle) => Math.max(1e-12, c.high - c.low)
  const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close)
  const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low
  const isBull = (c: Candle) => c.close > c.open
  const isBear = (c: Candle) => c.close < c.open
  const bodyRatio = (c: Candle) => body(c) / range(c)

  const bullishPatterns: CandlePattern[] = []
  const bearishPatterns: CandlePattern[] = []

  const isHammer =
    lowerWick(c0) >= body(c0) * 2 &&
    upperWick(c0) <= body(c0) * 0.3 &&
    body(c0) > 0 &&
    (atr <= 0 || range(c0) > atr * 0.5)
  if (isHammer) {
    bullishPatterns.push({
      name: "Hammer",
      type: "BULLISH",
      strength: lowerWick(c0) >= body(c0) * 3 ? "STRONG" : "MODERATE",
      reliability: 72,
      description: "Long lower wick — buyers rejected selloff",
      candlesNeeded: 1
    })
  }

  const isShootingStar =
    upperWick(c0) >= body(c0) * 2 &&
    lowerWick(c0) <= body(c0) * 0.3 &&
    body(c0) > 0 &&
    (atr <= 0 || range(c0) > atr * 0.5)
  if (isShootingStar) {
    bearishPatterns.push({
      name: "Shooting Star",
      type: "BEARISH",
      strength: upperWick(c0) >= body(c0) * 3 ? "STRONG" : "MODERATE",
      reliability: 70,
      description: "Long upper wick — sellers rejected rally",
      candlesNeeded: 1
    })
  }

  const isBullMarubozu = isBull(c0) && bodyRatio(c0) > 0.85 && (atr <= 0 || body(c0) > atr * 0.8)
  if (isBullMarubozu) {
    bullishPatterns.push({
      name: "Bullish Marubozu",
      type: "BULLISH",
      strength: "STRONG",
      reliability: 78,
      description: "Full bull candle — strong momentum",
      candlesNeeded: 1
    })
  }

  const isBearMarubozu = isBear(c0) && bodyRatio(c0) > 0.85 && (atr <= 0 || body(c0) > atr * 0.8)
  if (isBearMarubozu) {
    bearishPatterns.push({
      name: "Bearish Marubozu",
      type: "BEARISH",
      strength: "STRONG",
      reliability: 78,
      description: "Full bear candle — strong selling",
      candlesNeeded: 1
    })
  }

  const isDoji = bodyRatio(c0) < 0.1

  const isBullPinBar = lowerWick(c0) > range(c0) * 0.6 && c0.close > c0.low + range(c0) * 0.7 && (atr <= 0 || range(c0) > atr * 0.6)
  if (isBullPinBar) {
    bullishPatterns.push({
      name: "Bullish Pin Bar",
      type: "BULLISH",
      strength: "STRONG",
      reliability: 75,
      description: "Price rejected lows — strong reversal",
      candlesNeeded: 1
    })
  }

  const isBearPinBar = upperWick(c0) > range(c0) * 0.6 && c0.close < c0.high - range(c0) * 0.7 && (atr <= 0 || range(c0) > atr * 0.6)
  if (isBearPinBar) {
    bearishPatterns.push({
      name: "Bearish Pin Bar",
      type: "BEARISH",
      strength: "STRONG",
      reliability: 75,
      description: "Price rejected highs — strong reversal",
      candlesNeeded: 1
    })
  }

  const isBullEngulfing =
    isBear(c1) &&
    isBull(c0) &&
    c0.open < c1.close &&
    c0.close > c1.open &&
    body(c0) > body(c1) * 1.1 &&
    (atr <= 0 || body(c0) > atr * 0.5)
  if (isBullEngulfing) {
    bullishPatterns.push({
      name: "Bullish Engulfing",
      type: "BULLISH",
      strength: body(c0) > body(c1) * 1.5 ? "STRONG" : "MODERATE",
      reliability: 80,
      description: "Bulls completely absorbed bears",
      candlesNeeded: 2
    })
  }

  const isBearEngulfing =
    isBull(c1) &&
    isBear(c0) &&
    c0.open > c1.close &&
    c0.close < c1.open &&
    body(c0) > body(c1) * 1.1 &&
    (atr <= 0 || body(c0) > atr * 0.5)
  if (isBearEngulfing) {
    bearishPatterns.push({
      name: "Bearish Engulfing",
      type: "BEARISH",
      strength: body(c0) > body(c1) * 1.5 ? "STRONG" : "MODERATE",
      reliability: 80,
      description: "Bears completely absorbed bulls",
      candlesNeeded: 2
    })
  }

  const isTweezerBottom =
    Math.abs(c0.low - c1.low) < (atr > 0 ? atr * 0.05 : range(c0) * 0.02) &&
    isBear(c1) &&
    isBull(c0) &&
    (atr <= 0 || range(c0) > atr * 0.4)
  if (isTweezerBottom) {
    bullishPatterns.push({
      name: "Tweezer Bottom",
      type: "BULLISH",
      strength: "MODERATE",
      reliability: 68,
      description: "Double support confirmed",
      candlesNeeded: 2
    })
  }

  const isTweezerTop =
    Math.abs(c0.high - c1.high) < (atr > 0 ? atr * 0.05 : range(c0) * 0.02) &&
    isBull(c1) &&
    isBear(c0) &&
    (atr <= 0 || range(c0) > atr * 0.4)
  if (isTweezerTop) {
    bearishPatterns.push({
      name: "Tweezer Top",
      type: "BEARISH",
      strength: "MODERATE",
      reliability: 68,
      description: "Double resistance confirmed",
      candlesNeeded: 2
    })
  }

  const isPiercingLine = isBear(c1) && isBull(c0) && c0.open < c1.close && c0.close > c1.open - body(c1) * 0.5 && c0.close < c1.open
  if (isPiercingLine) {
    bullishPatterns.push({
      name: "Piercing Line",
      type: "BULLISH",
      strength: "MODERATE",
      reliability: 65,
      description: "Bulls pierced into bear territory",
      candlesNeeded: 2
    })
  }

  const isDarkCloud = isBull(c1) && isBear(c0) && c0.open > c1.close && c0.close < c1.open + body(c1) * 0.5 && c0.close > c1.open
  if (isDarkCloud) {
    bearishPatterns.push({
      name: "Dark Cloud Cover",
      type: "BEARISH",
      strength: "MODERATE",
      reliability: 65,
      description: "Bears entered bull territory",
      candlesNeeded: 2
    })
  }

  const isMorningStar =
    isBear(c2) &&
    body(c1) < body(c2) * 0.3 &&
    isBull(c0) &&
    c0.close > c2.open - body(c2) * 0.5 &&
    (atr <= 0 || body(c2) > atr * 0.5)
  if (isMorningStar) {
    bullishPatterns.push({
      name: "Morning Star",
      type: "BULLISH",
      strength: "STRONG",
      reliability: 82,
      description: "Classic 3-candle bullish reversal",
      candlesNeeded: 3
    })
  }

  const isEveningStar =
    isBull(c2) &&
    body(c1) < body(c2) * 0.3 &&
    isBear(c0) &&
    c0.close < c2.open + body(c2) * 0.5 &&
    (atr <= 0 || body(c2) > atr * 0.5)
  if (isEveningStar) {
    bearishPatterns.push({
      name: "Evening Star",
      type: "BEARISH",
      strength: "STRONG",
      reliability: 82,
      description: "Classic 3-candle bearish reversal",
      candlesNeeded: 3
    })
  }

  const isThreeWhiteSoldiers =
    isBull(c2) &&
    isBull(c1) &&
    isBull(c0) &&
    c1.close > c2.close &&
    c0.close > c1.close &&
    c1.open > c2.open &&
    c1.open < c2.close &&
    c0.open > c1.open &&
    c0.open < c1.close &&
    (atr <= 0 || (body(c0) > atr * 0.4 && body(c1) > atr * 0.4 && body(c2) > atr * 0.4))
  if (isThreeWhiteSoldiers) {
    bullishPatterns.push({
      name: "Three White Soldiers",
      type: "BULLISH",
      strength: "STRONG",
      reliability: 85,
      description: "Three consecutive bull candles — strong trend",
      candlesNeeded: 3
    })
  }

  const isThreeBlackCrows =
    isBear(c2) &&
    isBear(c1) &&
    isBear(c0) &&
    c1.close < c2.close &&
    c0.close < c1.close &&
    c1.open < c2.open &&
    c1.open > c2.close &&
    c0.open < c1.open &&
    c0.open > c1.close &&
    (atr <= 0 || (body(c0) > atr * 0.4 && body(c1) > atr * 0.4 && body(c2) > atr * 0.4))
  if (isThreeBlackCrows) {
    bearishPatterns.push({
      name: "Three Black Crows",
      type: "BEARISH",
      strength: "STRONG",
      reliability: 85,
      description: "Three consecutive bear candles — strong selloff",
      candlesNeeded: 3
    })
  }

  const isBullHarami = isBear(c1) && isBull(c0) && c0.open > c1.close && c0.close < c1.open && body(c0) < body(c1) * 0.5
  if (isBullHarami) {
    bullishPatterns.push({
      name: "Bullish Harami",
      type: "BULLISH",
      strength: "WEAK",
      reliability: 60,
      description: "Indecision inside bear candle",
      candlesNeeded: 2
    })
  }

  const isBearHarami = isBull(c1) && isBear(c0) && c0.open < c1.close && c0.close > c1.open && body(c0) < body(c1) * 0.5
  if (isBearHarami) {
    bearishPatterns.push({
      name: "Bearish Harami",
      type: "BEARISH",
      strength: "WEAK",
      reliability: 60,
      description: "Indecision inside bull candle",
      candlesNeeded: 2
    })
  }

  const isBullKicker = isBear(c1) && isBull(c0) && c0.open > c1.open && (atr <= 0 || body(c0) > atr * 0.6)
  if (isBullKicker) {
    bullishPatterns.push({
      name: "Bullish Kicker",
      type: "BULLISH",
      strength: "STRONG",
      reliability: 88,
      description: "Gap up reversal — very powerful",
      candlesNeeded: 2
    })
  }

  const isBearKicker = isBull(c1) && isBear(c0) && c0.open < c1.open && (atr <= 0 || body(c0) > atr * 0.6)
  if (isBearKicker) {
    bearishPatterns.push({
      name: "Bearish Kicker",
      type: "BEARISH",
      strength: "STRONG",
      reliability: 88,
      description: "Gap down reversal — very powerful",
      candlesNeeded: 2
    })
  }

  if (isDoji && bullishPatterns.length === 0 && bearishPatterns.length === 0) {
    return { found: false, pattern: null, allPatterns: [], direction: "NONE", strongestPattern: "Doji — skip", score: 0 }
  }

  const matchingPatterns = direction === "LONG" ? bullishPatterns : bearishPatterns
  const opposingPatterns = direction === "LONG" ? bearishPatterns : bullishPatterns
  const hasStrongOpposing = opposingPatterns.some((p) => p.strength === "STRONG")

  if (hasStrongOpposing && matchingPatterns.length === 0) {
    const first = opposingPatterns.find((p) => p.strength === "STRONG") ?? opposingPatterns[0]
    const all = [...bullishPatterns, ...bearishPatterns]
    return {
      found: false,
      pattern: null,
      allPatterns: all,
      direction: "NONE",
      strongestPattern: `BLOCKED: ${first?.name ?? "Opposing pattern"} opposes trade`,
      score: -20
    }
  }

  if (matchingPatterns.length === 0) {
    return { found: false, pattern: null, allPatterns: [], direction: "NONE", strongestPattern: "No pattern found", score: 0 }
  }

  matchingPatterns.sort((a, b) => b.reliability - a.reliability)
  const best = matchingPatterns[0]!

  const patternScore = best.strength === "STRONG" ? 30 : best.strength === "MODERATE" ? 20 : best.strength === "WEAK" ? 10 : 0
  const multiPatternBonus = matchingPatterns.length > 1 ? 10 : 0
  const score = Math.min(patternScore + multiPatternBonus, 30)

  return {
    found: true,
    pattern: best,
    allPatterns: [...bullishPatterns, ...bearishPatterns],
    direction: direction === "LONG" ? "BULLISH" : "BEARISH",
    strongestPattern: best.name,
    score,
    reliability: best.reliability,
    allPatternNames: matchingPatterns.map((p) => p.name).join(" + ")
  }
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < period + 2) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]!.close
    const high = candles[i]!.high
    const low = candles[i]!.low
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trs.push(tr)
  }
  const slice = trs.slice(-period)
  if (!slice.length) return 0
  return slice.reduce((a, b) => a + b, 0) / slice.length
}
