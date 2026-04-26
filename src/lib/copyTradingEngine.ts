import type { ExecutionMode } from "@/types/bot"

export type CopyTrader = {
  uid: string
  name: string
  winRate: number
  monthlyReturn: number
  copyRatio: number
  maxPerTrade: number
  active: boolean
}

export type CopyTradingGlobalLimits = {
  maxOpenCopyTrades: number
  maxTotalExposureUsd: number
  skipCoins: string[]
}

export type CopyTradingSettings = {
  mode: ExecutionMode
  traders: CopyTrader[]
  limits: CopyTradingGlobalLimits
}

export type CopyPosition = {
  source: "BINGX_COPY"
  traderUid: string
  sourceId: string
  symbol: string
  side: "LONG" | "SHORT"
  entryPrice?: number
  theirNotionalUsd?: number
  openedAt?: number
}

export type CopyTradeAction =
  | { type: "OPEN"; trader: CopyTrader; position: CopyPosition; myNotionalUsd: number }
  | { type: "CLOSE"; trader: CopyTrader; position: CopyPosition }

export type FetchTraderPositionsResult = {
  ok: boolean
  positions: CopyPosition[]
  error?: string
}

export function defaultCopyTradingSettings(): CopyTradingSettings {
  return {
    mode: "paper",
    traders: [],
    limits: {
      maxOpenCopyTrades: 5,
      maxTotalExposureUsd: 100,
      skipCoins: []
    }
  }
}

export function normalizeCopyTradingSettings(input: unknown): CopyTradingSettings {
  const base = defaultCopyTradingSettings()
  const x = input as any
  const modeRaw = String(x?.mode ?? base.mode).toLowerCase()
  const mode: ExecutionMode = modeRaw === "live" ? "live" : modeRaw === "mirror" ? "mirror" : "paper"

  const tradersRaw = Array.isArray(x?.traders) ? x.traders : []
  const traders = tradersRaw
    .map((t: any): CopyTrader | null => {
      const uid = String(t?.uid ?? "").trim()
      if (!uid) return null
      const name = String(t?.name ?? `Trader ${uid}`).trim() || `Trader ${uid}`
      const winRate = clampNumber(Number(t?.winRate ?? 0), 0, 100)
      const monthlyReturn = clampNumber(Number(t?.monthlyReturn ?? 0), -1000, 1000)
      const copyRatio = clampNumber(Number(t?.copyRatio ?? 0.5), 0.01, 5)
      const maxPerTrade = clampNumber(Number(t?.maxPerTrade ?? 20), 1, 1_000_000)
      const active = Boolean(t?.active ?? true)
      return { uid, name, winRate, monthlyReturn, copyRatio, maxPerTrade, active }
    })
    .filter(Boolean)
    .slice(0, 5) as CopyTrader[]

  const skipCoins = Array.isArray(x?.limits?.skipCoins)
    ? (x.limits.skipCoins as any[]).map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : base.limits.skipCoins

  const limits: CopyTradingGlobalLimits = {
    maxOpenCopyTrades: clampInt(Number(x?.limits?.maxOpenCopyTrades ?? base.limits.maxOpenCopyTrades), 1, 50),
    maxTotalExposureUsd: clampNumber(Number(x?.limits?.maxTotalExposureUsd ?? base.limits.maxTotalExposureUsd), 1, 100_000_000),
    skipCoins
  }

  return { mode, traders, limits }
}

export function shouldSkipSymbol(symbol: string, skipCoins: string[]): boolean {
  const base = String(symbol ?? "").toUpperCase().replace("-", "")
  const coin = base.includes("USDT") ? base.replace("USDT", "") : base
  return skipCoins.some((s) => coin.includes(String(s).toUpperCase().replace("-", "").trim()))
}

export function computeMyNotionalUsd(opts: { trader: CopyTrader; theirNotionalUsd: number }): number {
  const their = clampNumber(opts.theirNotionalUsd, 0, 1_000_000_000)
  const scaled = their * clampNumber(opts.trader.copyRatio, 0.01, 5)
  return Math.min(scaled, clampNumber(opts.trader.maxPerTrade, 1, 1_000_000_000))
}

