import type { ExecutionMode } from "@/types/bot"
import { SCALP_COINS } from "@/lib/scalpEngine"

export const GRID_COINS = SCALP_COINS

export type GridType = "ARITHMETIC" | "GEOMETRIC"

export type GridConfig = {
  symbol: string
  upperPrice: number
  lowerPrice: number
  gridLevels: number
  amountPerGridUsd: number
  mode: ExecutionMode
  type: GridType
}

export type GridSide = "BUY" | "SELL"

export type GridLevel = {
  index: number
  price: number
  buyOrderId: string | null
  sellOrderId: string | null
  buyActive: boolean
  sellActive: boolean
  lastFillSide?: GridSide
  lastFillAt?: number
  profitUsd: number
}

export type GridCycle = {
  id: string
  symbol: string
  fromSide: GridSide
  entryPrice: number
  exitPrice: number
  quantity: number
  profitUsd: number
  createdAt: number
}

export type GridState = {
  config: GridConfig
  startedAt: number
  levels: GridLevel[]
  openLong: Record<number, { buyPrice: number; quantity: number }>
  openShort: Record<number, { sellPrice: number; quantity: number }>
  cycles: GridCycle[]
  cyclesCompleted: number
  totalProfitUsd: number
  lastPrice?: number
  lastTickAt?: number
}

export function createGridLevels(config: GridConfig): GridLevel[] {
  const levels = clampInt(config.gridLevels, 1, 500)
  const upper = config.upperPrice
  const lower = config.lowerPrice
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) return []

  const out: GridLevel[] = []
  if (config.type === "GEOMETRIC") {
    const ratio = Math.pow(upper / lower, 1 / levels)
    for (let i = 0; i <= levels; i++) {
      const price = lower * Math.pow(ratio, i)
      out.push(makeLevel(i, price))
    }
  } else {
    const interval = (upper - lower) / levels
    for (let i = 0; i <= levels; i++) {
      const price = lower + interval * i
      out.push(makeLevel(i, price))
    }
  }

  return out.filter((l) => Number.isFinite(l.price) && l.price > 0)
}

export function gridInterval(config: GridConfig): number {
  const upper = config.upperPrice
  const lower = config.lowerPrice
  const levels = clampInt(config.gridLevels, 1, 500)
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) return 0
  if (config.type === "GEOMETRIC") {
    const ratio = Math.pow(upper / lower, 1 / levels)
    const mid = Math.sqrt(upper * lower)
    return mid * (ratio - 1)
  }
  return (upper - lower) / levels
}

export function estimatedProfitPerGridPct(config: GridConfig, referencePrice?: number): number {
  const interval = gridInterval(config)
  const ref = Number.isFinite(referencePrice as number) && (referencePrice as number) > 0 ? (referencePrice as number) : midPrice(config)
  if (!ref || ref <= 0 || !Number.isFinite(interval) || interval <= 0) return 0
  return (interval / ref) * 100
}

export function totalCapitalUsd(config: GridConfig): number {
  const levels = clampInt(config.gridLevels, 1, 500)
  const grids = levels + 1
  const amount = config.amountPerGridUsd
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return grids * amount
}

export function initializeGridState(config: GridConfig, currentPrice: number): GridState {
  const levels = createGridLevels(config)
  const normalizedPrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : midPrice(config)
  for (const l of levels) {
    if (l.price < normalizedPrice) {
      l.buyActive = true
      l.buyOrderId = `B-${config.symbol}-${l.index}-${Date.now()}`
    } else if (l.price > normalizedPrice) {
      l.sellActive = true
      l.sellOrderId = `S-${config.symbol}-${l.index}-${Date.now()}`
    }
  }

  return {
    config,
    startedAt: Date.now(),
    levels,
    openLong: {},
    openShort: {},
    cycles: [],
    cyclesCompleted: 0,
    totalProfitUsd: 0,
    lastPrice: normalizedPrice,
    lastTickAt: Date.now()
  }
}

