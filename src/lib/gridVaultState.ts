"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type GridMode = "paper" | "live"

export type SpotGridConfig = {
  symbol: string
  capital: number
  upperPrice: number
  lowerPrice: number
  gridLevels: number
  mode: GridMode
}

export type FuturesDirection = "NEUTRAL" | "LONG" | "SHORT"

export type FuturesGridConfig = SpotGridConfig & {
  leverage: number
  direction: FuturesDirection
}

export type GridLevel = {
  price: number
  type: "BUY" | "SELL"
  amount: number
  quantity: number
  status: "PENDING" | "FILLED" | "ACTIVE"
  orderId: string | null
  filledAt: number | null
  profit: number
}

export type SpotGrid = {
  id: string
  config: SpotGridConfig
  levels: GridLevel[]
  running: boolean
  startedAt: number
  lastPrice?: number
  cycles: number
  totalProfit: number
}

export type LiquidationInfo = {
  liqPriceLong: number
  liqPriceShort: number
  distancePercent: number
  riskLevel: "SAFE" | "CAUTION" | "DANGER"
  riskColor: "green" | "yellow" | "red"
  message: string
}

export type FuturesGrid = {
  id: string
  config: FuturesGridConfig
  levels: GridLevel[]
  running: boolean
  startedAt: number
  lastPrice?: number
  cycles: number
  totalProfit: number
  lastLiqWarnAt?: number
}

export type ProfitEntry = { time: number; value: number }

export type GridCycleEntry = {
  id: string
  time: number
  type: "SPOT" | "FUT3x" | "FUT5x" | "FUT10x"
  symbol: string
  buyPrice: number
  sellPrice: number
  profit: number
  cumulative: number
}

export type GridVaultSettings = {
  enabled: boolean
  defaultSymbol: string
  defaultLeverage: number
  defaultLevels: number
  telegramUpdates: boolean
  hourlyUpdates: boolean
}

export type GridVaultAlert =
  | {
      id: string
      time: number
      type: "LIQ_WARNING"
      symbol: string
      currentPrice: number
      liqPrice: number
      remainingPercent: number
    }
  | {
      id: string
      time: number
      type: "DAILY_REPORT"
      dayKeyUtc: string
      cycles: number
      profit: number
      totalProfit: number
      capital: number
      value: number
    }

type GridVaultState = {
  spotGrids: SpotGrid[]
  futuresGrids: FuturesGrid[]
  totalCapital: number
  totalProfit: number
  totalCycles: number
  startDate: number
  profitHistory: ProfitEntry[]
  history: GridCycleEntry[]
  alerts: GridVaultAlert[]
  lastDailyReportDay?: string
  settings: GridVaultSettings

  setSettingsFromDefaults: (patch: Partial<GridVaultSettings>) => void
  startSpotGrid: (config: SpotGridConfig, currentPrice: number) => SpotGrid | null
  stopSpotGrid: (id: string) => void
  startFuturesGrid: (config: FuturesGridConfig, currentPrice: number) => FuturesGrid | null
  stopFuturesGrid: (id: string) => void
  onPriceTick: (symbol: string, currentPrice: number) => void
  consumeAlerts: () => GridVaultAlert[]
  clearHistory: () => void
}

