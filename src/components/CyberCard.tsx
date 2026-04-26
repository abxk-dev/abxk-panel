"use client"

export function CyberCard({
  title,
  children,
  color = "green"
}: {
  title: string
  children: React.ReactNode
  color?: "green" | "red" | "blue" | "yellow"
}) {
  const c =
    {
      green: "#00FF8830",
      red: "#FF004430",
      blue: "#0088FF30",
      yellow: "#FFD70030"
    }[color] ?? "#00FF8830"

  const titleColor = color === "green" ? "#00FF8860" : color === "red" ? "#FF004460" : color === "yellow" ? "#FFD70060" : "#0088FF60"

  return (
    <div
      style={{
        background: "#0a0a12",
        border: `1px solid ${c}`,
        borderRadius: 4,
        padding: 16,
        position: "relative",
        overflow: "hidden",
        boxShadow: `inset 0 0 30px ${c}50`
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, borderTop: `1px solid ${c}`, borderLeft: `1px solid ${c}`, opacity: 0.8 }} />
      <div
        style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderBottom: `1px solid ${c}`, borderRight: `1px solid ${c}`, opacity: 0.8 }}
      />
      <div
        style={{
          fontFamily: "var(--font-cyber)",
          fontSize: 9,
          color: titleColor,
          letterSpacing: 2,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span style={{ opacity: 0.5 }}>{"//"}</span>
        {title.toUpperCase()}
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${c},transparent)` }} />
      </div>
      {children}
    </div>
  )
}

export function CyberMetric({
  label,
  value,
  unit = "",
  change = null
}: {
  label: string
  value: string | number
  unit?: string
  change?: number | null
}) {
  return (
    <div
      style={{
        background: "#050508",
        border: "1px solid #00FF8820",
        borderRadius: 4,
        padding: 16,
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div style={{ position: "absolute", top: -20, right: -20, fontSize: 70, color: "#00FF8806", userSelect: "none" }}>◈</div>
      <div style={{ fontSize: 9, color: "#00FF8850", letterSpacing: 2, marginBottom: 8, fontFamily: "var(--font-cyber)" }}>
        {"// " + label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: "var(--neon-green)",
          textShadow: "var(--glow-green)",
          fontFamily: "var(--font-display)",
          letterSpacing: 2
        }}
      >
        {unit}
        {value}
      </div>
      {change !== null ? (
        <div
          style={{
            fontSize: 11,
            marginTop: 4,
            fontFamily: "var(--font-cyber)",
            color: (change ?? 0) >= 0 ? "var(--neon-green)" : "var(--neon-red)"
          }}
        >
          {(change ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(change ?? 0)}%
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 2,
          width: "60%",
          background: "linear-gradient(90deg,var(--neon-green),transparent)",
          boxShadow: "var(--glow-green)"
        }}
      />
    </div>
  )
}
