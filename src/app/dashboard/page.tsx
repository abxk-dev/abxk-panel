"use client"

import { useEffect, useMemo, useState } from "react"
import { EquityCurve } from "@/components/EquityCurve"
import { LiveTradingChart } from "@/components/LiveTradingChart"
import { useLivePrice } from "@/lib/useLivePrice"
import { generateCompoundingPlan, getActiveLevel } from "@/lib/compounding"
import { useBotStore } from "@/store/botStore"

type NewsUiState =
  | { state: "LOADING" }
  | { state: "ACTIVE"; title: string; endsAt: number }
  | { state: "UPCOMING"; title: string; startsAt: number }
  | { state: "CLEAR"; nextTitle?: string; nextTime?: number }

export default function OverviewPage() {
  const settings = useBotStore((s) => s.settings)
  const completed = useBotStore((s) => s.completedLevels)
  const paperTrades = useBotStore((s) => s.paperTrades)
  const dailyPnl = useBotStore((s) => s.dailyPnlUsd)
  const onPriceTick = useBotStore((s) => s.onPriceTick)
  const regime = useBotStore((s) => s.marketRegime)
  const scannerResults = useBotStore((s) => s.scannerResults)
  const scannerLastScanAt = useBotStore((s) => s.scannerLastScanAt)
  const scannerLastScanCandleOpenTime = useBotStore((s) => s.scannerLastScanCandleOpenTime)
  const scannerSelectedSymbol = useBotStore((s) => s.scannerSelectedSymbol)

  const { price, source } = useLivePrice(settings.symbol)
  const [news, setNews] = useState<NewsUiState>({ state: "LOADING" })
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (price !== undefined) onPriceTick(price)
  }, [price, onPriceTick])

  useEffect(() => {
    if (!settings.features.newsFilter) {
      setNews({ state: "CLEAR" })
      return
    }

    let mounted = true
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/news/status?blackoutMinutes=${encodeURIComponent(
            settings.thresholds.newsBlackoutMinutes
          )}&currencies=USD,BTC`,
          { cache: "no-store" }
        )
        const json = (await res.json()) as any
        const data = json?.data
        const state = data?.state as string | undefined
        if (!mounted) return
        if (state === "ACTIVE") {
          setNews({ state: "ACTIVE", title: String(data?.event?.title ?? "High impact news"), endsAt: Number(data?.endsAt ?? 0) })
          return
        }
        if (state === "UPCOMING") {
          setNews({
            state: "UPCOMING",
            title: String(data?.event?.title ?? "High impact news"),
            startsAt: Number(data?.startsAt ?? 0)
          })
          return
        }
        setNews({
          state: "CLEAR",
          nextTitle: data?.next?.title ? String(data.next.title) : undefined,
          nextTime: typeof data?.next?.time === "number" ? data.next.time : undefined
        })
      } catch {
        if (mounted) setNews({ state: "CLEAR" })
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 60_000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [settings.features.newsFilter, settings.thresholds.newsBlackoutMinutes])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const stats = useMemo(() => {
    const closed = paperTrades.filter((t) => t.status === "CLOSED" && t.pnlUsd !== undefined)
    const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0

    const today = new Date()
    const dayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(
      today.getUTCDate()
    ).padStart(2, "0")}`
    const todayPnl = dailyPnl[dayKey] ?? 0

    return { winRate, todayPnl }
  }, [paperTrades, dailyPnl])

  const plan = useMemo(() => generateCompoundingPlan(settings), [settings])
  const activeLevel = useMemo(() => getActiveLevel(settings.compounding.levels, completed), [settings, completed])
  const active = plan.find((x) => x.level === activeLevel)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <RegimePill
          regime={regime?.regime}
          reduced={regime?.regime === "VOLATILE" && regime.volatileMode === "REDUCE_50"}
        />
        <NewsBanner news={news} now={now} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Mode" value={settings.mode.toUpperCase()} />
        <Card title="Symbol" value={settings.symbol} />
        <Card
          title={`Live Price (${source.toUpperCase()})`}
          value={price ? price.toLocaleString() : "—"}
        />
        <Card title="Win Rate (paper)" value={`${stats.winRate.toFixed(1)}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="space-y-4">
            <EquityCurve />
            <div
              style={{
                background: "#0a0a0a",
                border: "1px solid #1a1a1a",
                borderRadius: "8px",
                overflow: "hidden",
                width: "100%"
              }}
            >
              <LiveTradingChart symbol={settings.symbol || "BTC-USDT"} />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Daily PnL (UTC)</div>
            <div className={stats.todayPnl >= 0 ? "text-2xl font-semibold text-emerald-400" : "text-2xl font-semibold text-rose-400"}>
              ${stats.todayPnl.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Current Level</div>
            <div className="text-2xl font-semibold text-white">Level {activeLevel}</div>
            <div className="mt-2 text-sm text-white/70">
              Balance: ${active?.balanceUsd.toLocaleString() ?? settings.capital.initialCapitalUsd.toLocaleString()}
            </div>
            <div className="text-sm text-white/70">
              Target: ${active?.endingBalanceUsd.toLocaleString() ?? "—"}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/60">Trade Rule</div>
            <div className="text-sm text-white/80">Max {settings.maxTradesPerDay} trade/day</div>
            <div className="text-sm text-white/80">Min score {settings.minSetupScore}/100</div>
          </div>

          {settings.features.scanner ? (
            <ScannerWidget
              minScore={settings.minSetupScore}
              timeframe={settings.timeframe}
              results={scannerResults}
              lastScanAt={scannerLastScanAt}
              lastScanCandleOpenTime={scannerLastScanCandleOpenTime}
              selectedSymbol={scannerSelectedSymbol}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function RegimePill(opts: { regime?: string; reduced: boolean }) {
  const label = opts.regime ? opts.regime.replaceAll("_", " ") : "REGIME: —"
  const tone =
    opts.regime === "TRENDING_BULL"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : opts.regime === "TRENDING_BEAR"
        ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
        : opts.regime === "RANGING"
          ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
          : opts.regime === "VOLATILE"
            ? "bg-orange-500/15 text-orange-300 border-orange-500/30"
            : "bg-white/5 text-white/70 border-white/10"

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
      <span>{label}</span>
      {opts.regime === "VOLATILE" && opts.reduced ? <span className="text-orange-200">⚠️ Reduced size</span> : null}
    </div>
  )
}

function NewsBanner({ news, now }: { news: NewsUiState; now: number }) {
  if (news.state === "LOADING") {
    return (
      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
        News: loading…
      </div>
    )
  }

  if (news.state === "ACTIVE") {
    const remaining = Math.max(0, news.endsAt - now)
    return (
      <div className="rounded-full border border-rose-500/30 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-200">
        ⛔ NEWS BLACKOUT — {formatRemaining(remaining)} remaining
      </div>
    )
  }

  if (news.state === "UPCOMING") {
    const until = Math.max(0, news.startsAt - now)
    const mins = Math.floor(until / 60000)
    if (mins <= 30) {
      return (
        <div className="rounded-full border border-yellow-500/30 bg-yellow-500/15 px-3 py-1 text-xs font-semibold text-yellow-200">
          ⚠️ News in {mins} min — {news.title}
        </div>
      )
    }
  }

  return (
    <div className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">
      ✅ No news — trading allowed
    </div>
  )
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function ScannerWidget(opts: {
  minScore: number
  timeframe?: string
  results: {
    symbol: string
    displaySymbol?: string
    direction?: string
    totalScore?: number
    rr?: number
    rank?: number
    regime?: string
    status: string
  }[]
  lastScanAt?: number
  lastScanCandleOpenTime?: number
  selectedSymbol?: string
}) {
  const lastScanLabel = opts.lastScanAt ? formatUtcHm(opts.lastScanAt) : "—"
  const intervalMs =
    opts.timeframe === "15m"
      ? 15 * 60 * 1000
      : opts.timeframe === "1h"
        ? 60 * 60 * 1000
        : opts.timeframe === "4h"
          ? 4 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000
  const nextScanAt = opts.lastScanCandleOpenTime ? opts.lastScanCandleOpenTime + intervalMs : undefined
  const nextScanLabel = nextScanAt ? formatUtcHm(nextScanAt) : "—"
  const tfLabel = (opts.timeframe ?? "4h").toUpperCase()

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Opportunity Scanner — {tfLabel}</div>
        <div className="text-xs text-white/60">
          Last: {lastScanLabel} | Next: {nextScanLabel}
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-white/70">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Dir</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">RR</th>
              <th className="px-3 py-2">Regime</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {opts.results.slice(0, 12).map((r) => {
              const selected = r.status === "TRADE" || (opts.selectedSymbol ? r.symbol === opts.selectedSymbol : false)
              const dirTone =
                r.direction === "LONG"
                  ? "text-emerald-300"
                  : r.direction === "SHORT"
                    ? "text-rose-300"
                    : "text-white/70"
              const rr = typeof r.rr === "number" && Number.isFinite(r.rr) ? r.rr : undefined
              const rrLabel = rr === undefined ? "—" : `${rr.toFixed(2)}x`
              return (
                <tr key={`${r.symbol}-${r.displaySymbol ?? ""}`} className={selected ? "bg-emerald-500/10" : undefined}>
                  <td className="px-3 py-2 text-white/70">{typeof r.rank === "number" && r.rank > 0 ? r.rank : "—"}</td>
                  <td className="px-3 py-2 font-semibold text-white">
                    {r.displaySymbol ?? r.symbol}
                    {r.displaySymbol && r.displaySymbol !== r.symbol ? (
                      <span className="ml-2 text-white/50">({r.symbol})</span>
                    ) : null}
                    {selected ? <span className="ml-2 text-emerald-300">← SELECTED</span> : null}
                  </td>
                  <td className={`px-3 py-2 ${dirTone}`}>{r.direction ?? "—"}</td>
                  <td className="px-3 py-2 text-white/80">
                    {typeof r.totalScore === "number" ? `${r.totalScore}/100` : "—"}
                  </td>
                  <td className="px-3 py-2 text-white/80">
                    {rrLabel}
                  </td>
                  <td className="px-3 py-2 text-white/70">{r.regime ? r.regime.replaceAll("_", " ") : "—"}</td>
                  <td className="px-3 py-2 text-white/80">{r.status}</td>
                </tr>
              )
            })}
            {opts.results.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-white/60" colSpan={7}>
                  No scan results yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatUtcHm(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${hh}:${mm} UTC`
}
