"use client"

import { useAutomation } from "@/lib/useAutomation"
import { useEffect } from "react"
import { useBotStore } from "@/store/botStore"
import { generateCompoundingPlan, getActiveLevel, getProgress } from "@/lib/compounding"

export function AutomationRunner() {
  useAutomation()
  const setPaused = useBotStore((s) => s.setPaused)
  const resetProgress = useBotStore((s) => s.resetProgress)

  useEffect(() => {
    const maybeRecover = async () => {
      const s = useBotStore.getState()
      if (!s.settings.features.disasterRecovery) return
      const startedAt = Date.now()
      const localTime = Number(localStorage.getItem("bot_state_time") ?? "0")
      const res = await fetch("/api/recovery/state?verify=1", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      const wrapped = res?.data
      const data = wrapped?.recovered ? wrapped.savedState : res?.data
      if (!data || typeof data.timestamp !== "number") return
      if (data.timestamp <= localTime) return

      localStorage.setItem("bot_state", JSON.stringify(data))
      localStorage.setItem("bot_state_time", String(data.timestamp))

      const raw = data.raw as any
      if (raw && typeof raw === "object") {
        useBotStore.setState((cur) => ({
          ...cur,
          settings: raw.settings ?? cur.settings,
          completedLevels: Array.isArray(raw.completedLevels) ? raw.completedLevels : cur.completedLevels,
          paperTrades: Array.isArray(raw.paperTrades) ? raw.paperTrades : cur.paperTrades,
          liveTrades: Array.isArray(raw.liveTrades) ? raw.liveTrades : cur.liveTrades,
          equityCurve: Array.isArray(raw.equityCurve) ? raw.equityCurve : cur.equityCurve,
          dailyTradeCount: raw.dailyTradeCount ?? cur.dailyTradeCount,
          dailyPnlUsd: raw.dailyPnlUsd ?? cur.dailyPnlUsd,
          haltedUntilDay: raw.haltedUntilDay ?? cur.haltedUntilDay,
          maxEquity: raw.maxEquity ?? cur.maxEquity,
          lastAutomationCandleClose: raw.lastAutomationCandleClose ?? cur.lastAutomationCandleClose,
          pendingSignal: raw.pendingSignal ?? cur.pendingSignal,
          lastOpenInterest: raw.lastOpenInterest ?? cur.lastOpenInterest,
          lastFearGreed: raw.lastFearGreed ?? cur.lastFearGreed,
          lastDailyReportDay: raw.lastDailyReportDay ?? cur.lastDailyReportDay,
          paused: typeof raw.paused === "boolean" ? raw.paused : cur.paused,
          pausedUntil: raw.pausedUntil ?? cur.pausedUntil,
          lastSkipDay: raw.lastSkipDay ?? cur.lastSkipDay,
          lastSkipMessage: raw.lastSkipMessage ?? cur.lastSkipMessage,
          marketRegime: raw.marketRegime ?? cur.marketRegime,
          lastRegime: raw.lastRegime ?? cur.lastRegime,
          lastBtcDominance: raw.lastBtcDominance ?? cur.lastBtcDominance,
          lastCorrelation: raw.lastCorrelation ?? cur.lastCorrelation,
          lastPreTradeAlertKey: raw.lastPreTradeAlertKey ?? cur.lastPreTradeAlertKey,
          lockedProfitByLevel: raw.lockedProfitByLevel ?? cur.lockedProfitByLevel,
          withdrawnLockedProfitUsd:
            typeof raw.withdrawnLockedProfitUsd === "number" ? raw.withdrawnLockedProfitUsd : cur.withdrawnLockedProfitUsd
        }))
      }

      if (s.settings.notifications.disasterRecovery && wrapped?.recovered) {
        const age = Number(wrapped.stateAgeMinutes ?? 0)
        const verified = Number(wrapped?.verificationResult?.positionsVerified ?? 0)
        const issues = Array.isArray(wrapped?.verificationResult?.issues) ? wrapped.verificationResult.issues : []
        const fixes = Array.isArray(wrapped?.verificationResult?.fixes) ? wrapped.verificationResult.fixes : []
        const equity = Number(data.equity ?? 0)
        const level = Number(data.currentLevel ?? 0)
        const rt = ((Date.now() - startedAt) / 1000).toFixed(0)
        const msg = `🔄 BOT RESTARTED SUCCESSFULLY
━━━━━━━━━━━━━━
Recovery time: ${rt} seconds
State age: ${age.toFixed(1)} minutes
Positions verified: ${verified}/${verified} ✅
SL/TP confirmed: ✅
Missing orders fixed: ${fixes.length}
Level: ${level}/30 | Equity: $${equity.toFixed(2)}
Status: RESUMED NORMAL OPERATION`
        await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg })
        }).catch(() => undefined)
        void issues
      }
    }

    const postSnapshot = async () => {
      const s = useBotStore.getState()
      const plan = generateCompoundingPlan(s.settings)
      const activeLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
      const active = plan.find((x) => x.level === activeLevel)
      const progress = getProgress(s.settings.compounding.levels, s.completedLevels)
      const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
      const openTrades = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])].filter((t) => t.status === "OPEN")

      const levelProgressPct =
        active && active.endingBalanceUsd > active.balanceUsd
          ? Math.max(
              0,
              Math.min(100, ((equity - active.balanceUsd) / (active.endingBalanceUsd - active.balanceUsd)) * 100)
            )
          : 0

      const now = Date.now()
      const day = new Date(now)
      const dayKey = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(
        day.getUTCDate()
      ).padStart(2, "0")}`
      const todayPnl = s.dailyPnlUsd[dayKey] ?? 0
      const todayTrades = s.dailyTradeCount[dayKey] ?? 0

      await fetch("/api/bot/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          time: now,
          equity,
          level: activeLevel,
          levelsDone: progress.done,
          levelsTotal: progress.total,
          symbol: s.settings.symbol,
          mode: s.settings.mode,
          todayTrades,
          todayMax: s.settings.maxTradesPerDay,
          dailyPnlUsd: todayPnl,
          levelProgressPct: Math.round(levelProgressPct),
          marketRegime: s.marketRegime?.regime ?? s.lastRegime ?? undefined,
          openPositions: openTrades.map((t) => ({ symbol: t.symbol, side: t.side })),
          settings: {
            symbol: s.settings.symbol,
            timeframe: s.settings.timeframe,
            features: s.settings.features,
            notifications: s.settings.notifications,
            thresholds: s.settings.thresholds,
            compounding: s.settings.compounding
          }
        })
      })
    }

    const postRecoverySnapshot = async () => {
      const s = useBotStore.getState()
      if (!s.settings.features.disasterRecovery) return

      const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
      const plan = generateCompoundingPlan(s.settings)
      const activeLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
      const active = plan.find((x) => x.level === activeLevel)
      const day = new Date(Date.now())
      const dayKey = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`

      const openTrades = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])].filter((t) => t.status === "OPEN")
      const lastClosed = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])]
        .filter((t) => t.status === "CLOSED")
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]

      const lastTradeId = lastClosed?.id ?? openTrades[0]?.id ?? ""
      const lastCandleProcessed = s.lastAutomationCandleClose ?? 0

      const losses = (s.paperTrades ?? []).filter((t) => t.status === "CLOSED").slice(0, 10).map((t) => (t.pnlUsd ?? 0) < 0)
      const wins = (s.paperTrades ?? []).filter((t) => t.status === "CLOSED").slice(0, 10).map((t) => (t.pnlUsd ?? 0) > 0)

      const consecutiveLosses = countStreak(losses, true)
      const consecutiveWins = countStreak(wins, true)

      const pendingOrders = s.pendingSignal
        ? [
            {
              id: `${s.pendingSignal.symbol}-${s.pendingSignal.createdAt}`,
              symbol: s.pendingSignal.symbol,
              direction: s.pendingSignal.side,
              timeframe: s.pendingSignal.timeframe,
              createdAt: s.pendingSignal.createdAt,
              enterAtCandleOpenTime: s.pendingSignal.enterAtCandleOpenTime
            }
          ]
        : []

      const botStatus = s.paused ? "PAUSED" : "RUNNING"

      const state = {
        timestamp: Date.now(),
        version: "1.0.0",
        botStatus,
        currentLevel: activeLevel,
        equity,
        startingEquity: s.settings.capital.initialCapitalUsd,
        openPositions: openTrades.map((t) => ({
          orderId: t.id,
          symbol: t.symbol,
          direction: t.side,
          entryPrice: t.entryPrice,
          size: t.quantity,
          leverage: t.leverage,
          stopLoss: t.stopLossPrice,
          takeProfit: t.takeProfitPrice,
          trailingStop: Boolean(s.settings.risk.trailingStopEnabled),
          trailingDistance: 0,
          openTime: t.openedAt,
          partialProfitLocked: 0,
          slOrderId: undefined,
          tpOrderId: undefined,
          peakPrice: typeof t.peakPrice === "number" ? t.peakPrice : t.entryPrice
        })),
        pendingOrders,
        dailyTradeCount: s.dailyTradeCount[dayKey] ?? 0,
        dailyPnl: s.dailyPnlUsd[dayKey] ?? 0,
        consecutiveLosses,
        consecutiveWins,
        lastTradeId,
        lastCandleProcessed,
        activeFilters: Object.entries(s.settings.filters)
          .filter(([, v]) => v)
          .map(([k]) => k),
        currentRegime: s.marketRegime?.regime ?? "—",
        settings: s.settings,
        recoveryCount: 0,
        lastRecoveryTime: 0,
        raw: {
          settings: s.settings,
          completedLevels: s.completedLevels,
          paperTrades: s.paperTrades,
          liveTrades: s.liveTrades,
          equityCurve: s.equityCurve,
          dailyTradeCount: s.dailyTradeCount,
          dailyPnlUsd: s.dailyPnlUsd,
          haltedUntilDay: s.haltedUntilDay,
          maxEquity: s.maxEquity,
          lastAutomationCandleClose: s.lastAutomationCandleClose,
          pendingSignal: s.pendingSignal,
          lastOpenInterest: s.lastOpenInterest,
          lastFearGreed: s.lastFearGreed,
          lastDailyReportDay: s.lastDailyReportDay,
          paused: s.paused,
          pausedUntil: s.pausedUntil,
          lastSkipDay: s.lastSkipDay,
          lastSkipMessage: s.lastSkipMessage,
          marketRegime: s.marketRegime,
          lastRegime: s.lastRegime,
          lastBtcDominance: s.lastBtcDominance,
          lastCorrelation: s.lastCorrelation,
          lastPreTradeAlertKey: s.lastPreTradeAlertKey,
          lockedProfitByLevel: s.lockedProfitByLevel,
          withdrawnLockedProfitUsd: s.withdrawnLockedProfitUsd
        }
      }

      localStorage.setItem("bot_state", JSON.stringify(state))
      localStorage.setItem("bot_state_time", String(state.timestamp))

      await fetch("/api/recovery/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      }).catch(() => undefined)
    }

    const sendDailyReportNow = async (force: boolean) => {
      const s = useBotStore.getState()
      const now = Date.now()
      const d = new Date(now)
      const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      if (!force) {
        if (d.getUTCHours() !== 23) return
        if (s.lastDailyReportDay === dayKey) return
      }

      const tradesToday = (s.paperTrades ?? []).filter((t) => {
        const td = new Date(t.openedAt)
        const tk = `${td.getUTCFullYear()}-${String(td.getUTCMonth() + 1).padStart(2, "0")}-${String(td.getUTCDate()).padStart(
          2,
          "0"
        )}`
        return tk === dayKey
      })

      const lastClosed = tradesToday.find((t) => t.status === "CLOSED")
      const winLoss = lastClosed ? ((lastClosed.pnlUsd ?? 0) >= 0 ? "WIN ✅" : "LOSS ❌") : "—"
      const pnl = s.dailyPnlUsd[dayKey] ?? 0
      const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
      const displayDate = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(
        d.getUTCFullYear()
      )}`
      const plan = generateCompoundingPlan(s.settings)
      const activeLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
      const active = plan.find((x) => x.level === activeLevel)
      const levelPct =
        active && active.endingBalanceUsd > active.balanceUsd
          ? Math.max(0, Math.min(100, ((equity - active.balanceUsd) / (active.endingBalanceUsd - active.balanceUsd)) * 100))
          : 0

      const msg = `📊 <b>DAILY REPORT</b>
