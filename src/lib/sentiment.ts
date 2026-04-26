import googleTrends from "google-trends-api"

export type SentimentScore = {
  source: string
  score: number
  signal: string
  details?: Record<string, unknown>
}

export type CombinedSentiment = {
  totalScore: number
  avgScore: number
  overallSentiment: "EXTREMELY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "EXTREMELY_BEARISH"
  tradingSignal: "CONFIRM_LONGS" | "CONFIRM_SHORTS" | "NEUTRAL_OK_EITHER" | "SLIGHT_LEAN"
  setupScoreAddition: number
  sources: {
    reddit?: SentimentScore
    trends?: SentimentScore
    news?: SentimentScore
    twitter?: SentimentScore
  }
  keyTheme?: string
  riskEvents?: string[]
}

export async function getRedditSentiment(): Promise<SentimentScore> {
  const subreddits = ["CryptoCurrency", "Bitcoin", "ethereum", "CryptoMarkets"]
  const posts: string[] = []

  for (const sub of subreddits) {
    const res = await fetch(`https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=25`, {
      headers: { "User-Agent": "CryptoBot/1.0" },
      cache: "no-store"
    })
    if (!res.ok) continue
    const data = (await res.json()) as any
    const titles: string[] = Array.isArray(data?.data?.children)
      ? data.data.children.map((p: any) => String(p?.data?.title ?? "").toLowerCase())
      : []
    posts.push(...titles)
  }

  if (!posts.length) return { source: "Reddit", score: 0, signal: "NO_DATA" }

  const bullishWords = [
    "moon",
    "pump",
    "bull",
    "buy",
    "bullish",
    "surge",
    "ath",
    "breakout",
    "rally",
    "accumulate",
    "hodl",
    "long",
    "up only",
    "green",
    "gains",
    "profit",
    "all time high",
    "recovery"
  ]

  const bearishWords = [
    "crash",
    "dump",
    "bear",
    "sell",
    "bearish",
    "drop",
    "fall",
    "correction",
    "panic",
    "fear",
    "scam",
    "dead",
    "over",
    "done",
    "liquidated",
    "rekt",
    "lost everything",
    "rug",
    "bubble burst"
  ]

  const extremeFearWords = ["i'm done", "giving up", "lost everything", "never again", "worst investment", "going to zero", "crypto is dead"]

  const allText = posts.join(" ")
  const bullishCount = bullishWords.filter((w) => allText.includes(w)).length
  const bearishCount = bearishWords.filter((w) => allText.includes(w)).length
  const extremeFear = extremeFearWords.some((w) => allText.includes(w))

  const denom = bullishCount + bearishCount
  const sentimentRatio = denom > 0 ? bullishCount / denom : 0.5

  const score = extremeFear
    ? 25
    : sentimentRatio > 0.8
      ? -15
      : sentimentRatio > 0.65
        ? -8
        : sentimentRatio < 0.3
          ? 15
          : sentimentRatio < 0.4
            ? 8
            : 0

  const signal = extremeFear
    ? "CONTRARIAN_BUY"
    : sentimentRatio > 0.8
      ? "EUPHORIA_WARNING"
      : sentimentRatio < 0.3
        ? "FEAR_BUY_SIGNAL"
        : "NEUTRAL"

  return {
    source: "Reddit",
    score,
    signal,
    details: { bullishCount, bearishCount, sentimentRatio, extremeFear }
  }
}

export async function getGoogleTrendsSentiment(): Promise<SentimentScore> {
  const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const ioRaw = await googleTrends.interestOverTime({
    keyword: "Bitcoin",
    startTime,
    granularTimeResolution: false
  })
  const io = JSON.parse(ioRaw) as any
  const values: number[] = Array.isArray(io?.default?.timelineData)
    ? io.default.timelineData.map((t: any) => Number(t?.value?.[0] ?? 0)).filter((n: number) => Number.isFinite(n))
    : []

  const latestValue = values.length ? values[values.length - 1] : 0
  const avgValue = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const trendChange = avgValue > 0 ? ((latestValue - avgValue) / avgValue) * 100 : 0

  let cryptoTrending = false
  try {
    const dailyRaw = await googleTrends.dailyTrends({ geo: "US" })
    const daily = JSON.parse(dailyRaw) as any
    const list: string[] = Array.isArray(daily?.default?.trendingSearchesDays?.[0]?.trendingSearches)
      ? daily.default.trendingSearchesDays[0].trendingSearches.map((t: any) => String(t?.title?.query ?? "").toLowerCase())
      : []
    cryptoTrending = list.some((t) => ["bitcoin", "crypto", "ethereum", "btc"].some((k) => t.includes(k)))
  } catch {
    cryptoTrending = false
  }

  const score =
    trendChange > 50 ? -15 : trendChange > 25 ? -8 : trendChange < -50 ? 15 : trendChange < -30 ? 10 : 0

  const signal =
    trendChange > 50 ? "RETAIL_FOMO_WARNING" : trendChange < -30 ? "LOW_INTEREST_ACCUMULATE" : "NORMAL"

  return {
    source: "Google Trends",
    score,
    signal,
    details: { latestValue, avgValue, trendChange, cryptoTrending }
  }
}

