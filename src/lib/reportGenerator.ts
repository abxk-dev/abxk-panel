import fs from "fs"
import path from "path"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

type WeeklyReportInput = {
  weekStartUtcMs: number
  weekEndUtcMs: number
  scalping: {
    trades: number
    wins: number
    losses: number
    netPnlUsd: number
    best?: { symbol: string; pnlUsd: number; closedAt?: number }
    worst?: { symbol: string; pnlUsd: number; closedAt?: number }
    rows: Array<{ closedAt: number; symbol: string; direction: "LONG" | "SHORT"; pnlUsd: number; pnlPct?: number }>
  }
}

export type WeeklyReportResult = {
  filename: string
  mimeType: "application/pdf"
  base64: string
  summary: {
    weekStartUtcMs: number
    weekEndUtcMs: number
    netPnlUsd: number
    trades: number
    winRatePct: number
    bestLabel: string
  }
}

export function computeWeekRangeUtc(nowMs: number): { weekStartUtcMs: number; weekEndUtcMs: number; label: string } {
  const now = new Date(nowMs)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  const start = end - 7 * 24 * 60 * 60_000 + 1
  const label = `${fmtDateUtc(start)}_${fmtDateUtc(end)}`
  return { weekStartUtcMs: start, weekEndUtcMs: end, label }
}

