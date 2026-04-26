"use client"

import { FilterPanel } from "@/components/FilterPanel"

export default function StrategyPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Strategy</div>
        <div className="text-sm text-white/60">Configure smart filters and run the 4H/D scan</div>
      </div>
      <FilterPanel />
    </div>
  )
}

