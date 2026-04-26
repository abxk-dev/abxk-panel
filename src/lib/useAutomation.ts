"use client"

import { useEffect } from "react"
import { useBotStore } from "@/store/botStore"

export function useAutomation() {
  const timeframe = useBotStore((s) => s.settings.timeframe)
  const lastClose = useBotStore((s) => s.lastAutomationCandleClose)
  const runBotCycle = useBotStore((s) => s.runBotCycle)

  useEffect(() => {
    const intervalMs =
      timeframe === "15m"
        ? 15 * 60 * 1000
        : timeframe === "1h"
          ? 60 * 60 * 1000
          : timeframe === "4h"
            ? 4 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000

    const dayAnchorUtcHour = 9

    const getSlotStart = (now: number) => {
      if (timeframe !== "1d") return Math.floor(now / intervalMs) * intervalMs
      const d = new Date(now)
      const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
      const anchor = utcMidnight + dayAnchorUtcHour * 60 * 60 * 1000
      if (now >= anchor) return anchor
      return anchor - 24 * 60 * 60 * 1000
    }

    const tick = () => {
      const now = Date.now()
      const candleClose = getSlotStart(now)
      if (lastClose === undefined || candleClose > lastClose) {
        void runBotCycle()
      }
    }

    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [timeframe, lastClose, runBotCycle])
}