export const useGridVaultStore = create<GridVaultState>()(
  persist(
    (set, get) => ({
      spotGrids: [],
      futuresGrids: [],
      totalCapital: 0,
      totalProfit: 0,
      totalCycles: 0,
      startDate: Date.now(),
      profitHistory: [],
      history: [],
      alerts: [],
      lastDailyReportDay: undefined,
      settings: {
        enabled: false,
        defaultSymbol: "BTC-USDT",
        defaultLeverage: 3,
        defaultLevels: 6,
        telegramUpdates: true,
        hourlyUpdates: true
      },

      setSettingsFromDefaults: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },

      startSpotGrid: (config, currentPrice) => {
        const clean = cleanSpotConfig(config)
        if (!clean) return null
        const levels = calculateGridLevels(clean, currentPrice)
        if (!levels.length) return null

        const grid: SpotGrid = {
          id: makeId(),
          config: clean,
          levels,
          running: true,
          startedAt: Date.now(),
          lastPrice: currentPrice,
          cycles: 0,
          totalProfit: 0
        }

        set((s) => ({
          spotGrids: [grid, ...s.spotGrids],
          totalCapital: round2(s.totalCapital + clean.capital),
          startDate: s.totalCapital > 0 ? s.startDate : Date.now(),
          profitHistory: s.profitHistory.length
            ? s.profitHistory
            : [{ time: Date.now(), value: round2(s.totalCapital + clean.capital + s.totalProfit) }]
        }))
        return grid
      },

      stopSpotGrid: (id) => {
        set((s) => ({
          spotGrids: s.spotGrids.map((g) => (g.id === id ? { ...g, running: false } : g))
        }))
      },

      startFuturesGrid: (config, currentPrice) => {
        const clean = cleanFuturesConfig(config)
        if (!clean) return null
        const levels = calculateGridLevels(clean, currentPrice)
        if (!levels.length) return null

        const grid: FuturesGrid = {
          id: makeId(),
          config: clean,
          levels,
          running: true,
          startedAt: Date.now(),
          lastPrice: currentPrice,
          cycles: 0,
          totalProfit: 0
        }

        set((s) => ({
          futuresGrids: [grid, ...s.futuresGrids],
          totalCapital: round2(s.totalCapital + clean.capital),
          startDate: s.totalCapital > 0 ? s.startDate : Date.now(),
          profitHistory: s.profitHistory.length
            ? s.profitHistory
            : [{ time: Date.now(), value: round2(s.totalCapital + clean.capital + s.totalProfit) }]
        }))
        return grid
      },

      stopFuturesGrid: (id) => {
        set((s) => ({
          futuresGrids: s.futuresGrids.map((g) => (g.id === id ? { ...g, running: false } : g))
        }))
      },

      onPriceTick: (symbol, currentPrice) => {
        const now = Date.now()
        const prev = get()
        let spotChanged = false
        let futuresChanged = false
        const newCycles: GridCycleEntry[] = []
        const newAlerts: GridVaultAlert[] = []

        const spotNext = prev.spotGrids.map((g) => {
          if (!g.running) return g
          if (g.config.symbol !== symbol) return g
          const stepped = stepGrid(g, currentPrice, 1, now)
          if (!stepped) return { ...g, lastPrice: currentPrice }
          spotChanged = true
          if (stepped.cycle) newCycles.push(stepped.cycle)
          return stepped.grid
        })

        const futuresNext = prev.futuresGrids.map((g) => {
          if (!g.running) return g
          if (g.config.symbol !== symbol) return g
          const lev = clampInt(g.config.leverage, 1, 100)
          const stepped = stepGrid(g, currentPrice, lev, now)
          const nextGrid = stepped ? (stepped.grid as FuturesGrid) : ({ ...g, lastPrice: currentPrice } as FuturesGrid)
          if (stepped) {
            futuresChanged = true
            if (stepped.cycle) newCycles.push(stepped.cycle)
          }

          const liqInfo = calculateLiquidationPrice(
            (nextGrid.config.upperPrice + nextGrid.config.lowerPrice) / 2,
            nextGrid.config.leverage,
            nextGrid.config.direction
          )
          const liqPrice = nextGrid.config.direction === "SHORT" ? liqInfo.liqPriceShort : liqInfo.liqPriceLong
          const remaining =
            liqPrice > 0
              ? nextGrid.config.direction === "SHORT"
                ? ((liqPrice - currentPrice) / currentPrice) * 100
                : ((currentPrice - liqPrice) / currentPrice) * 100
              : 0
          const remainingPercent = Number.isFinite(remaining) ? remaining : 0
          const warnThreshold = 20
          const cooldownMs = 60 * 60 * 1000
          if (remainingPercent > 0 && remainingPercent <= warnThreshold) {
            const last = nextGrid.lastLiqWarnAt ?? 0
            if (now - last >= cooldownMs) {
              newAlerts.push({
                id: makeId(),
                time: now,
                type: "LIQ_WARNING",
                symbol: nextGrid.config.symbol,
                currentPrice,
                liqPrice,
                remainingPercent
              })
              return { ...nextGrid, lastLiqWarnAt: now }
            }
          }

          return nextGrid
        })

        if (!spotChanged && !futuresChanged) return

        const cycleProfit = newCycles.reduce((sum, c) => sum + c.profit, 0)
        const totalProfit = round2(prev.totalProfit + cycleProfit)
        const totalCycles = prev.totalCycles + newCycles.length
        const vaultValue = round2(prev.totalCapital + totalProfit)

        const nextHistory = [...newCycles, ...prev.history].slice(0, 5000)
        const nextProfitHistory = appendProfitPoint(prev.profitHistory, { time: now, value: vaultValue })
        const dayKey = utcDayKey(now)
        const shouldReport = new Date(now).getUTCHours() === 23 && prev.lastDailyReportDay !== dayKey
        if (shouldReport) {
          const since = utcDayStartMs(now)
          const todays = nextHistory.filter((h) => h.time >= since && h.time <= now)
          const profitToday = todays.reduce((sum, h) => sum + h.profit, 0)
          newAlerts.push({
            id: makeId(),
            time: now,
            type: "DAILY_REPORT",
            dayKeyUtc: dayKey,
            cycles: todays.length,
            profit: round2(profitToday),
            totalProfit,
            capital: prev.totalCapital,
            value: vaultValue
          })
        }

        set({
          spotGrids: spotNext,
          futuresGrids: futuresNext,
          totalProfit,
          totalCycles,
          history: nextHistory,
          profitHistory: nextProfitHistory,
          alerts: [...newAlerts, ...prev.alerts].slice(0, 200),
          lastDailyReportDay: shouldReport ? dayKey : prev.lastDailyReportDay
        })
      },

      consumeAlerts: () => {
        const current = get().alerts
        if (!current.length) return []
        set({ alerts: [] })
        return current
      },

      clearHistory: () => {
        set((s) => ({
          history: [],
          totalCycles: 0,
          totalProfit: 0,
          profitHistory: s.totalCapital > 0 ? [{ time: Date.now(), value: round2(s.totalCapital) }] : []
        }))
      }
    }),
    {
      name: "grid_vault_state",
      version: 1,
      storage: createJSONStorage(() => window.localStorage)
    }
  )
)

