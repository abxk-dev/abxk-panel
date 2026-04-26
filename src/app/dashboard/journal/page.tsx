"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import type { TradeJournalEntry } from "@/types/bot"
import { format } from "date-fns"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

export default function JournalPage() {
  const [entries, setEntries] = useState<TradeJournalEntry[]>([])
  const [result, setResult] = useState<"ALL" | "WIN" | "LOSS" | "OPEN">("ALL")
  const [symbol, setSymbol] = useState<string>("ALL")
  const [level, setLevel] = useState<string>("ALL")
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "ALL">("30d")
  const [regime, setRegime] = useState<string>("ALL")
  const [selected, setSelected] = useState<TradeJournalEntry | null>(null)

  useEffect(() => {
    const load = () => setEntries(loadJournal())
    load()
    const onStorage = (e: StorageEvent) => {
      if (e.key === "trade_journal") load()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const symbols = useMemo(() => {
    const set = new Set(entries.map((e) => e.symbol))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [entries])

  const levels = useMemo(() => {
    const set = new Set(entries.map((e) => e.compoundLevel).filter((x) => Number.isFinite(x)))
    return Array.from(set).sort((a, b) => a - b)
  }, [entries])

  const regimes = useMemo(() => {
    const set = new Set(entries.map((e) => e.regime).filter(Boolean))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [entries])

  const filtered = useMemo(() => {
    const now = Date.now()
    const cutoff =
      range === "7d"
        ? now - 7 * 24 * 60 * 60_000
        : range === "30d"
          ? now - 30 * 24 * 60 * 60_000
          : range === "90d"
            ? now - 90 * 24 * 60 * 60_000
            : 0

    return entries
      .filter((e) => (cutoff ? e.timestamp >= cutoff : true))
      .filter((e) => (result === "ALL" ? true : e.result === result))
      .filter((e) => (symbol === "ALL" ? true : e.symbol === symbol))
      .filter((e) => (level === "ALL" ? true : String(e.compoundLevel) === level))
      .filter((e) => (regime === "ALL" ? true : e.regime === regime))
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [entries, result, symbol, level, range, regime])

  const stats = useMemo(() => computeStats(filtered), [filtered])

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Trade Journal</div>
        <div className="text-sm text-white/60">Local journal (trade_journal) with filters, stats, and exports</div>
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={result}
          onChange={(e) => setResult(e.target.value as any)}
        >
          <option value="ALL">All</option>
          <option value="WIN">WIN</option>
          <option value="LOSS">LOSS</option>
          <option value="OPEN">OPEN</option>
        </select>
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        >
          <option value="ALL">All symbols</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="ALL">All levels</option>
          {levels.map((l) => (
            <option key={l} value={String(l)}>
              Level {l}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={range}
          onChange={(e) => setRange(e.target.value as any)}
        >
          <option value="7d">7d</option>
          <option value="30d">30d</option>
          <option value="90d">90d</option>
          <option value="ALL">All</option>
        </select>
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={regime}
          onChange={(e) => setRegime(e.target.value)}
        >
          <option value="ALL">All regimes</option>
          {regimes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-6">
        <StatCard title="Total trades" value={String(stats.total)} />
        <StatCard title="Win rate" value={`${stats.winRate.toFixed(1)}%`} />
        <StatCard title="Avg PnL%" value={`${stats.avgPnlPct.toFixed(2)}%`} />
        <StatCard title="Best trade" value={`${stats.bestPnlPct.toFixed(2)}%`} />
        <StatCard title="Worst trade" value={`${stats.worstPnlPct.toFixed(2)}%`} />
        <StatCard title="Profit factor" value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "—"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/70">{filtered.length} rows</div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-white/5"
            onClick={() => exportCsv(filtered)}
          >
            EXPORT TO CSV
          </button>
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-white/5"
            onClick={() => exportPdf(filtered)}
          >
            EXPORT TO PDF
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-[1200px] w-full bg-black/10 text-left text-sm text-white/80">
          <thead className="bg-black/30 text-xs text-white/60">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Symbol</th>
              <th className="px-3 py-3">Dir</th>
              <th className="px-3 py-3">Entry</th>
              <th className="px-3 py-3">Exit</th>
              <th className="px-3 py-3">PnL%</th>
              <th className="px-3 py-3">Score</th>
              <th className="px-3 py-3">Level</th>
              <th className="px-3 py-3">Regime</th>
              <th className="px-3 py-3">Chart</th>
              <th className="px-3 py-3">AI Summary</th>
              <th className="px-3 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-t border-white/10 hover:bg-white/5">
                <td className="px-3 py-3">{format(new Date(e.timestamp), "dd/MM/yyyy HH:mm")}</td>
                <td className="px-3 py-3">{e.symbol}</td>
                <td className="px-3 py-3">{e.direction}</td>
                <td className="px-3 py-3">${fmt(e.entryPrice)}</td>
                <td className="px-3 py-3">{e.exitPrice ? `$${fmt(e.exitPrice)}` : "—"}</td>
                <td className={`px-3 py-3 ${e.pnlPercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {e.result === "OPEN" ? "—" : `${e.pnlPercent >= 0 ? "+" : ""}${e.pnlPercent.toFixed(2)}%`}
                </td>
                <td className="px-3 py-3">{e.setupScore}/100</td>
                <td className="px-3 py-3">L{e.compoundLevel}</td>
                <td className="px-3 py-3">{e.regime}</td>
                <td className="px-3 py-3">
                  {e.chartImageBase64 ? (
                    <button
                      className="rounded-md border border-white/10 bg-black/30 p-1 hover:bg-white/5"
                      onClick={() => setSelected(e)}
                    >
                      <Image
                        unoptimized
                        src={`data:image/png;base64,${e.chartImageBase64}`}
                        width={64}
                        height={32}
                        className="h-8 w-16 rounded object-cover"
                        alt=""
                      />
                    </button>
                  ) : (
                    <span className="text-white/40">—</span>
                  )}
                </td>
                <td className="px-3 py-3">{truncate(e.aiAnalysis || "—", 60)}</td>
                <td className="px-3 py-3">
                  <button
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white hover:bg-white/5"
                    onClick={() => setSelected(e)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-sm text-white/60" colSpan={12}>
                  No journal entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selected ? (
        <DetailModal
          entry={selected}
          onClose={() => setSelected(null)}
          onSaveNotes={(notes) => {
            const next = entries.map((x) => (x.id === selected.id ? { ...x, notes } : x))
            setEntries(next)
            saveJournal(next)
            setSelected({ ...selected, notes })
          }}
        />
      ) : null}
    </div>
  )
}

function loadJournal(): TradeJournalEntry[] {
  try {
    const raw = localStorage.getItem("trade_journal")
    const parsed = raw ? (JSON.parse(raw) as TradeJournalEntry[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveJournal(entries: TradeJournalEntry[]) {
  try {
    localStorage.setItem("trade_journal", JSON.stringify(entries))
  } catch {
    return
  }
}

function computeStats(rows: TradeJournalEntry[]) {
  const closed = rows.filter((r) => r.result !== "OPEN")
  const wins = closed.filter((r) => r.result === "WIN")
  const losses = closed.filter((r) => r.result === "LOSS")
  const total = rows.length
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
  const avgPnlPct = closed.length ? closed.reduce((a, b) => a + b.pnlPercent, 0) / closed.length : 0
  const bestPnlPct = closed.length ? Math.max(...closed.map((r) => r.pnlPercent)) : 0
  const worstPnlPct = closed.length ? Math.min(...closed.map((r) => r.pnlPercent)) : 0
  const grossWin = wins.reduce((a, b) => a + Math.max(0, b.pnl), 0)
  const grossLoss = losses.reduce((a, b) => a + Math.abs(Math.min(0, b.pnl)), 0)
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Number.NaN
  return { total, winRate, avgPnlPct, bestPnlPct, worstPnlPct, profitFactor }
}

function exportCsv(rows: TradeJournalEntry[]) {
  const headers = [
    "Date",
    "Symbol",
    "Direction",
    "Entry",
    "Exit",
    "PnL",
    "PnL%",
    "Duration",
    "Score",
    "Level",
    "Regime",
    "RSI",
    "Volume",
    "Funding",
    "AI_Verdict",
    "Exit_Reason"
  ]
  const lines = [headers.join(",")]
  for (const r of rows) {
    const row = [
      format(new Date(r.timestamp), "yyyy-MM-dd HH:mm"),
      r.symbol,
      r.direction,
      r.entryPrice,
      r.exitPrice,
      r.pnl,
      r.pnlPercent,
      r.duration,
      r.setupScore,
      r.compoundLevel,
      r.regime,
      r.filters.rsi,
      r.filters.volumeRatio,
      r.filters.fundingRate,
      truncate(r.aiAnalysis || "", 120).replaceAll("\n", " "),
      r.exitReason
    ].map((v) => csvCell(String(v ?? "")))
    lines.push(row.join(","))
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `trade_journal_${format(new Date(), "yyyyMMdd_HHmm")}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPdf(rows: TradeJournalEntry[]) {
  const doc = new jsPDF({ orientation: "landscape" })
  doc.setFontSize(18)
  doc.text("ABXK BOT — Trade Journal", 14, 14)
  doc.setFontSize(10)
  doc.text(`Exported: ${format(new Date(), "yyyy-MM-dd HH:mm")}`, 14, 20)

  const stats = computeStats(rows)
  doc.text(
    `Trades: ${stats.total} | Win rate: ${stats.winRate.toFixed(1)}% | Avg PnL%: ${stats.avgPnlPct.toFixed(2)}% | Profit factor: ${
      Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "—"
    }`,
    14,
    26
  )

  autoTable(doc, {
    startY: 32,
    head: [[
      "Date",
      "Symbol",
      "Dir",
      "Entry",
      "Exit",
      "PnL%",
      "Score",
      "Level",
      "Regime",
      "Exit",
      "AI Summary"
    ]],
    body: rows.map((r) => [
      format(new Date(r.timestamp), "yyyy-MM-dd HH:mm"),
      r.symbol,
      r.direction,
      `$${fmt(r.entryPrice)}`,
      r.exitPrice ? `$${fmt(r.exitPrice)}` : "—",
      r.result === "OPEN" ? "—" : `${r.pnlPercent >= 0 ? "+" : ""}${r.pnlPercent.toFixed(2)}%`,
      `${r.setupScore}/100`,
      `L${r.compoundLevel}`,
      r.regime,
      r.exitReason,
      truncate(r.aiAnalysis || "—", 80)
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [17, 17, 17], textColor: [212, 160, 23] }
  })

  doc.addPage()
  doc.setFontSize(14)
  doc.text("AI Analysis (per trade)", 14, 14)
  doc.setFontSize(9)
  let y = 22
  for (const r of rows.slice(0, 25)) {
    const title = `${format(new Date(r.timestamp), "yyyy-MM-dd")} — ${r.symbol} ${r.direction} (${r.result})`
    const text = (r.aiAnalysis || "—").slice(0, 600)
    doc.text(title, 14, y)
    y += 5
    const lines = doc.splitTextToSize(text, 260)
    doc.text(lines, 14, y)
    y += Math.min(60, lines.length * 4 + 6)
    if (y > 180) break
  }

  doc.save(`trade_journal_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`)
}

function csvCell(v: string): string {
  const s = v.replaceAll('"', '""')
  return `"${s}"`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return n.toFixed(2)
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function DetailModal({
  entry,
  onClose,
  onSaveNotes
}: {
  entry: TradeJournalEntry
  onClose: () => void
  onSaveNotes: (notes: string) => void
}) {
  const [notes, setNotes] = useState(entry.notes ?? "")
  const tvSymbol = toTradingViewSymbol(entry.symbol)
  const interval = entry.timeframe === "1d" ? "D" : "240"
  const tvUrl = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=${encodeURIComponent(
    interval
  )}&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hide_side_toolbar=1&allow_symbol_change=0`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-white/10 bg-bg p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">
            {entry.symbol} {entry.direction} • {format(new Date(entry.timestamp), "dd/MM/yyyy HH:mm")}
          </div>
          <button
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-xs text-white hover:bg-white/5"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Info title="Entry" value={`$${fmt(entry.entryPrice)}`} />
          <Info title="Exit" value={entry.exitPrice ? `$${fmt(entry.exitPrice)}` : "—"} />
          <Info title="PnL" value={`${entry.pnl >= 0 ? "+" : ""}$${fmt(entry.pnl)} (${entry.pnlPercent.toFixed(2)}%)`} />
          <Info title="SL" value={`$${fmt(entry.stopLoss)}`} />
          <Info title="TP" value={`$${fmt(entry.takeProfit)}`} />
          <Info title="Exit reason" value={entry.exitReason} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-white">Filters at entry</div>
            <div className="mt-2 grid gap-1 text-sm text-white/80">
              <Line label="EMA trend" value={entry.filters.emaTrend} />
              <Line label="RSI" value={String(entry.filters.rsi)} />
              <Line label="Volume ratio" value={String(entry.filters.volumeRatio)} />
              <Line label="ATR" value={String(entry.filters.atr)} />
              <Line label="MACD" value={entry.filters.macd} />
              <Line label="Funding" value={String(entry.filters.fundingRate)} />
              <Line label="OI change" value={String(entry.filters.oiChange)} />
              <Line label="Fear & Greed" value={String(entry.filters.fearGreed)} />
              <Line label="Fib level" value={entry.filters.fibLevel} />
              <Line label="Session" value={entry.filters.session} />
              <Line label="Daily bias" value={entry.filters.dailyBias} />
              <Line label="BTC correlation" value={entry.filters.btcCorrelation} />
              <Line label="DXY" value={entry.filters.dxy} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-white">Chart snapshot</div>
            <div className="mt-2 h-[320px] overflow-hidden rounded-lg border border-white/10">
              {entry.chartImageBase64 ? (
                <div className="relative h-full w-full">
                  <Image
                    unoptimized
                    src={`data:image/png;base64,${entry.chartImageBase64}`}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    style={{ objectFit: "cover" }}
                  />
                </div>
              ) : (
                <iframe className="h-full w-full" src={tvUrl} />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-white">AI analysis</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-white/80">{entry.aiAnalysis || "—"}</div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-white">Notes</div>
          <textarea
            className="mt-2 h-28 w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add manual notes..."
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white hover:bg-white/5"
              onClick={() => onSaveNotes(notes)}
            >
              Save notes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-white/60">{label}</div>
      <div className="text-white/90">{value}</div>
    </div>
  )
}

function toTradingViewSymbol(symbol: string): string {
  const compact = symbol.replace("-", "").toUpperCase()
  return `BINANCE:${compact}`
}