export function buildWeeklyReportFromBotState(opts: {
  nowMs: number
  statePath?: string
}): WeeklyReportInput {
  const { weekStartUtcMs, weekEndUtcMs } = computeWeekRangeUtc(opts.nowMs)
  const p = opts.statePath ? path.resolve(opts.statePath) : path.join(process.cwd(), "bot-state.json")
  let json: any = null
  try {
    if (fs.existsSync(p)) json = JSON.parse(fs.readFileSync(p, "utf8"))
  } catch {
    json = null
  }

  const closed: any[] = Array.isArray(json?.scalping?.closedTrades) ? json.scalping.closedTrades : []
  const inWeek = closed.filter((t) => {
    const at = Number(t?.closedAt ?? 0)
    return Number.isFinite(at) && at >= weekStartUtcMs && at <= weekEndUtcMs
  })

  const rows = inWeek
    .map((t) => {
      const closedAt = Number(t?.closedAt ?? 0)
      const symbol = String(t?.symbol ?? "")
      const direction = (String(t?.direction ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT"
      const pnlUsd = Number(t?.netPnlUsd ?? t?.pnlUsd ?? 0)
      const pnlPct = t?.pnlPct !== undefined ? Number(t.pnlPct) : undefined
      if (!Number.isFinite(closedAt) || !symbol || !Number.isFinite(pnlUsd)) return null
      return { closedAt, symbol, direction, pnlUsd, pnlPct }
    })
    .filter(Boolean) as WeeklyReportInput["scalping"]["rows"]

  const trades = rows.length
  const wins = rows.filter((r) => r.pnlUsd > 0).length
  const losses = rows.filter((r) => r.pnlUsd < 0).length
  const netPnlUsd = round2(rows.reduce((s, r) => s + r.pnlUsd, 0))
  const best = rows.slice().sort((a, b) => b.pnlUsd - a.pnlUsd)[0]
  const worst = rows.slice().sort((a, b) => a.pnlUsd - b.pnlUsd)[0]

  return {
    weekStartUtcMs,
    weekEndUtcMs,
    scalping: {
      trades,
      wins,
      losses,
      netPnlUsd,
      best: best ? { symbol: best.symbol, pnlUsd: best.pnlUsd, closedAt: best.closedAt } : undefined,
      worst: worst ? { symbol: worst.symbol, pnlUsd: worst.pnlUsd, closedAt: worst.closedAt } : undefined,
      rows
    }
  }
}

export function generateWeeklyPerformancePdfBase64(input: WeeklyReportInput): WeeklyReportResult {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" })
  const title = "ABXK BOT — Weekly Performance Report"
  doc.setFontSize(16)
  doc.text(title, 40, 40)

  doc.setFontSize(10)
  doc.text(`Week: ${fmtDateUtc(input.weekStartUtcMs)} → ${fmtDateUtc(input.weekEndUtcMs)}`, 40, 58)

  const wr = input.scalping.trades > 0 ? (input.scalping.wins / input.scalping.trades) * 100 : 0
  const bestLabel = input.scalping.best ? `${input.scalping.best.symbol} (${fmtSignedUsd(input.scalping.best.pnlUsd)})` : "—"
  const worstLabel = input.scalping.worst ? `${input.scalping.worst.symbol} (${fmtSignedUsd(input.scalping.worst.pnlUsd)})` : "—"

  doc.setFontSize(11)
  doc.text("Executive Summary", 40, 88)
  doc.setFontSize(10)
  doc.text(`Total PnL: ${fmtSignedUsd(input.scalping.netPnlUsd)}`, 40, 106)
  doc.text(`Trades: ${input.scalping.trades} | Win rate: ${wr.toFixed(1)}%`, 40, 122)
  doc.text(`Best trade: ${bestLabel}`, 40, 138)
  doc.text(`Worst trade: ${worstLabel}`, 40, 154)

  doc.setFontSize(11)
  doc.text("Module Performance", 40, 186)

  autoTable(doc, {
    startY: 198,
    head: [["Module", "Trades", "Win rate", "Net PnL"]],
    body: [
      ["Scalping", String(input.scalping.trades), `${wr.toFixed(1)}%`, fmtSignedUsd(input.scalping.netPnlUsd)],
      ["Compounding", "—", "—", "—"],
      ["Grid", "—", "—", "—"],
      ["Breakout", "—", "—", "—"]
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [17, 17, 17], textColor: [212, 160, 23] }
  })

  const tableStart = (doc as any).lastAutoTable?.finalY ? Number((doc as any).lastAutoTable.finalY) + 14 : 320
  doc.setFontSize(11)
  doc.text("Scalping Trades (Closed)", 40, tableStart)

  autoTable(doc, {
    startY: tableStart + 10,
    head: [["Date (UTC)", "Symbol", "Dir", "PnL (USD)", "PnL %"]],
    body: input.scalping.rows
      .slice()
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, 60)
      .map((r) => [
        fmtDateTimeUtc(r.closedAt),
        r.symbol,
        r.direction,
        fmtSignedUsd(r.pnlUsd),
        r.pnlPct !== undefined && Number.isFinite(r.pnlPct) ? `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(2)}%` : "—"
      ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [17, 17, 17], textColor: [212, 160, 23] }
  })

  const bytes = doc.output("arraybuffer")
  const base64 = Buffer.from(bytes).toString("base64")
  const { label } = computeWeekRangeUtc(input.weekEndUtcMs)
  const filename = `ABXK_Weekly_Report_${label}.pdf`

  return {
    filename,
    mimeType: "application/pdf",
    base64,
    summary: {
      weekStartUtcMs: input.weekStartUtcMs,
      weekEndUtcMs: input.weekEndUtcMs,
      netPnlUsd: input.scalping.netPnlUsd,
      trades: input.scalping.trades,
      winRatePct: wr,
      bestLabel
    }
  }
}

export function buildWeeklyReportTelegramCaption(res: WeeklyReportResult): string {
  const start = fmtDateUtc(res.summary.weekStartUtcMs)
  const end = fmtDateUtc(res.summary.weekEndUtcMs)
  const net = fmtSignedUsd(res.summary.netPnlUsd)
  return `📊 <b>WEEKLY PERFORMANCE REPORT</b>
━━━━━━━━━━━━━━
Week: ${start} - ${end}
Total PnL: ${net}
Win Rate: ${res.summary.winRatePct.toFixed(1)}%
Trades: ${res.summary.trades}
Best: ${res.summary.bestLabel}`
}

function fmtDateUtc(ms: number) {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function fmtDateTimeUtc(ms: number) {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function fmtSignedUsd(v: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return "$0.00"
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