export function calculateGridLevels(config: SpotGridConfig, currentPrice: number): GridLevel[] {
  const upper = config.upperPrice
  const lower = config.lowerPrice
  const levels = clampInt(config.gridLevels, 2, 200)
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) return []
  const interval = (upper - lower) / levels
  const amountPerLevel = config.capital / levels
  const out: GridLevel[] = []

  for (let i = 0; i <= levels; i += 1) {
    const price = lower + interval * i
    const p = roundPrice(price)
    const quantity = amountPerLevel / Math.max(0.0000001, p)
    out.push({
      price: p,
      type: p <= currentPrice ? "BUY" : "SELL",
      amount: round2(amountPerLevel),
      quantity,
      status: "PENDING",
      orderId: null,
      filledAt: null,
      profit: 0
    })
  }

  return out
}

export function calculateGridStats(config: SpotGridConfig) {
  const interval = (config.upperPrice - config.lowerPrice) / Math.max(1, config.gridLevels)
  const profitPerGrid = (interval / Math.max(0.0000001, config.upperPrice)) * 100
  const amountPerLevel = config.capital / Math.max(1, config.gridLevels)
  const profitPerCycle = amountPerLevel * (profitPerGrid / 100)

  return {
    interval,
    profitPerGridPercent: Number.isFinite(profitPerGrid) ? profitPerGrid : 0,
    amountPerLevel,
    profitPerCycle,
    dailyProfitConservative: profitPerCycle * 1.5,
    dailyProfitAverage: profitPerCycle * 3.5,
    monthlyConservative: profitPerCycle * 1.5 * 30,
    monthlyAverage: profitPerCycle * 3.5 * 30
  }
}

