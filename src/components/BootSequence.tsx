"use client"

import { useEffect, useState } from "react"

const BOOT_LINES = [
  "> ABXK-BOT TRADING TERMINAL v2.0",
  "> ══════════════════════════════",
  "> Initializing system...",
  "> Loading trading modules...    [OK]",
  "> Connecting BingX API...       [OK]",
  "> WebSocket feed...             [OK]",
  "> Compounding engine...         [OK]",
  "> Scalping module...            [OK]",
  "> AI analysis (Gemini)...       [OK]",
  "> Telegram notifications...     [OK]",
  "> Pattern detection...          [OK]",
  "> ══════════════════════════════",
  "> ALL SYSTEMS OPERATIONAL ✓",
  "> Starting dashboard..."
]

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [lines, setLines] = useState<Array<string>>([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    let i = 0
    const interval = window.setInterval(() => {
      if (i < BOOT_LINES.length) {
        const next = BOOT_LINES[i]
        if (typeof next === "string") setLines((prev) => [...prev, next])
        i += 1
      } else {
        window.clearInterval(interval)
        setDone(true)
        window.setTimeout(onComplete, 600)
      }
    }, 180)
    return () => window.clearInterval(interval)
  }, [onComplete])

  if (!done && lines.length === 0) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-cyber)",
        transition: "opacity 0.6s",
        opacity: done ? 0 : 1
      }}
    >
      <div style={{ width: 520 }}>
        <pre
          style={{
            color: "var(--neon-green)",
            fontSize: 9,
            textShadow: "var(--glow-green)",
            marginBottom: 20,
            lineHeight: 1.2
          }}
        >{`
    ___  ___  _  _  _  _     ___  ___  ___
   / _ ||  _\\ \\/ /| |/ /   | _ )/ _ ||  _|
  | (_|||| _ <  >  < | ' <   | _ \\ (_||| |
   \\___||___//_/\\_\\|_|\\_\\  |___/\\___/|___|`}</pre>

        {lines.map((line, idx) => {
          const text = typeof line === "string" ? line : ""
          return (
            <div
              key={idx}
              style={{
                fontSize: 12,
                lineHeight: "1.9",
                color: text.includes("[OK]")
                  ? "var(--neon-green)"
                  : text.includes("═")
                    ? "#00FF8840"
                    : text.includes("OPERATIONAL")
                      ? "var(--neon-green)"
                      : "#00FF8870",
                textShadow: text.includes("[OK]") ? "var(--glow-green)" : "none",
                letterSpacing: 1
              }}
            >
              {text}
            </div>
          )
        })}

        {!done ? <span style={{ animation: "blink 0.5s infinite", color: "var(--neon-green)" }}>█</span> : null}
      </div>
    </div>
  )
}
