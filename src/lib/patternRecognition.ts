import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"
import fs from "fs"

export type PatternAnalysis = {
  patterns_found: string[]
  candlestick_pattern: string | null
  chart_pattern: string | null
  pattern_type: "BULLISH" | "BEARISH" | "NEUTRAL" | "NONE"
  pattern_strength: "STRONG" | "MODERATE" | "WEAK"
  ema_alignment: "BULLISH" | "BEARISH" | "MIXED"
  macd_signal: "BULLISH" | "BEARISH" | "NEUTRAL"
  rsi_condition: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL"
  bb_condition: "SQUEEZE" | "EXPANSION" | "NORMAL"
  volume_trend: "INCREASING" | "DECREASING" | "NEUTRAL"
  key_support: number
  key_resistance: number
  overall_trend: "BULLISH" | "BEARISH" | "SIDEWAYS"
  suggested_action: "BUY" | "SELL" | "WAIT"
  confirms_trade: true | false | null
  confidence: number
  primary_reason: string
  warning_flags: string[]
}

export async function captureChart(symbol: string, timeframe: string): Promise<string> {
  const tvSymbol = toTradingViewSymbol(symbol)
  const tvInterval = toTradingViewInterval(timeframe)
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    tvSymbol
  )}&interval=${encodeURIComponent(
    tvInterval
  )}&theme=dark&style=1&hide_side_toolbar=1&studies=EMA%40tv-basicstudies,MACD%40tv-basicstudies,RSI%40tv-basicstudies,BB%40tv-basicstudies`

  const execPath = await resolveExecutablePath()
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 600 })
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 })
    await new Promise<void>((r) => setTimeout(r, 3000))
    const screenshot = await page.screenshot({
      encoding: "base64",
      type: "png",
      clip: { x: 0, y: 0, width: 1200, height: 600 }
    })
    return screenshot as string
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export async function analyzeChartWithAI(
  base64Image: string,
  symbol: string,
  currentDirection: "LONG" | "SHORT" | "SCANNING"
): Promise<PatternAnalysis> {
  const prompt = buildPrompt(symbol, currentDirection)
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("Missing GEMINI_API_KEY")

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
      key
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "image/png",
                  data: base64Image
                }
              },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000
        }
      })
    }
  )

  const data = (await response.json()) as any
  const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
  const clean = extractJson(text)
  return JSON.parse(clean) as PatternAnalysis
}

export function calculatePatternScore(analysis: PatternAnalysis, tradeDirection: "LONG" | "SHORT"): number {
  let score = 0

  if (analysis.pattern_type === "BULLISH" && tradeDirection === "LONG") score += 20
  if (analysis.pattern_type === "BEARISH" && tradeDirection === "SHORT") score += 20
  if (analysis.pattern_type === "BULLISH" && tradeDirection === "SHORT") score -= 30
  if (analysis.pattern_type === "BEARISH" && tradeDirection === "LONG") score -= 30

  if (analysis.pattern_strength === "STRONG") score += 10
  if (analysis.pattern_strength === "MODERATE") score += 5
  if (analysis.pattern_strength === "WEAK") score += 2

  if (analysis.confidence >= 8) score += 10
  else if (analysis.confidence >= 6) score += 5

  score -= (analysis.warning_flags?.length ?? 0) * 5

  if (analysis.rsi_condition === "OVERBOUGHT" && tradeDirection === "LONG") score -= 20
  if (analysis.rsi_condition === "OVERSOLD" && tradeDirection === "SHORT") score -= 20

  return score
}

export function hardBlockFromPattern(
  analysis: PatternAnalysis,
  tradeDirection: "LONG" | "SHORT"
): { blocked: boolean; reason?: string } {
  const chart = String(analysis.chart_pattern ?? "").toLowerCase()
  const candle = String(analysis.candlestick_pattern ?? "").toLowerCase()

  const bullFlag = chart.includes("bull flag")
  const headShoulders = chart.includes("head") && chart.includes("shoulder") && !chart.includes("inverse")

  if (bullFlag && tradeDirection === "SHORT") return { blocked: true, reason: "Bull Flag pattern + SHORT trade = BLOCK" }
  if (headShoulders && tradeDirection === "LONG") return { blocked: true, reason: "Head & Shoulders + LONG trade = BLOCK" }

  if (analysis.bb_condition === "SQUEEZE") return { blocked: true, reason: "BB Squeeze detected = WAIT for breakout confirmation" }

  void candle
  return { blocked: false }
}

export function formatPatternTelegram(opts: {
  symbol: string
  timeframe: string
  analysis: PatternAnalysis
  direction: "LONG" | "SHORT" | "SCANNING"
}): string {
  const a = opts.analysis
  const symbolLabel = `${opts.symbol.replace("-", "/")} ${opts.timeframe.toUpperCase()}`
  const pat = a.chart_pattern ?? "—"
  const candle = a.candlestick_pattern ?? "—"
  const confLine =
    opts.direction === "SCANNING"
      ? "🟡 NO BIAS — analysis only"
      : a.confirms_trade === true
        ? `✅ CONFIRMS ${opts.direction} trade`
        : a.confirms_trade === false
          ? `❌ OPPOSES ${opts.direction} trade`
          : "🟡 Neutral vs direction"

  const warn = a.warning_flags?.length ? `⚠️ Warning: ${a.warning_flags[0]}` : ""
  return `📊 <b>AI PATTERN ANALYSIS</b>
