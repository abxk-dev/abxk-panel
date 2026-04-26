export type PriceAlert = {
  id: string
  type: "PRICE"
  symbol: string
  condition: "ABOVE" | "BELOW" | "CROSSES"
  price: number
  message: string
  recurring: boolean
  createdAt: number
  lastTriggeredAt?: number
}

export type IndicatorAlert = {
  id: string
  type: "INDICATOR"
  symbol: string
  indicator: "RSI" | "EMA_CROSS" | "MACD" | "VOLUME"
  condition: string
  value: number
  timeframe: string
  createdAt: number
  lastTriggeredAt?: number
}

export type PatternAlert = {
  id: string
  type: "PATTERN"
  symbol: string
  pattern: string
  timeframe: string
  minReliability: number
  createdAt: number
  lastTriggeredAt?: number
}

export type PnLAlert = {
  id: string
  type: "PNL"
  scope: "DAILY_PROFIT" | "DAILY_LOSS" | "TOTAL_RETURN"
  targetAmount: number
  direction: "ABOVE" | "BELOW"
  createdAt: number
  lastTriggeredAt?: number
}

export type SmartAlert = PriceAlert | IndicatorAlert | PatternAlert | PnLAlert

export type AlertTrigger = {
  alertId: string
  triggeredAt: number
  title: string
  message: string
  symbol?: string
  currentPrice?: number
}

export function evaluatePriceAlert(opts: {
  alert: PriceAlert
  currentPrice: number
  prevPrice?: number
  now?: number
}): AlertTrigger | null {
  const now = typeof opts.now === "number" ? opts.now : Date.now()
  const a = opts.alert
  const cur = Number(opts.currentPrice)
  const prev = opts.prevPrice !== undefined ? Number(opts.prevPrice) : undefined
  if (!Number.isFinite(cur)) return null

  const target = Number(a.price)
  if (!Number.isFinite(target) || target <= 0) return null

  const cond = a.condition
  const crossed = prev !== undefined && Number.isFinite(prev) ? (prev < target && cur >= target) || (prev > target && cur <= target) : false
  const ok =
    cond === "ABOVE" ? cur > target : cond === "BELOW" ? cur < target : cond === "CROSSES" ? crossed : false
  if (!ok) return null

  if (a.lastTriggeredAt && a.recurring) {
    if (now - a.lastTriggeredAt < 60_000) return null
  }

  const title = "🔔 PRICE ALERT TRIGGERED"
  const message = `${a.symbol} ${cond === "ABOVE" ? "above" : cond === "BELOW" ? "below" : "crossed"} $${target.toFixed(2)}
Current: $${cur.toFixed(2)}
${a.message ? `Note: ${a.message}` : ""}`.trim()

  return { alertId: a.id, triggeredAt: now, title, message, symbol: a.symbol, currentPrice: cur }
}

export function applyPriceTrigger(alert: PriceAlert, trigger: AlertTrigger): PriceAlert {
  return { ...alert, lastTriggeredAt: trigger.triggeredAt }
}

