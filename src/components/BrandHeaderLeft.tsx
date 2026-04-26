"use client"

import { useMemo } from "react"
import Image from "next/image"
import { useBranding } from "@/components/BrandingProvider"

export function BrandHeaderLeft() {
  const { logo, botName, tagline } = useBranding()

  const nameParts = useMemo(() => splitName(botName), [botName])

  return (
    <div className="flex items-center gap-3">
      {logo ? (
        <Image src={logo} alt="Bot logo" width={40} height={40} className="h-10 w-10 rounded-full object-cover" unoptimized />
      ) : (
        <div
          className="flex h-10 w-10 items-center justify-center font-mono text-[14px] font-bold"
          style={{
            background: "#0a0a0a",
            border: "1.5px solid #00FF88",
            borderRadius: 6,
            color: "#00FF88"
          }}
        >
          ▶
        </div>
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-1 font-mono text-[18px] font-semibold" style={{ color: "#00FF88" }}>
          <span className="truncate">
            {nameParts.head ? <span>{nameParts.head}</span> : null}
            {nameParts.tail !== null ? (
              <>
                <span style={{ color: "#ffffff" }}>-</span>
                <span>{nameParts.tail}</span>
              </>
            ) : (
              <span>{nameParts.head ? "" : botName}</span>
            )}
          </span>
          <span className="blink-cursor" style={{ color: "#00FF88" }}>
            |
          </span>
        </div>
        <div className="font-mono text-[11px]" style={{ color: "#666666" }}>
          {`> ${tagline}_`}
        </div>
      </div>
    </div>
  )
}

function splitName(name: string): { head: string; tail: string | null } {
  const trimmed = name.trim()
  const i = trimmed.indexOf("-")
  if (i <= 0 || i >= trimmed.length - 1) return { head: trimmed, tail: null }
  return { head: trimmed.slice(0, i), tail: trimmed.slice(i + 1) }
}