export async function getNewsSentiment(): Promise<SentimentScore> {
  const key = process.env.CRYPTOPANIC_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const { headlines, bullishNews, bearishNews, sourceLabel } = await fetchNewsHeadlines({ cryptopanicKey: key })
  if (!headlines.length) return { source: "News + Gemini", score: 0, signal: "NO_DATA" }
  if (!geminiKey) {
    const score = bullishNews > bearishNews ? 5 : bearishNews > bullishNews ? -5 : 0
    return {
      source: sourceLabel,
      score,
      signal: score > 0 ? "BULLISH" : score < 0 ? "BEARISH" : "NEUTRAL",
      details: { bullishNews, bearishNews, keyTheme: "", riskEvents: [] }
    }
  }

  const prompt = `Analyze these crypto news headlines and respond ONLY with JSON:
{"sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": -20 to 20, "key_theme": "string", "risk_events": ["event1"]}

Headlines:
${headlines.join("\n")}`

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      })
    }
  )
  const geminiData = (await geminiRes.json()) as any
  const text = String(geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
  const clean = text.replace(/```json|```/g, "").trim()
  const analysis = JSON.parse(clean) as any
  const score = clampNum(Number(analysis?.score ?? 0), -20, 20)
  const sentiment = String(analysis?.sentiment ?? "NEUTRAL")
  const keyTheme = String(analysis?.key_theme ?? "")
  const riskEvents = Array.isArray(analysis?.risk_events) ? analysis.risk_events.map((x: any) => String(x)) : []

  return {
    source: sourceLabel,
    score,
    signal: sentiment,
    details: { bullishNews, bearishNews, aiSentiment: sentiment, keyTheme, riskEvents }
  }
}

async function fetchNewsHeadlines(opts: { cryptopanicKey?: string }): Promise<{
  headlines: string[]
  bullishNews: number
  bearishNews: number
  sourceLabel: string
}> {
  const key = String(opts.cryptopanicKey ?? "").trim()
  if (key) {
    try {
      const url = new URL("https://cryptopanic.com/api/v1/posts/")
      url.searchParams.set("auth_token", key)
      url.searchParams.set("currencies", "BTC")
      url.searchParams.set("filter", "hot")
      const res = await fetch(url.toString(), { cache: "no-store" })
      if (res.ok) {
        const data = (await res.json()) as any
        const items: any[] = Array.isArray(data?.results) ? data.results : []
        let bullishNews = 0
        let bearishNews = 0
        for (const a of items) {
          const pos = Number(a?.votes?.positive ?? 0)
          const neg = Number(a?.votes?.negative ?? 0)
          if (pos > neg) bullishNews += 1
          else if (neg > pos) bearishNews += 1
        }
        const headlines = items.slice(0, 10).map((a: any) => String(a?.title ?? "")).filter(Boolean)
        if (headlines.length) return { headlines, bullishNews, bearishNews, sourceLabel: "CryptoPanic + Gemini" }
      }
    } catch {
      return { headlines: [], bullishNews: 0, bearishNews: 0, sourceLabel: "News + Gemini" }
    }
  }

  const rss = await fetch("https://news.google.com/rss/search?q=bitcoin+OR+crypto+when:7d&hl=en-US&gl=US&ceid=US:en", {
    cache: "no-store"
  }).then((r) => (r.ok ? r.text() : ""))

  const titles = extractRssTitles(rss)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").trim())
    .filter(Boolean)
    .slice(0, 10)

  return { headlines: titles, bullishNews: 0, bearishNews: 0, sourceLabel: "Google News RSS + Gemini" }
}

function extractRssTitles(xml: string): string[] {
  const out: string[] = []
  const re = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const title = String(m[1] ?? m[2] ?? "").trim()
    if (!title) continue
    if (title.toLowerCase().includes("google news")) continue
    out.push(title)
  }
  return out
}

