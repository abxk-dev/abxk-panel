import { NextResponse } from "next/server"
import {
  analyzeChartWithAI,
  calculatePatternScore,
  captureChart,
  formatPatternTelegram,
  hardBlockFromPattern,
  type PatternAnalysis
} from "@/lib/patternRecognition"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = (await req.json()) as { symbol: string; timeframe: string; direction: "LONG" | "SHORT" | "SCANNING" }
  try {
    const img = await captureChart(body.symbol, body.timeframe)
    const analysis = await analyzeChartWithAI(img, body.symbol, body.direction)
    const scoreDelta = body.direction === "SCANNING" ? 0 : calculatePatternScore(analysis, body.direction)
    const hb = body.direction === "SCANNING" ? { blocked: false } : hardBlockFromPattern(analysis, body.direction)
    const message = formatPatternTelegram({ symbol: body.symbol, timeframe: body.timeframe, analysis, direction: body.direction })
    return NextResponse.json({
      ok: true,
      data: { imageBase64: img, analysis: analysis as PatternAnalysis, scoreDelta, hardBlock: hb, message }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Pattern recognition failed"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