export function calculateLiquidationPrice(entryPrice: number, leverage: number, direction: FuturesDirection): LiquidationInfo {
  const lev = clampNumber(leverage, 1, 125)
  const liqDistance = 1 / lev
  const liqPriceLong = entryPrice * (1 - liqDistance)
  const liqPriceShort = entryPrice * (1 + liqDistance)
  const distancePercent = liqDistance * 100

  let riskLevel: LiquidationInfo["riskLevel"] = "SAFE"
  let riskColor: LiquidationInfo["riskColor"] = "green"
  if (distancePercent < 15) {
    riskLevel = "DANGER"
    riskColor = "red"
  } else if (distancePercent < 25) {
    riskLevel = "CAUTION"
    riskColor = "yellow"
  }

  const dirMsg = direction === "LONG" ? "drop" : direction === "SHORT" ? "rise" : "move"
  const msg = `BTC must ${dirMsg} ${distancePercent.toFixed(1)}% to liquidate`

  return {
    liqPriceLong,
    liqPriceShort,
    distancePercent,
    riskLevel,
    riskColor,
    message: msg
  }
}

export function calculateFuturesGridStats(config: FuturesGridConfig) {
  const baseStats = calculateGridStats(config)
  const leverage = clampInt(config.leverage, 1, 100)
  const positionSize = config.capital * leverage
  const entry = (config.upperPrice + config.lowerPrice) / 2
  return {
    ...baseStats,
    positionSize,
    leverage,
    profitPerCycle: baseStats.profitPerCycle * leverage,
    monthlyConservative: baseStats.monthlyConservative * leverage,
    monthlyAverage: baseStats.monthlyAverage * leverage,
    liquidationInfo: calculateLiquidationPrice(entry, leverage, config.direction)
  }
}

export function getLeverageComparison(baseStats: ReturnType<typeof calculateGridStats>, capital: number) {
  return [1, 3, 5, 10].map((lev) => ({
    leverage: `${lev}x`,
    position: `$${round2(capital * lev).toLocaleString()}`,
    perCycle: `$${round2(baseStats.profitPerCycle * lev).toFixed(4)}`,
    monthly: `$${round2(baseStats.monthlyAverage * lev).toFixed(2)}`,
    liqDistance: `${Math.round(100 / lev)}%`,
    risk: lev <= 3 ? "LOW" : lev <= 5 ? "MEDIUM" : "HIGH"
  }))
}

