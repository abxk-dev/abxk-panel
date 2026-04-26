"use client"

import Link from "next/link"
import { useMemo } from "react"
import { usePathname } from "next/navigation"

export type TickerPrice = {
  symbol: string
  price: number | null
  change: number
}

export function CyberTicker({ prices }: { prices: TickerPrice[] }) {
  const list = useMemo(() => (Array.isArray(prices) ? prices : []), [prices])

  return (
    <div
      style={{
        background: "#000",
        borderBottom: "1px solid #00FF8815",
        overflow: "hidden",
        height: 26,
        display: "flex",
        alignItems: "center"
      }}
    >
      <div style={{ display: "flex", gap: 40, animation: "scroll 25s linear infinite", whiteSpace: "nowrap" }}>
        {[...list, ...list].map((p, i) => (
          <span
            key={`${p.symbol}_${i}`}
            style={{
              fontFamily: "var(--font-cyber)",
              fontSize: 11,
              color: p.change >= 0 ? "var(--neon-green)" : "var(--neon-red)",
              letterSpacing: 1
            }}
          >
            {p.symbol}: ${p.price ? p.price.toLocaleString() : "—"}
            <span style={{ marginLeft: 4, fontSize: 10 }}>
              {p.change >= 0 ? "▲" : "▼"}
              {Math.abs(p.change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

export type CyberNavItemModel = {
  href: string
  label: string
  icon?: string
}

export function CyberNavItem({ item }: { item: CyberNavItemModel }) {
  const pathname = usePathname()
  const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href))

  return (
    <Link
      href={item.href}
      style={{
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        position: "relative",
        background: active ? "#00FF8808" : "transparent",
        borderLeft: `2px solid ${active ? "var(--neon-green)" : "transparent"}`,
        color: active ? "var(--neon-green)" : "#00FF8845",
        fontSize: 12,
        letterSpacing: 1,
        fontFamily: "var(--font-cyber)",
        transition: "all 0.2s"
      }}
    >
      {active ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--neon-green)",
            boxShadow: "var(--glow-green)"
          }}
        />
      ) : null}
      <span style={{ fontSize: 14 }}>{item.icon ?? "⌁"}</span>
      <span>{item.label.toUpperCase()}</span>
      {active ? <span style={{ marginLeft: "auto", fontSize: 8, animation: "blink 1s infinite" }}>●</span> : null}
    </Link>
  )
}