━━━━━━━━━━━━━━
Symbol: ${escapeHtml(symbolLabel)}
Pattern: ${escapeHtml(pat)} (${escapeHtml(a.pattern_strength)})
Candle: ${escapeHtml(candle)}
EMA: ${escapeHtml(a.ema_alignment)} 
RSI: ${escapeHtml(String(a.rsi_condition))} 
MACD: ${escapeHtml(String(a.macd_signal))} 
BB: ${escapeHtml(String(a.bb_condition))}
Confidence: ${Number(a.confidence).toFixed(1)}/10

${confLine}
${warn}`.trim()
}

function buildPrompt(symbol: string, currentDirection: "LONG" | "SHORT" | "SCANNING"): string {
  return `
You are an expert technical analyst specializing in crypto futures trading.
Analyze this ${symbol} chart carefully.

Identify ALL of the following if present:

CANDLESTICK PATTERNS:
- Doji (indecision)
- Hammer / Inverted Hammer (bullish/bearish)
- Engulfing candle (bullish/bearish)
- Morning Star / Evening Star
- Pin Bar / Shooting Star
- Marubozu (strong momentum)
- Harami pattern

CHART PATTERNS:
- Head and Shoulders (bearish reversal)
- Inverse Head and Shoulders (bullish reversal)
- Double Top (bearish) / Double Bottom (bullish)
- Triple Top / Triple Bottom
- Bull Flag / Bear Flag (continuation)
- Ascending Triangle (bullish) / Descending Triangle (bearish)
- Symmetrical Triangle (neutral — breakout pending)
- Cup and Handle (bullish)
- Rising Wedge (bearish) / Falling Wedge (bullish)
- Channel (up/down/sideways)

INDICATOR READINGS (visible on chart):
- EMA alignment (bullish/bearish/mixed)
- MACD position (above/below zero, crossover)
- RSI level (overbought >70 / oversold <30 / neutral)
- Bollinger Band squeeze or expansion
- Volume trend (increasing/decreasing)

KEY LEVELS:
- Identify the most important support level
- Identify the most important resistance level
- Any visible supply/demand zones

OVERALL ASSESSMENT:
- Trend direction: BULLISH / BEARISH / SIDEWAYS
- Pattern strength: STRONG / MODERATE / WEAK
- Suggested action: BUY / SELL / WAIT
- Confidence: X/10
- Primary reason in one sentence

${
    currentDirection !== "SCANNING"
      ? `The bot wants to go ${currentDirection}. Does the chart support or oppose this? State clearly: CONFIRMS or OPPOSES`
      : "No directional bias — pure analysis only"
  }

Respond ONLY in this exact JSON format:
{
  "patterns_found": ["pattern1", "pattern2"],
  "candlestick_pattern": "name or null",
  "chart_pattern": "name or null",
  "pattern_type": "BULLISH" | "BEARISH" | "NEUTRAL" | "NONE",
  "pattern_strength": "STRONG" | "MODERATE" | "WEAK",
  "ema_alignment": "BULLISH" | "BEARISH" | "MIXED",
  "macd_signal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "rsi_condition": "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL",
  "bb_condition": "SQUEEZE" | "EXPANSION" | "NORMAL",
  "volume_trend": "INCREASING" | "DECREASING" | "NEUTRAL",
  "key_support": number,
  "key_resistance": number,
  "overall_trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
  "suggested_action": "BUY" | "SELL" | "WAIT",
  "confirms_trade": true | false | null,
  "confidence": number,
  "primary_reason": "string",
  "warning_flags": ["flag1", "flag2"]
}
`.trim()
}

function extractJson(text: string): string {
  const cleaned = text.replace(/```json|```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) throw new Error("Gemini response did not contain JSON")
  return cleaned.slice(start, end + 1)
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function toTradingViewSymbol(symbol: string): string {
  const s = symbol.replaceAll("-", "").toUpperCase()
  return `BINANCE:${s}`
}

function toTradingViewInterval(timeframe: string): string {
  const tf = timeframe.toLowerCase()
  if (tf === "4h" || tf === "240") return "240"
  if (tf === "1h" || tf === "60") return "60"
  if (tf === "1d" || tf === "d" || tf === "daily") return "D"
  const n = Number(tf)
  if (Number.isFinite(n) && n > 0) return String(n)
  return "240"
}

async function resolveExecutablePath(): Promise<string> {
  const fromSparticuz = await chromium.executablePath().catch(() => null)
  if (fromSparticuz && fromSparticuz !== "null") return fromSparticuz

  const custom = process.env.PUPPETEER_EXECUTABLE_PATH
  if (custom && fs.existsSync(custom)) return custom

  const candidates = [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe"
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (found) return found

  throw new Error("No Chrome/Edge executable found for puppeteer-core")
}