export function planCopyActions(opts: {
  trader: CopyTrader
  theirPositions: CopyPosition[]
  myCopiedPositions: CopyPosition[]
  limits: CopyTradingGlobalLimits
  currentOpenCopyTrades: number
  currentExposureUsd: number
}): CopyTradeAction[] {
  const actions: CopyTradeAction[] = []
  const their = opts.theirPositions.filter((p) => !shouldSkipSymbol(p.symbol, opts.limits.skipCoins))
  const my = opts.myCopiedPositions

  const myBySourceId = new Map<string, CopyPosition>()
  for (const p of my) myBySourceId.set(p.sourceId, p)

  for (const pos of their) {
    if (myBySourceId.has(pos.sourceId)) continue
    if (opts.currentOpenCopyTrades + actions.filter((a) => a.type === "OPEN").length >= opts.limits.maxOpenCopyTrades) break
    const theirNotional = Number(pos.theirNotionalUsd ?? 0)
    const myNotional = computeMyNotionalUsd({ trader: opts.trader, theirNotionalUsd: theirNotional })
    if (opts.currentExposureUsd + myNotional > opts.limits.maxTotalExposureUsd) continue
    actions.push({ type: "OPEN", trader: opts.trader, position: pos, myNotionalUsd: myNotional })
  }

  const theirIds = new Set(their.map((p) => p.sourceId))
  for (const mine of my) {
    if (!theirIds.has(mine.sourceId)) {
      actions.push({ type: "CLOSE", trader: opts.trader, position: mine })
    }
  }

  return actions
}

export function parseBingxCopyPositionsJson(uid: string, json: unknown): FetchTraderPositionsResult {
  try {
    const data = json as any
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.positions) ? data.data.positions : []
    const positions: CopyPosition[] = []
    for (const row of list) {
      if (!row || typeof row !== "object") continue
      const id = String((row as any).id ?? (row as any).positionId ?? (row as any).orderId ?? "").trim()
      const symbol = String((row as any).symbol ?? "").trim()
      if (!id || !symbol) continue
      const sideRaw = String((row as any).positionSide ?? (row as any).side ?? (row as any).direction ?? "").toUpperCase()
      const side = sideRaw.includes("SHORT") || sideRaw === "SELL" ? "SHORT" : "LONG"
      const entryPrice = safeNumber((row as any).entryPrice ?? (row as any).avgPrice)
      const notional = safeNumber((row as any).positionValue ?? (row as any).notionalUsd ?? (row as any).notional)
      const openedAt = safeNumber((row as any).openTime ?? (row as any).createdAt ?? (row as any).timestamp)
      positions.push({
        source: "BINGX_COPY",
        traderUid: uid,
        sourceId: id,
        symbol,
        side,
        entryPrice: entryPrice ?? undefined,
        theirNotionalUsd: notional ?? undefined,
        openedAt: openedAt ?? undefined
      })
    }
    return { ok: true, positions }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse failed"
    return { ok: false, positions: [], error: msg }
  }
}

export function buildTelegramCopyOpened(opts: {
  trader: CopyTrader
  symbol: string
  side: "LONG" | "SHORT"
  theirNotionalUsd?: number
  myNotionalUsd: number
  entryPrice?: number
}): string {
  return `👥 <b>COPY TRADE OPENED</b>
━━━━━━━━━━━━━━
Following: ${opts.trader.name} (#${opts.trader.uid})
Symbol: ${opts.symbol} ${opts.side}
Their size: $${fmtUsd(opts.theirNotionalUsd ?? 0)}
Your size: $${fmtUsd(opts.myNotionalUsd)} (${opts.trader.copyRatio}x)
Entry: $${fmtUsd(opts.entryPrice ?? 0)}
Their WR: ${fmtPct(opts.trader.winRate)} | 30d: ${opts.trader.monthlyReturn >= 0 ? "+" : ""}${fmtPct(opts.trader.monthlyReturn)}`
}

export function buildTelegramCopyClosed(opts: { trader: CopyTrader; symbol: string; side: "LONG" | "SHORT" }): string {
  return `👥 <b>COPY TRADE CLOSED</b>
━━━━━━━━━━━━━━
Trader: ${opts.trader.name} (#${opts.trader.uid})
${opts.symbol} ${opts.side}`
}

function fmtUsd(n: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "0"
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(6)
}

function fmtPct(n: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "0.0%"
  return `${v.toFixed(1)}%`
}

function safeNumber(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