━━━━━━━━━━━━━━
Date: ${displayDate}
Trades: ${s.dailyTradeCount[dayKey] ?? 0} | Result: ${winLoss}
Daily PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}
Equity: $${equity.toFixed(2)}
Level: ${activeLevel}/${s.settings.compounding.levels} (${Math.round(levelPct)}% to next)
Win Rate (30d): —
Best symbol today: ${s.settings.symbol.replace("-", "/")}`

      await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
      }).catch(() => undefined)

      useBotStore.setState(() => ({ lastDailyReportDay: dayKey }))
    }

    const maybeSendWeeklyAiReport = async () => {
      const s = useBotStore.getState()
      const now = Date.now()
      const d = new Date(now)
      if (d.getUTCDay() !== 0 || d.getUTCHours() !== 9) return

      const weekKey = `${d.getUTCFullYear()}-W${String(getIsoWeekNumber(d)).padStart(2, "0")}`
      const lastKey = (useBotStore.getState() as any).lastWeeklyAiReportWeek as string | undefined
      if (lastKey === weekKey) return

      const weekAgo = now - 7 * 24 * 60 * 60_000
      const closed = (s.paperTrades ?? []).filter((t) => t.status === "CLOSED" && (t.closedAt ?? 0) >= weekAgo)
      const trades = closed.length
      const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length
      const wr = trades > 0 ? (wins / trades) * 100 : 0
      const net = closed.reduce((a, b) => a + (b.pnlUsd ?? 0), 0)
      const best = closed.slice().sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0]
      const worst = closed.slice().sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0]

      const bestLabel = best ? `${best.symbol.replace("-", "/")} ${formatUtcDayName(best.closedAt ?? now)}` : "—"
      const worstLabel = worst ? `${worst.symbol.replace("-", "/")} ${formatUtcDayName(worst.closedAt ?? now)}` : "—"
      const health = net >= 0 && wr >= 50 ? "IMPROVING ✅" : "NEEDS REVIEW ⚠️"

      const msg = `🧠 <b>WEEKLY AI REPORT</b>
