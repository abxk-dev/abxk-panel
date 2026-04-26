"use client"

import { useEffect, useMemo, useRef, useState } from "react"

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

function sentimentLabel(score: number): { label: string; tone: "GOOD" | "OK" | "BAD" } {
  if (score >= 10) return { label: "BULLISH", tone: "GOOD" }
  if (score <= -10) return { label: "BEARISH", tone: "BAD" }
  return { label: "NEUTRAL", tone: "OK" }
}

export default function SocialPage() {
  const [combined, setCombined] = useState<any>(null)
  const [fng, setFng] = useState<any>(null)
  const [market, setMarket] = useState<any>(null)
  const [error, setError] = useState("")

  const refresh = async () => {
    setError("")
    try {
      const [a, b, c] = await Promise.all([
        fetch("/api/sentiment/combined", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/sentiment/fng", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/market/coingecko", { cache: "no-store" }).then((r) => r.json())
      ])
      if (a?.ok !== true) throw new Error(a?.error ?? "Sentiment fetch failed")
      setCombined(a?.data ?? null)
      setFng(b?.data ?? null)
      setMarket(c?.data ?? null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh failed"
      setError(msg)
    }
  }

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    void refreshRef.current()
    const t = window.setInterval(() => void refreshRef.current(), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const fngValue = useMemo(() => {
    const v = Number(fng?.data?.[0]?.value)
    return Number.isFinite(v) ? v : null
  }, [fng])

  const overall = useMemo(() => {
    const total = Number(combined?.totalScore ?? 0)
    const { label, tone } = sentimentLabel(total)
    return { total, label, tone }
  }, [combined])

  const toneClass = overall.tone === "GOOD" ? "text-[#00FF88]" : overall.tone === "BAD" ? "text-red-400" : "text-white"

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">📱 MARKET SENTIMENT FEED</div>
        <div className="text-sm text-white/60">Reddit + Google Trends + News + (optional) Twitter + Fear &amp; Greed</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="OVERVIEW">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Overall</div>
                <div className={`text-lg font-semibold ${toneClass}`}>{overall.label}</div>
                <div className="text-xs text-white/60">Score: {overall.total}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Fear &amp; Greed</div>
                <div className="text-lg font-semibold text-white">{fngValue !== null ? `${fngValue}/100` : "—"}</div>
                <div className="text-xs text-white/60">{String(fng?.data?.[0]?.value_classification ?? "—")}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">BTC Dominance</div>
                <div className="text-lg font-semibold text-white">
                  {typeof market?.btcDominance === "number" ? `${market.btcDominance.toFixed(2)}%` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/50">Market Cap 24h</div>
                <div className={`text-lg font-semibold ${Number(market?.marketCapChange24hPct ?? 0) >= 0 ? "text-[#00FF88]" : "text-red-400"}`}>
                  {typeof market?.marketCapChange24hPct === "number"
                    ? `${market.marketCapChange24hPct >= 0 ? "+" : ""}${market.marketCapChange24hPct.toFixed(2)}%`
                    : "—"}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void refresh()}
            >
              Refresh Now
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>

          <Section title="AI SUMMARY">
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              <div>Overall sentiment: {combined?.overallSentiment ?? "—"}</div>
              <div className="mt-1">Trading signal: {combined?.tradingSignal ?? "—"}</div>
              <div className="mt-1">Setup score add: {combined?.setupScoreAddition ?? "—"}</div>
              <div className="mt-2 text-xs text-white/60">Key theme: {combined?.keyTheme ?? "—"}</div>
              {Array.isArray(combined?.riskEvents) && combined.riskEvents.length ? (
                <div className="mt-2 text-xs text-white/60">Risk events: {combined.riskEvents.slice(0, 6).join(" • ")}</div>
              ) : null}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="SOURCE BREAKDOWN">
            <div className="space-y-2">
              {(["reddit", "trends", "news", "twitter"] as const).map((k) => {
                const s = combined?.sources?.[k]
                const score = Number(s?.score ?? 0)
                const { label, tone } = sentimentLabel(score)
                const c = tone === "GOOD" ? "text-[#00FF88]" : tone === "BAD" ? "text-red-400" : "text-white"
                return (
                  <div key={k} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{String(s?.source ?? k).toUpperCase()}</div>
                      <div className={`text-xs font-semibold ${c}`}>
                        {label} ({score})
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-white/60">Signal: {String(s?.signal ?? "—")}</div>
                    {s?.details ? (
                      <div className="mt-2 text-xs text-white/50 break-words">{JSON.stringify(s.details)}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
