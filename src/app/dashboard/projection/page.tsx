"use client"

import { ProjectionCalculator } from "@/components/ProjectionCalculator"
import { useBotStore } from "@/store/botStore"

export default function ProjectionPage() {
  const enabled = useBotStore((s) => s.settings.features.projection)

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold text-white">Projection</div>
        <div className="text-sm text-white/60">Estimate time to reach Level 30</div>
      </div>
      {enabled ? (
        <ProjectionCalculator />
      ) : (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
          Projection calculator is disabled in Settings.
        </div>
      )}
    </div>
  )
}

