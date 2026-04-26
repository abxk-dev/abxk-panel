"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLivePrice } from "@/lib/useLivePrice"
import { useGridVaultStore, type GridCycleEntry, type GridVaultSettings } from "@/lib/gridVaultState"
import { OverviewTab } from "@/components/gridvault/OverviewTab"
import { SpotGridPanel } from "@/components/gridvault/SpotGridPanel"
import { FuturesGridPanel } from "@/components/gridvault/FuturesGridPanel"
import { GridCalculator } from "@/components/gridvault/GridCalculator"
import { GridHistory } from "@/components/gridvault/GridHistory"

type TabKey = "overview" | "spot" | "futures" | "calculator" | "history"

export function GridVaultPage({ defaults }: { defaults: GridVaultSettings }) {
  const setSettingsFromDefaults = useGridVaultStore((s) => s.setSettingsFromDefaults)
  const settings = useGridVaultStore((s) => s.settings)
  const history = useGridVaultStore((s) => s.history)
  const spotGrids = useGridVaultStore((s) => s.spotGrids)
  const futuresGrids = useGridVaultStore((s) => s.futuresGrids)
  const onPriceTick = useGridVaultStore((s) => s.onPriceTick)
  const alerts = useGridVaultStore((s) => s.alerts)
  const consumeAlerts = useGridVaultStore((s) => s.consumeAlerts)

  const [tab, setTab] = useState<TabKey>("overview")

  useEffect(() => {
    setSettingsFromDefaults(defaults)
  }, [defaults, setSettingsFromDefaults])

  const primarySymbol = useMemo(() => {
    const activeSpot = spotGrids.find((g) => g.running)?.config.symbol
    const activeFut = futuresGrids.find((g) => g.running)?.config.symbol
    return activeSpot ?? activeFut ?? settings.defaultSymbol ?? "BTC-USDT"
  }, [spotGrids, futuresGrids, settings.defaultSymbol])

  const { price } = useLivePrice(primarySymbol)

  useEffect(() => {
    if (price === undefined) return
    onPriceTick(primarySymbol, price)
  }, [price, primarySymbol, onPriceTick])

  const lastCycleIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!settings.telegramUpdates) return
    const latest = history[0]
    if (!latest) return
    if (lastCycleIdRef.current === latest.id) return
    lastCycleIdRef.current = latest.id
    void sendTelegramCycle(latest).catch(() => null)
  }, [history, settings.telegramUpdates])

  useEffect(() => {
    if (!settings.telegramUpdates) return
    if (!alerts.length) return
    const next = consumeAlerts()
    if (!next.length) return
    for (const a of next.slice().reverse()) {
      if (a.type === "LIQ_WARNING") {
        const msg = `🚨 GRID VAULT WARNING
━━━━━━━━━━━━━━
${a.symbol} price approaching danger zone
Current: $${Math.round(a.currentPrice).toLocaleString()}
Liq price: $${Math.round(a.liqPrice).toLocaleString()}
Distance: -${a.remainingPercent.toFixed(1)}% remaining
Action: Consider reducing leverage`
        void sendTelegramMessage(msg).catch(() => null)
      } else if (a.type === "DAILY_REPORT") {
        const msg = `📊 GRID DAILY REPORT
━━━━━━━━━━━━━━
Date: ${a.dayKeyUtc}
Cycles: ${a.cycles}
Daily profit: +$${a.profit.toFixed(2)}
Total profit: +$${a.totalProfit.toFixed(2)}
Capital: $${a.capital.toFixed(2)} → $${a.value.toFixed(2)}`
        void sendTelegramMessage(msg).catch(() => null)
      }
    }
  }, [alerts, settings.telegramUpdates, consumeAlerts])

  useEffect(() => {
    if (!settings.telegramUpdates || !settings.hourlyUpdates) return
    const t = window.setInterval(() => {
      const activeSpot = useGridVaultStore.getState().spotGrids.find((g) => g.running)
      const activeFut = useGridVaultStore.getState().futuresGrids.find((g) => g.running)
      const active = activeSpot ?? activeFut
      if (!active) return
      const p = active.lastPrice
      if (typeof p !== "number") return
      const nearestBuy = [...active.levels]
        .filter((l) => l.type === "BUY")
        .sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p))[0]
      const nearestSell = [...active.levels]
        .filter((l) => l.type === "SELL")
        .sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p))[0]

      const msg = `📊 GRID HOURLY UPDATE
━━━━━━━━━━━━━━
${active.config.symbol}: $${Math.round(p).toLocaleString()}
Grid: ACTIVE ✅
Total cycles: ${active.cycles}
Total profit: +$${active.totalProfit.toFixed(2)}
Nearest buy: $${nearestBuy ? Math.round(nearestBuy.price).toLocaleString() : "—"}
Nearest sell: $${nearestSell ? Math.round(nearestSell.price).toLocaleString() : "—"}`

      void sendTelegramMessage(msg).catch(() => null)
    }, 60 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [settings.telegramUpdates, settings.hourlyUpdates])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">GRID VAULT</div>
        <div className="text-sm text-white/60">Consistent Growth Engine</div>
        {!settings.enabled ? (
          <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
            GRID VAULT is disabled. Set GRID_VAULT_ENABLED=true in .env.local then restart the dev server.
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} label="Overview" />
        <TabButton active={tab === "spot"} onClick={() => setTab("spot")} label="Spot Grid" />
        <TabButton active={tab === "futures"} onClick={() => setTab("futures")} label="Futures Grid" />
        <TabButton active={tab === "calculator"} onClick={() => setTab("calculator")} label="Calculator" />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} label="History" />
      </div>

      {tab === "overview" ? <OverviewTab liveSymbol={primarySymbol} livePrice={price} /> : null}
      {tab === "spot" ? <SpotGridPanel /> : null}
      {tab === "futures" ? <FuturesGridPanel /> : null}
      {tab === "calculator" ? <GridCalculator /> : null}
      {tab === "history" ? <GridHistory /> : null}
    </div>
  )
}

function TabButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
        props.active ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

async function sendTelegramMessage(message: string) {
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  }).catch(() => null)
}

async function sendTelegramCycle(cycle: GridCycleEntry) {
  const typeLabel = cycle.type === "SPOT" ? "SPOT GRID" : `BTC Futures ${cycle.type.replace("FUT", "")}`
  const msg = `✅ GRID CYCLE COMPLETE
━━━━━━━━━━━━━━
${typeLabel}
Buy: $${Math.round(cycle.buyPrice).toLocaleString()} → Sell: $${Math.round(cycle.sellPrice).toLocaleString()}
Gross profit: +$${cycle.profit.toFixed(2)}
Total cycles: ${useGridVaultStore.getState().totalCycles}
Total profit: +$${useGridVaultStore.getState().totalProfit.toFixed(2)}`
  await sendTelegramMessage(msg)
}