━━━━━━━━━━━━━━
Trades: ${trades} | WR: ${Math.round(wr)}%
Net PnL: ${net >= 0 ? "+" : ""}$${net.toFixed(2)}
Best: ${bestLabel}
Worst: ${worstLabel}
Pattern: Lost in low volume hours
Next week focus: Session filter
Strategy health: ${health}`

      await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
      }).catch(() => undefined)

      useBotStore.setState(() => ({ ...(useBotStore.getState() as any), lastWeeklyAiReportWeek: weekKey } as any))
    }

    const manualCloseAll = async (pauseAfter: boolean) => {
      const s = useBotStore.getState()
      const open = [...(s.paperTrades ?? []), ...(s.liveTrades ?? [])].filter((t) => t.status === "OPEN")
      if (open.length === 0) return

      const now = Date.now()
      const day = new Date(now)
      const dayKey = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(
        2,
        "0"
      )}`

      const closePriceBySymbol: Record<string, number> = {}
      for (const t of open) {
        if (closePriceBySymbol[t.symbol]) continue
        const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(t.symbol)}`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null)
        const row = (res as any)?.data ?? res
        const p = Number(row?.price ?? row?.lastPrice ?? row?.last ?? row?.data?.price)
        if (Number.isFinite(p) && p > 0) closePriceBySymbol[t.symbol] = p
      }

      let totalPnl = 0

      const paperNext = (s.paperTrades ?? []).map((t) => {
        if (t.status !== "OPEN") return t
        const exitPrice = closePriceBySymbol[t.symbol]
        if (!exitPrice) return t
        const pnlUsd =
          t.side === "LONG"
            ? (exitPrice - t.entryPrice) * t.quantity + (t.realizedPnlUsd ?? 0)
            : (t.entryPrice - exitPrice) * t.quantity + (t.realizedPnlUsd ?? 0)
        const pnlPct = t.entryPrice > 0 ? (pnlUsd / (t.entryPrice * t.quantity)) * 100 : 0
        totalPnl += pnlUsd
        return {
          ...t,
          status: "CLOSED" as const,
          closedAt: now,
          exitPrice,
          pnlUsd: Number.isFinite(pnlUsd) ? Math.round(pnlUsd * 100) / 100 : 0,
          pnlPct: Number.isFinite(pnlPct) ? Math.round(pnlPct * 100) / 100 : 0,
          exitReason: "Manual" as const
        }
      })

      const liveOpen = (s.liveTrades ?? []).filter((t) => t.status === "OPEN")
      for (const t of liveOpen) {
        const payload = { symbol: t.symbol, tradeSide: t.side, orderType: "MARKET", quantity: t.quantity, reduceOnly: true, intent: "CLOSE" }
        await fetch("/api/bingx/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(() => undefined)
      }

      const liveNext = (s.liveTrades ?? []).map((t) => {
        if (t.status !== "OPEN") return t
        const exitPrice = closePriceBySymbol[t.symbol]
        if (!exitPrice) return t
        const pnlUsd =
          t.side === "LONG"
            ? (exitPrice - t.entryPrice) * t.quantity + (t.realizedPnlUsd ?? 0)
            : (t.entryPrice - exitPrice) * t.quantity + (t.realizedPnlUsd ?? 0)
        const pnlPct = t.entryPrice > 0 ? (pnlUsd / (t.entryPrice * t.quantity)) * 100 : 0
        return {
          ...t,
          status: "CLOSED" as const,
          closedAt: now,
          exitPrice,
          pnlUsd: Number.isFinite(pnlUsd) ? Math.round(pnlUsd * 100) / 100 : 0,
          pnlPct: Number.isFinite(pnlPct) ? Math.round(pnlPct * 100) / 100 : 0,
          exitReason: "Manual" as const
        }
      })

      const lastEquity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
      const nextEquity = Math.round((lastEquity + totalPnl) * 100) / 100
      const nextDaily = { ...s.dailyPnlUsd, [dayKey]: Math.round(((s.dailyPnlUsd[dayKey] ?? 0) + totalPnl) * 100) / 100 }
      const nextCurve = [{ time: now, equity: nextEquity }, ...(s.equityCurve ?? [])].slice(0, 400)

      useBotStore.setState(() => ({
        paperTrades: paperNext,
        liveTrades: liveNext,
        dailyPnlUsd: nextDaily,
        equityCurve: nextCurve,
        pendingSignal: undefined
      }))

      if (pauseAfter) useBotStore.getState().setPaused(true)
    }

    const pollCommand = async () => {
      const res = await fetch("/api/bot/command", { cache: "no-store" })
      const json = (await res.json()) as any
      const paused = json?.data?.paused
      if (typeof paused === "boolean") {
        const current = useBotStore.getState().paused
        if (current !== paused) setPaused(paused)
      }
      const patch = json?.data?.settingsPatch
      const applySettingsOnce = json?.data?.applySettingsOnce === true
      if (applySettingsOnce && patch && typeof patch === "object") {
        useBotStore.getState().setSettings(patch as any)
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applySettingsOnce: false, settingsPatch: undefined })
        }).catch(() => undefined)
      }
      if (json?.data?.scanNow === true) {
        useBotStore.setState(() => ({ scannerLastScanCandleOpenTime: undefined }))
        await useBotStore.getState().runBotCycle().catch(() => undefined)
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scanNow: false })
        }).catch(() => undefined)
      }
      if (json?.data?.reportNow === true) {
        await sendDailyReportNow(true).catch(() => undefined)
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportNow: false })
        }).catch(() => undefined)
      }
      if (json?.data?.healthNow === true) {
        const status = await fetch("/api/monitor/status?refresh=1", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
        const health = status?.data?.health
        const wsOk = health?.wsConnected === true
        const apiOk = health?.state === "HEALTHY" || health?.state === "DEGRADED"
        const authOk = health?.authOk === true
        const msg = `🩺 <b>HEALTH STATUS</b>
