"use client"

import { TradeHistory } from "@/components/TradeHistory"

export default function TradesPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Trades</div>
        <div className="text-sm text-white/60">Paper and live history</div>
      </div>
      <TradeHistory />
    </div>
  )
}

