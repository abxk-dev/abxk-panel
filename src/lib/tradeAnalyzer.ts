import type { Trade } from "@/types/bot"

export type TradeAnalysisResult = {
  provider: "Gemini" | "Groq"
  text: string
}

export async function analyzeTrade(trade: Trade, extra: Record<string, unknown> = {}): Promise<TradeAnalysisResult> {
  const prompt = buildPrompt(trade, extra)

  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
          })
        }
      )
      const data = (await res.json()) as any
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (typeof text === "string" && text.trim()) return { provider: "Gemini", text }
    } catch {
      void 0
    }
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) throw new Error("Missing GEMINI_API_KEY and GROQ_API_KEY")

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    })
  })
  const data = (await res.json()) as any
  const text = data?.choices?.[0]?.message?.content
  if (typeof text === "string" && text.trim()) return { provider: "Groq", text }
  throw new Error("AI analysis returned empty response")
}

function buildPrompt(trade: Trade, extra: Record<string, unknown>): string {
  const result = trade.pnlUsd === undefined ? "—" : trade.pnlUsd >= 0 ? "WIN" : "LOSS"
  const pnl = trade.pnlUsd === undefined ? "—" : trade.pnlUsd.toFixed(2)
  const pnlPct = trade.pnlPct === undefined ? "—" : trade.pnlPct.toFixed(2)
  const durationMs = trade.closedAt && trade.openedAt ? trade.closedAt - trade.openedAt : undefined
  const duration = durationMs ? `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m` : "—"

  const i = trade.indicators ?? {}

  return `
You are an expert crypto futures trading analyst.
Analyze this completed trade and give a clear, honest reason for the outcome.
Be specific, educational, and actionable. Max 5 bullet points.

TRADE DATA:
- Symbol: ${trade.symbol}
- Direction: ${trade.side} (LONG/SHORT)
- Entry Price: ${trade.entryPrice}
- Exit Price: ${trade.exitPrice ?? "—"}
- Stop Loss: ${trade.stopLossPrice}
- Take Profit: ${trade.takeProfitPrice}
- Result: ${result} (WIN/LOSS)
- PnL: ${pnl} (${pnlPct}%)
- Duration: ${duration}
- Exit Reason: ${trade.exitReason ?? "—"} (TP hit / SL hit / Manual)
- Timeframe: ${trade.timeframe}
- Setup Score: ${trade.setupScore ?? "—"}/100

MARKET CONDITIONS AT ENTRY:
- Trend (EMA): ${formatEma(i.ema20, i.ema50, i.ema200)}
- RSI at entry: ${formatNum(i.rsi14)}
- Volume vs avg: ${formatNum(i.volumeRatio)}x
- ATR: ${formatNum(i.atr14)}
- MACD: ${formatNum(i.macdLine)} / ${formatNum(i.macdSignal)} (hist ${formatNum(i.macdHist)})
- Funding Rate: ${formatNum(i.fundingRatePct)}%
- Open Interest change: ${formatNum(i.openInterestChangePct)}%
- Fear & Greed Index: ${formatNum(i.fearGreed)}
- Fibonacci level: ${formatNum(i.fibLevel)}
- Session: ${i.inNewsBlackout ? "NEWS BLACKOUT" : "OK"}
- Daily bias: ${i.dailyBias ?? "—"}

EXTRA CONTEXT:
${JSON.stringify(extra)}

${
  result === "WIN"
    ? "Explain WHY this trade won. What conditions aligned perfectly? What should the bot replicate?"
    : "Explain WHY this trade lost. What went wrong? What conditions were misread? How to avoid this next time?"
}

Format response as:
VERDICT: [1 line summary]
REASONS:
- [reason 1]
- [reason 2]
- [reason 3]
WHAT WORKED: [if win] / WHAT FAILED: [if loss]
IMPROVEMENT: [1 specific thing to do better next trade]
CONFIDENCE SCORE: [was this a good setup? X/10]
`.trim()
}

function formatNum(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2)
  return "—"
}

function formatEma(e20?: number, e50?: number, e200?: number): string {
  if ([e20, e50, e200].every((x) => typeof x === "number" && Number.isFinite(x))) {
    return `${(e20 as number).toFixed(2)} / ${(e50 as number).toFixed(2)} / ${(e200 as number).toFixed(2)}`
  }
  return "—"
}