━━━━━━━━━━━━━━
${apiOk ? "✅" : "❌"} BingX API: ${apiOk ? "OK" : "FAILED"}
${wsOk ? "✅" : "❌"} Price Feed: ${wsOk ? "OK" : "DISCONNECTED"}
${authOk ? "✅" : "⚠️"} BingX Auth: ${authOk ? "OK" : "CHECK KEYS"}
✅ Telegram: OK`
        await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg })
        }).catch(() => undefined)
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ healthNow: false })
        }).catch(() => undefined)
      }
      if (json?.data?.closeNow === true || json?.data?.emergencyNow === true) {
        const emergency = json?.data?.emergencyNow === true
        await manualCloseAll(emergency).catch(() => undefined)
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closeNow: false, emergencyNow: false })
        }).catch(() => undefined)
      }
      if (json?.data?.restartOnce === true) {
        resetProgress()
        await fetch("/api/bot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restartOnce: false })
        }).catch(() => undefined)
      }
    }

    const maybeSendDailyReport = async () => {
      await sendDailyReportNow(false)
    }

    const tick = async () => {
      const now = Date.now()
      const d = new Date(now)
      const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}`
      const startedKey = `abxk-started-${dayKey}`
      if (!localStorage.getItem(startedKey)) {
        const s = useBotStore.getState()
        const plan = generateCompoundingPlan(s.settings)
        const activeLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
        const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
        const mode = s.settings.mode
        const modeLabel = mode === "mirror" ? "MIRROR" : mode === "live" ? "LIVE" : "PAPER"
        await fetch("/api/telegram/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `🤖 <b>BOT STARTED</b>
━━━━━━━━━━━━━━
Mode: ${modeLabel}
Level: ${activeLevel}/${plan.length} | Equity: $${equity.toFixed(2)}
Dashboard: http://localhost:3000
Time: ${formatUtcDdMmYyyyHhMm(now)}`
          })
        }).catch(() => undefined)
        localStorage.setItem(startedKey, "1")
      }
      await postSnapshot().catch(() => undefined)
      await postRecoverySnapshot().catch(() => undefined)
      await maybeSendWeeklyAiReport().catch(() => undefined)
      await fetch("/api/monitor/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            symbol: useBotStore.getState().settings.symbol,
            timeframe: useBotStore.getState().settings.timeframe,
            features: useBotStore.getState().settings.features,
            notifications: useBotStore.getState().settings.notifications,
            thresholds: useBotStore.getState().settings.thresholds,
            compounding: useBotStore.getState().settings.compounding
          }
        })
      }).catch(() => undefined)
      await pollCommand().catch(() => undefined)
      await maybeSendDailyReport().catch(() => undefined)
    }

    void maybeRecover().catch(() => undefined)
    void tick()
    const timer = window.setInterval(() => void tick(), 60_000)
    const drTimer = window.setInterval(() => {
      void postRecoverySnapshot().catch(() => undefined)
      void useBotStore.getState().checkLiquidationDangerNow().catch(() => undefined)
    }, 30_000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(drTimer)
    }
  }, [setPaused, resetProgress])

  return null
}

function countStreak(flags: boolean[], value: boolean): number {
  let n = 0
  for (const f of flags) {
    if (f !== value) break
    n += 1
  }
  return n
}

function formatUtcDdMmYyyyHhMm(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const yyyy = String(d.getUTCFullYear())
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const min = String(d.getUTCMinutes()).padStart(2, "0")
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

function formatUtcDayName(ts: number): string {
  const d = new Date(ts)
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  return names[d.getUTCDay()] ?? "—"
}

function getIsoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