export function stepGrid(state: GridState, currentPrice: number): GridState {
  const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : state.lastPrice ?? 0
  if (!price) return { ...state, lastTickAt: Date.now() }

  const amountUsd = clampNumber(state.config.amountPerGridUsd, 0.01, 1_000_000)
  const openLong = { ...state.openLong }
  const openShort = { ...state.openShort }
  const levels = state.levels.map((l) => ({ ...l }))
  const cycles = [...state.cycles]
  let cyclesCompleted = state.cyclesCompleted
  let totalProfitUsd = state.totalProfitUsd

  for (const level of levels) {
    if (level.buyActive && price <= level.price) {
      level.buyActive = false
      level.buyOrderId = null
      level.lastFillSide = "BUY"
      level.lastFillAt = Date.now()

      const qty = amountUsd / level.price
      const sellIndex = level.index + 1
      if (sellIndex <= levels.length - 1) {
        openLong[sellIndex] = { buyPrice: level.price, quantity: qty }
        const sellLevel = levels[sellIndex]
        if (sellLevel) {
          sellLevel.sellActive = true
          sellLevel.sellOrderId = `S-${state.config.symbol}-${sellLevel.index}-${Date.now()}`
        }
      }
    }

    if (level.sellActive && price >= level.price) {
      level.sellActive = false
      level.sellOrderId = null
      level.lastFillSide = "SELL"
      level.lastFillAt = Date.now()

      const maybeLong = openLong[level.index]
      if (maybeLong) {
        delete openLong[level.index]
        const profit = maybeLong.quantity * (level.price - maybeLong.buyPrice)
        const p = Number.isFinite(profit) ? profit : 0
        level.profitUsd = round2(level.profitUsd + p)
        totalProfitUsd = round2(totalProfitUsd + p)
        cyclesCompleted += 1
        cycles.unshift({
          id: `C-${state.config.symbol}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          symbol: state.config.symbol,
          fromSide: "BUY",
          entryPrice: maybeLong.buyPrice,
          exitPrice: level.price,
          quantity: maybeLong.quantity,
          profitUsd: round2(p),
          createdAt: Date.now()
        })
      } else {
        const qty = amountUsd / level.price
        const buyIndex = level.index - 1
        if (buyIndex >= 0) {
          openShort[buyIndex] = { sellPrice: level.price, quantity: qty }
          const buyLevel = levels[buyIndex]
          if (buyLevel) {
            buyLevel.buyActive = true
            buyLevel.buyOrderId = `B-${state.config.symbol}-${buyLevel.index}-${Date.now()}`
          }
        }
      }
    }
  }

  for (const level of levels) {
    if (level.buyActive) continue
    if (level.sellActive) continue
    if (openShort[level.index] && price <= level.price) {
      const short = openShort[level.index]
      if (!short) continue
      delete openShort[level.index]
      level.lastFillSide = "BUY"
      level.lastFillAt = Date.now()
      const profit = short.quantity * (short.sellPrice - level.price)
      const p = Number.isFinite(profit) ? profit : 0
      level.profitUsd = round2(level.profitUsd + p)
      totalProfitUsd = round2(totalProfitUsd + p)
      cyclesCompleted += 1
      cycles.unshift({
        id: `C-${state.config.symbol}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        symbol: state.config.symbol,
        fromSide: "SELL",
        entryPrice: short.sellPrice,
        exitPrice: level.price,
        quantity: short.quantity,
        profitUsd: round2(p),
        createdAt: Date.now()
      })

      const sellIndex = level.index + 1
      if (sellIndex <= levels.length - 1) {
        const sellLevel = levels[sellIndex]
        if (sellLevel) {
          sellLevel.sellActive = true
          sellLevel.sellOrderId = `S-${state.config.symbol}-${sellLevel.index}-${Date.now()}`
        }
      }
    }
  }

  return {
    ...state,
    levels,
    openLong,
    openShort,
    cycles: cycles.slice(0, 100),
    cyclesCompleted,
    totalProfitUsd,
    lastPrice: price,
    lastTickAt: Date.now()
  }
}

function makeLevel(index: number, price: number): GridLevel {
  return {
    index,
    price,
    buyOrderId: null,
    sellOrderId: null,
    buyActive: false,
    sellActive: false,
    profitUsd: 0
  }
}

function midPrice(config: GridConfig): number {
  const upper = config.upperPrice
  const lower = config.lowerPrice
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= 0 || lower <= 0) return 0
  return (upper + lower) / 2
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

function round2(n: number) {
  return Math.round(n * 100) / 100
}