function stepGrid(
  grid: SpotGrid | FuturesGrid,
  currentPrice: number,
  profitMultiplier: number,
  now: number
): { grid: SpotGrid | FuturesGrid; cycle?: GridCycleEntry } | null {
  const levels = grid.levels
  if (!levels.length) return null

  const nextBuy = [...levels]
    .filter((l) => l.type === "BUY" && l.status === "PENDING" && currentPrice <= l.price)
    .sort((a, b) => b.price - a.price)[0]

  if (nextBuy) {
    const idx = levels.findIndex((l) => l.price === nextBuy.price)
    if (idx >= 0) {
      const filled = { ...levels[idx], status: "FILLED" as const, filledAt: now }
      const nextLevels = [...levels]
      nextLevels[idx] = filled

      const nextSellIdx = nextLevels.findIndex((l) => l.price > filled.price)
      if (nextSellIdx >= 0) {
        const sell = nextLevels[nextSellIdx]
        nextLevels[nextSellIdx] = { ...sell, type: "SELL", status: "ACTIVE", orderId: null }
      }

      return { grid: { ...grid, levels: nextLevels, lastPrice: currentPrice } }
    }
  }

  const nextSell = [...levels]
    .filter((l) => l.type === "SELL" && l.status === "ACTIVE" && currentPrice >= l.price)
    .sort((a, b) => a.price - b.price)[0]

  if (!nextSell) return null

  const sellIdx = levels.findIndex((l) => l.price === nextSell.price)
  if (sellIdx < 0) return null

  const buyCandidate = [...levels]
    .filter((l) => l.type === "BUY" && l.status === "FILLED" && l.price < nextSell.price)
    .sort((a, b) => b.price - a.price)[0]

  const qty = buyCandidate?.quantity ?? 0
  const buyPrice = buyCandidate?.price ?? nextSell.price
  const gross = (nextSell.price - buyPrice) * qty
  const profit = round2(gross * profitMultiplier)
  const buyIdx = buyCandidate ? levels.findIndex((l) => l.price === buyCandidate.price) : -1

  const nextLevels = [...levels]
  nextLevels[sellIdx] = { ...levels[sellIdx], filledAt: now, profit, status: "PENDING" }
  if (buyIdx >= 0) nextLevels[buyIdx] = { ...levels[buyIdx], status: "PENDING" }

  const nextGrid = {
    ...grid,
    levels: nextLevels,
    lastPrice: currentPrice,
    cycles: grid.cycles + 1,
    totalProfit: round2(grid.totalProfit + profit)
  }

  const type: GridCycleEntry["type"] =
    "config" in nextGrid && "leverage" in (nextGrid as any).config
      ? ((nextGrid as FuturesGrid).config.leverage === 3
          ? "FUT3x"
          : (nextGrid as FuturesGrid).config.leverage === 5
            ? "FUT5x"
            : (nextGrid as FuturesGrid).config.leverage === 10
              ? "FUT10x"
              : "FUT3x")
      : "SPOT"

  const prevVaultProfit = useGridVaultStore.getState().totalProfit
  const cycle: GridCycleEntry = {
    id: makeId(),
    time: now,
    type,
    symbol: nextGrid.config.symbol,
    buyPrice,
    sellPrice: nextSell.price,
    profit,
    cumulative: round2(prevVaultProfit + profit)
  }

  return { grid: nextGrid, cycle }
}

function appendProfitPoint(prev: ProfitEntry[], next: ProfitEntry): ProfitEntry[] {
  if (!prev.length) return [next]
  const last = prev[prev.length - 1]
  if (Math.abs(next.value - last.value) < 0.000001) return prev
  const minGapMs = 60_000
  if (next.time - last.time < minGapMs) {
    const copy = [...prev]
    copy[copy.length - 1] = next
    return copy
  }
  return [...prev, next].slice(-2000)
}

function cleanSpotConfig(config: SpotGridConfig): SpotGridConfig | null {
  const upper = clampNumber(config.upperPrice, 0.01, 100_000_000)
  const lower = clampNumber(config.lowerPrice, 0.01, 100_000_000)
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) return null
  const cap = clampNumber(config.capital, 1, 1_000_000_000)
  return {
    symbol: String(config.symbol || "BTC-USDT"),
    capital: cap,
    upperPrice: upper,
    lowerPrice: lower,
    gridLevels: clampInt(config.gridLevels, 2, 200),
    mode: config.mode === "live" ? "live" : "paper"
  }
}

function cleanFuturesConfig(config: FuturesGridConfig): FuturesGridConfig | null {
  const base = cleanSpotConfig(config)
  if (!base) return null
  const lev = clampInt(config.leverage, 1, 100)
  const direction = config.direction === "LONG" || config.direction === "SHORT" ? config.direction : "NEUTRAL"
  return { ...base, leverage: lev, direction }
}

function roundPrice(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n >= 1000) return Math.round(n)
  if (n >= 100) return Math.round(n * 10) / 10
  if (n >= 1) return Math.round(n * 100) / 100
  return Math.round(n * 1_000_000) / 1_000_000
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function makeId(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `gv_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function utcDayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function utcDayStartMs(ts: number): number {
  const d = new Date(ts)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  return start
}
