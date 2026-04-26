"use client"

import { useEffect, useRef, useState } from "react"
import { AutomationRunner } from "@/components/AutomationRunner"
import { BootSequence } from "@/components/BootSequence"
import { CyberHeader } from "@/components/CyberHeader"
import { CyberNavItem, CyberTicker, type CyberNavItemModel, type TickerPrice } from "@/components/CyberTicker"
import { CodeRain } from "@/components/CodeRain"
import { LiveChat } from "@/components/LiveChat"

const nav: CyberNavItemModel[] = [
  { href: "/dashboard", label: "Overview", icon: "⌁" },
  { href: "/dashboard/strategy", label: "Strategy", icon: "⟡" },
  { href: "/dashboard/risk-compounding", label: "Risk & Compounding", icon: "◈" },
  { href: "/dashboard/trades", label: "Trades", icon: "⟠" },
  { href: "/dashboard/scalping", label: "⚡ Scalping", icon: "⚡" },
  { href: "/dashboard/grid-vault", label: "Grid Vault", icon: "🔲" },
  { href: "/dashboard/journal", label: "Trade Journal", icon: "≋" },
  { href: "/dashboard/backtester", label: "Backtester", icon: "⧉" },
  { href: "/dashboard/market-monitor", label: "Market Monitor", icon: "⌬" },
  { href: "/dashboard/projection", label: "Projection", icon: "⎔" },
  { href: "/dashboard/settings", label: "Settings", icon: "⛭" }
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(true)
  const [prices, setPrices] = useState<TickerPrice[]>([
    { symbol: "BTC", price: null, change: 0 },
    { symbol: "ETH", price: null, change: 0 },
    { symbol: "SOL", price: null, change: 0 }
  ])
  const lastPriceRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const k = "abxk_boot_done"
    const done = typeof window !== "undefined" && window.sessionStorage.getItem(k) === "1"
    if (!done) setBooted(false)
  }, [])

  useEffect(() => {
    let mounted = true
    const fetchOne = async (symbol: string): Promise<number | null> => {
      try {
        const pair = `${symbol}-USDT`
        const res = await fetch(`/api/bingx/price?symbol=${encodeURIComponent(pair)}`, { cache: "no-store" })
        const json = (await res.json()) as any
        const raw = json?.data?.price
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
        return Number.isFinite(n) ? n : null
      } catch {
        return null
      }
    }

    const tick = async () => {
      const syms = ["BTC", "ETH", "SOL"] as const
      const next: TickerPrice[] = []
      for (const s of syms) {
        const price = await fetchOne(s)
        const prev = lastPriceRef.current[s]
        const change = price && prev ? ((price - prev) / prev) * 100 : 0
        if (price) lastPriceRef.current[s] = price
        next.push({ symbol: s, price, change: Number.isFinite(change) ? change : 0 })
      }
      if (!mounted) return
      setPrices(next)
    }

    void tick()
    const t = window.setInterval(() => void tick(), 10_000)
    return () => {
      mounted = false
      window.clearInterval(t)
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg">
      <AutomationRunner />
      <LiveChat />
      {!booted ? (
        <BootSequence
          onComplete={() => {
            window.sessionStorage.setItem("abxk_boot_done", "1")
            setBooted(true)
          }}
        />
      ) : null}
      <div className="flex min-h-screen">
        <div
          className="relative hidden md:block"
          style={{
            width: "160px",
            minHeight: "100vh",
            overflow: "hidden",
            background: "#050505",
            borderRight: "1px solid #0a2a0a",
            flexShrink: 0
          }}
        >
          <CodeRain width={160} opacity={0.2} color="#00FF88" fontSize={11} speed={60} />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
              pointerEvents: "none",
              zIndex: 1
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <CyberTicker prices={prices} />
          <CyberHeader />
          <div className="mx-auto max-w-7xl px-4 py-6">
            <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
              <aside className="rounded-xl border border-white/10 bg-black/20 p-3">
                <nav className="flex flex-col gap-1">
                  {nav.map((item) => (
                    <CyberNavItem key={item.href} item={item} />
                  ))}
                </nav>
              </aside>
              <main className="rounded-xl border border-white/10 bg-black/20 p-5">{children}</main>
            </div>
          </div>
        </div>

        <div
          className="relative hidden md:block"
          style={{
            width: "160px",
            minHeight: "100vh",
            overflow: "hidden",
            background: "#050505",
            borderLeft: "1px solid #0a2a0a",
            flexShrink: 0
          }}
        >
          <CodeRain width={160} opacity={0.2} color="#00FF88" fontSize={11} speed={45} />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
              pointerEvents: "none",
              zIndex: 1
            }}
          />
        </div>
      </div>
    </div>
  )
}