export async function getTwitterSentiment(): Promise<SentimentScore> {
  const rapid = process.env.RAPIDAPI_KEY
  const rapidHost = process.env.RAPIDAPI_HOST || "twitter-api45.p.rapidapi.com"
  const geminiKey = process.env.GEMINI_API_KEY
  if (!rapid) return { source: "Twitter/X", score: 0, signal: "NO_KEY" }
  if (!geminiKey) return { source: "Twitter/X", score: 0, signal: "NO_GEMINI" }

  const res = await fetch("https://twitter-api45.p.rapidapi.com/search.php?query=bitcoin&count=50", {
    headers: {
      "x-rapidapi-key": rapid,
      "x-rapidapi-host": rapidHost
    },
    cache: "no-store"
  })
  if (!res.ok) return { source: "Twitter/X", score: 0, signal: `ERROR_${res.status}` }
  const data = (await res.json()) as any
  const rows =
    (Array.isArray(data?.results) && data.results) ||
    (Array.isArray(data?.timeline) && data.timeline) ||
    (Array.isArray(data?.tweets) && data.tweets) ||
    (Array.isArray(data?.data) && data.data) ||
    []
  const tweets = Array.isArray(rows) ? rows.slice(0, 20).map((t: any) => String(t?.text ?? t?.full_text ?? t?.content ?? "")).filter(Boolean) : []
  if (!tweets.length) return { source: "Twitter/X", score: 0, signal: "NO_DATA" }

  const prompt = `Analyze crypto Twitter sentiment from these tweets.
Respond ONLY with JSON:
{"overall": "BULLISH"|"BEARISH"|"NEUTRAL", "score": -15 to 15, "dominant_emotion": "string", "influencer_bias": "BULLISH"|"BEARISH"|"MIXED"}

Tweets:
${tweets.join("\n")}`

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
      })
    }
  )

  const geminiData = (await geminiRes.json()) as any
  const text = String(geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
  const clean = text.replace(/```json|```/g, "").trim()
  const twitterAnalysis = JSON.parse(clean) as any

  const score = clampNum(Number(twitterAnalysis?.score ?? 0), -15, 15)
  const overall = String(twitterAnalysis?.overall ?? "NEUTRAL")
  const dominantEmotion = String(twitterAnalysis?.dominant_emotion ?? "")
  const influencerBias = String(twitterAnalysis?.influencer_bias ?? "")

  return {
    source: "Twitter/X",
    score,
    signal: overall,
    details: { dominantEmotion, influencerBias }
  }
}

export async function getCombinedSentiment(): Promise<CombinedSentiment> {
  const [reddit, trends, news, twitter] = await Promise.allSettled([
    getRedditSentiment(),
    getGoogleTrendsSentiment(),
    getNewsSentiment(),
    getTwitterSentiment()
  ])

  const fulfilled = [reddit, trends, news, twitter].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<SentimentScore>[]
  const scores = fulfilled.map((r) => r.value.score)
  const totalScore = scores.reduce((a, b) => a + b, 0)
  const avgScore = scores.length ? totalScore / scores.length : 0

  const overallSentiment =
    avgScore > 15
      ? "EXTREMELY_BULLISH"
      : avgScore > 8
        ? "BULLISH"
        : avgScore < -15
          ? "EXTREMELY_BEARISH"
          : avgScore < -8
            ? "BEARISH"
            : "NEUTRAL"

  const tradingSignal =
    avgScore > 10 ? "CONFIRM_LONGS" : avgScore < -10 ? "CONFIRM_SHORTS" : Math.abs(avgScore) < 5 ? "NEUTRAL_OK_EITHER" : "SLIGHT_LEAN"

  const setupScoreAddition = clampInt(Math.round(avgScore * 0.5), -20, 20)

  const out: CombinedSentiment = {
    totalScore,
    avgScore,
    overallSentiment,
    tradingSignal,
    setupScoreAddition,
    sources: {
      reddit: reddit.status === "fulfilled" ? reddit.value : undefined,
      trends: trends.status === "fulfilled" ? trends.value : undefined,
      news: news.status === "fulfilled" ? news.value : undefined,
      twitter: twitter.status === "fulfilled" ? twitter.value : undefined
    }
  }

  const newsDetails = out.sources.news?.details as any
  if (newsDetails?.keyTheme) out.keyTheme = String(newsDetails.keyTheme)
  if (Array.isArray(newsDetails?.riskEvents)) out.riskEvents = newsDetails.riskEvents.map((x: any) => String(x))

  return out
}

export function formatSentimentTelegram(s: CombinedSentiment): string {
  const r = s.sources.reddit
  const t = s.sources.trends
  const n = s.sources.news
  const x = s.sources.twitter

  const line = (label: string, v?: SentimentScore) => {
    if (!v) return `❓ ${label}: NO DATA (0)`
    const sign = v.score > 0 ? "+" : ""
    return `${label}: ${v.signal} (${sign}${v.score})`
  }

  const bias =
    s.avgScore < -8 ? "Reduce long confidence by 5%" : s.avgScore > 8 ? "Reduce short confidence by 5%" : "Neutral"

  return `🧠 <b>SENTIMENT ANALYSIS REPORT</b>
━━━━━━━━━━━━━━
📱 Reddit: ${escapeHtml(line(" ", r).replace(/^ /, ""))}
📈 Google Trends: ${escapeHtml(line(" ", t).replace(/^ /, ""))}
📰 News: ${escapeHtml(line(" ", n).replace(/^ /, ""))}
🐦 Twitter: ${escapeHtml(line(" ", x).replace(/^ /, ""))}

📊 Combined Score: ${Math.round(s.avgScore)} (${escapeHtml(s.overallSentiment)})
💡 Overall: ${escapeHtml(s.tradingSignal)}
🎯 Bot bias: ${escapeHtml(bias)}

Key theme: ${escapeHtml(s.keyTheme ?? "—")}
Risk events: ${escapeHtml(s.riskEvents?.length ? JSON.stringify(s.riskEvents) : "—")}`
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function clampNum(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(min, Math.min(max, n))
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
