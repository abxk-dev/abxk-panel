"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  annualizeFundingRate,
  computeBasisPct,
  decideFundingArbDirection,
  defaultArbitrageThresholds,
  parseBingxFundingRateFromPremiumIndex,
  parseBingxMarkPrice,
  parseBingxPrice,
  type BasisOpportunity,
  type FundingOpportunity
} from "@/lib/arbitrageEngine"

const STORAGE_KEY = "arbitrage_thresholds"

const SCAN_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"]

function clampNumber(v: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{props.title}</div>
      <div className="space-y-3">{props.children}</div>
    </div>
  )
}

async function sendTelegram(message: string) {
  await fetch("/api/telegram/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) })
}

export default function ArbitragePage() {
  const [fundingOpps, setFundingOpps] = useState<FundingOpportunity[]>([])
  const [basisOpps, setBasisOpps] = useState<BasisOpportunity[]>([])
  const [error, setError] = useState<string>("")
  const [running, setRunning] = useState(false)
  const [telegramAlerts, setTelegramAlerts] = useState(false)
  const [scanning, setScanning] = useState(false)

  const [fundingThresholdPct, setFundingThresholdPct] = useState(defaultArbitrageThresholds().fundingRateAbsPct)
  const [basisThresholdPct, setBasisThresholdPct] = useState(defaultArbitrageThresholds().basisAbsPct)

  const lastAlertRef = useRef<Record<string, number>>({})
  const scanLockRef = useRef(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const x = JSON.parse(raw) as any
      setFundingThresholdPct(clampNumber(Number(x?.fundingRateAbsPct ?? fundingThresholdPct), 0, 10))
      setBasisThresholdPct(clampNumber(Number(x?.basisAbsPct ?? basisThresholdPct), 0, 10))
    } catch {
      void 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ fundingRateAbsPct: fundingThresholdPct, basisAbsPct: basisThresholdPct }))
  }, [fundingThresholdPct, basisThresholdPct])

  const scanOnce = async () => {
    setError("")
    if (scanLockRef.current) return
    scanLockRef.current = true
    const funding: FundingOpportunity[] = []
    const basis: BasisOpportunity[] = []
    setScanning(true)
    try {
      for (const symbol of SCAN_SYMBOLS) {
        const [premiumRes, priceRes] = await Promise.all([
          fetch(`/api/bingx/premiumIndex?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
          fetch(`/api/bingx/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
        ])

        const premiumJson = await premiumRes.json().catch(() => null)
        const priceJson = await priceRes.json().catch(() => null)

        const fundingRate = parseBingxFundingRateFromPremiumIndex(premiumJson)
        if (fundingRate !== null) {
          const frPct = fundingRate * 100
          const { annualizedPct, estDailyPct } = annualizeFundingRate({ fundingRate, paymentsPerDay: 3 })
          if (Math.abs(frPct) >= fundingThresholdPct) {
            const opp: FundingOpportunity = {
              symbol,
              fundingRate,
              annualizedPct,
              estDailyPct,
              direction: decideFundingArbDirection(fundingRate)
            }
            funding.push(opp)

            const key = `funding:${symbol}:${Math.sign(frPct)}`
            const last = lastAlertRef.current[key] ?? 0
            if (telegramAlerts && Date.now() - last > 15 * 60_000) {
              lastAlertRef.current[key] = Date.now()
              const msg = `💰 <b>FUNDING ARBITRAGE OPPORTUNITY</b>
━━━━━━━━━━━━━━
${symbol}
Funding Rate: ${frPct.toFixed(4)}%
Annualized: ${annualizedPct.toFixed(1)}%
Direction: ${opp.direction === "SHORT_PERP_LONG_SPOT" ? "Short perp, Long spot" : "Long perp, Short spot"}
Est. daily profit: ${estDailyPct.toFixed(3)}%`
              await sendTelegram(msg).catch(() => undefined)
            }
          }
        }

        const futuresPrice = parseBingxPrice(priceJson)
        const spotLikePrice = parseBingxMarkPrice(premiumJson)
        if (futuresPrice !== null && spotLikePrice !== null && spotLikePrice > 0) {
          const basisPct = computeBasisPct({ futuresPrice, spotLikePrice })
          if (Math.abs(basisPct) >= basisThresholdPct) {
            const opp: BasisOpportunity = { symbol, basisPct, futuresPrice, spotLikePrice }
            basis.push(opp)

            const key = `basis:${symbol}:${Math.sign(basisPct)}`
            const last = lastAlertRef.current[key] ?? 0
            if (telegramAlerts && Date.now() - last > 15 * 60_000) {
              lastAlertRef.current[key] = Date.now()
              const msg = `📊 <b>BASIS ARBITRAGE FOUND</b>
━━━━━━━━━━━━━━
${symbol}: ${basisPct >= 0 ? "premium" : "discount"} ${Math.abs(basisPct).toFixed(3)}%
Spot-like: $${spotLikePrice.toFixed(2)} | Futures: $${futuresPrice.toFixed(2)}`
              await sendTelegram(msg).catch(() => undefined)
            }
          }
        }
      }
      setFundingOpps(funding.sort((a, b) => Math.abs(b.annualizedPct) - Math.abs(a.annualizedPct)))
      setBasisOpps(basis.sort((a, b) => Math.abs(b.basisPct) - Math.abs(a.basisPct)))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed"
      setError(msg)
    } finally {
      setScanning(false)
      scanLockRef.current = false
    }
  }

  const scanOnceRef = useRef(scanOnce)
  useEffect(() => {
    scanOnceRef.current = scanOnce
  })

  useEffect(() => {
    if (!running) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      await scanOnceRef.current()
    }
    void tick()
    const t = window.setInterval(() => void tick(), 30_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [running])

  const overall = useMemo(() => {
    const score = fundingOpps.length + basisOpps.length
    return score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW"
  }, [fundingOpps.length, basisOpps.length])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">⚖️ ARBITRAGE SCANNER</div>
        <div className="text-sm text-white/60">Price monitoring only (alerts for funding and basis)</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="ALERT THRESHOLDS">
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Funding abs &gt; (%)</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={fundingThresholdPct}
                min={0}
                max={10}
                step={0.01}
                onChange={(e) => setFundingThresholdPct(clampNumber(Number(e.target.value), 0, 10))}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Basis abs &gt; (%)</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={basisThresholdPct}
                min={0}
                max={10}
                step={0.01}
                onChange={(e) => setBasisThresholdPct(clampNumber(Number(e.target.value), 0, 10))}
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-sm text-white/80">Telegram alerts</div>
              <input type="checkbox" checked={telegramAlerts} onChange={(e) => setTelegramAlerts(e.target.checked)} />
            </label>
          </Section>

          <Section title="SCAN CONTROL">
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              disabled={scanning}
              onClick={() => void scanOnce()}
            >
              {scanning ? "Scanning…" : "Scan Now"}
            </button>
            <button
              type="button"
              className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${running ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/70 hover:text-white"}`}
              disabled={scanning}
              onClick={() => setRunning((v) => !v)}
            >
              {running ? "Running ✅ (30s)" : "Start Auto Scan (30s)"}
            </button>
            <div className="text-xs text-white/60">Overall risk: {overall}</div>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={`FUNDING OPPORTUNITIES (${fundingOpps.length})`}>
            {fundingOpps.length ? (
              <div className="space-y-2">
                {fundingOpps.map((o) => (
                  <div key={o.symbol} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{o.symbol}</div>
                      <div className="text-xs text-white/60">{o.direction === "SHORT_PERP_LONG_SPOT" ? "Short perp / Long spot" : "Long perp / Short spot"}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/70">
                      Funding: {(o.fundingRate * 100).toFixed(4)}% • Annualized: {o.annualizedPct.toFixed(1)}% • Daily: {o.estDailyPct.toFixed(3)}%
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                {scanning ? "Scanning for funding opportunities…" : "No funding opportunities above threshold."}
              </div>
            )}
          </Section>

          <Section title={`BASIS OPPORTUNITIES (${basisOpps.length})`}>
            {basisOpps.length ? (
              <div className="space-y-2">
                {basisOpps.map((o) => (
                  <div key={o.symbol} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{o.symbol}</div>
                      <div className="text-xs text-white/60">{o.basisPct >= 0 ? "Premium" : "Discount"}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/70">
                      Basis: {o.basisPct.toFixed(3)}% • Spot-like: ${o.spotLikePrice?.toFixed(2) ?? "—"} • Futures: ${o.futuresPrice?.toFixed(2) ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                {scanning ? "Scanning for basis opportunities…" : "No basis opportunities above threshold."}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
