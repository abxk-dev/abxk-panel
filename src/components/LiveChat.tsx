"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { generateCompoundingPlan, getActiveLevel } from "@/lib/compounding"
import { useBotStore } from "@/store/botStore"

type ChatRole = "user" | "assistant"
type ChatType = "ai" | "command" | "system"

export type Message = {
  id: string
  role: ChatRole
  content: string
  timestamp: string
  type: ChatType
}

type Mode = "AI" | "COMMANDS"

const STORAGE_KEY = "abxk_live_chat_v1"

function nowIso() {
  return new Date().toISOString()
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  return `${h}:${m}`
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function LiveChat() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("AI")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const snapshot = useBotStore((s) => {
    const plan = generateCompoundingPlan(s.settings)
    const currentLevel = getActiveLevel(s.settings.compounding.levels, s.completedLevels)
    const active = plan.find((x) => x.level === currentLevel)
    const equity = s.equityCurve[0]?.equity ?? s.settings.capital.initialCapitalUsd
    const today = new Date().toISOString().slice(0, 10)
    const dailyTrades = s.dailyTradeCount[today] ?? 0
    const botStatus = s.paused ? "PAUSED" : "RUNNING"
    const botMode = s.settings.mode.toUpperCase()
    const regime = s.marketRegime?.regime ?? s.lastRegime ?? "—"
    const openTrade = [...(s.liveTrades ?? []), ...(s.paperTrades ?? [])].find((t) => t.status === "OPEN")
    const activeSymbol = openTrade?.symbol ?? s.scannerSelectedSymbol ?? s.settings.symbol
    const lastScore = s.scannerTop?.totalScore ?? s.lastScanResult?.score ?? 0
    const levelTarget = active?.endingBalanceUsd ?? 0
    const levelProgress =
      active && active.endingBalanceUsd > active.balanceUsd
        ? Math.max(0, Math.min(100, ((equity - active.balanceUsd) / (active.endingBalanceUsd - active.balanceUsd)) * 100))
        : 0
    return { botStatus, botMode, currentLevel, equity, dailyTrades, regime, activeSymbol, lastScore, levelTarget, levelProgress }
  })

  const systemPrompt = useMemo(() => {
    return `
You are ABXK-BOT trading assistant.
You help the user understand their crypto trading bot.

Current bot context:
- Bot Mode: ${snapshot.botMode}
- Current Level: ${snapshot.currentLevel}/30
- Equity: $${snapshot.equity.toFixed(2)}
- Today trades: ${snapshot.dailyTrades}/1
- Current Regime: ${snapshot.regime}
- Bot Status: ${snapshot.botStatus}
- Active Symbol: ${snapshot.activeSymbol}
- Last scan score: ${snapshot.lastScore}/100

Answer questions about:
- Trading strategy and signals
- Why trade was taken or skipped
- Level progress and compounding
- Market analysis
- Bot settings explanation
- Risk management advice

Keep answers concise and clear.
Use bullet points for lists.
Always be helpful and educational.
Language: Match user's language
(Hindi or English — auto detect)
    `.trim()
  }, [snapshot])

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) throw new Error("no-cache")
      const parsed = JSON.parse(raw) as Message[]
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty")
      return parsed.slice(-50)
    } catch {
      return [
        {
          id: "1",
          role: "assistant",
          content: "Namaste! Main ABXK-BOT assistant hoon. Trading ke baare mein kuch bhi pucho ya /help type karo commands ke liye.",
          timestamp: nowIso(),
          type: "system"
        }
      ]
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)))
    } catch {
      return
    }
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, open, busy])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const next = Math.min(140, Math.max(44, el.scrollHeight))
    el.style.height = `${next}px`
  }, [input, open])

  const suggestions = useMemo(
    () => [
      { label: "📊 Analyze BTC", text: "Analyze BTC-USDT right now based on the bot context and give clear next action." },
      { label: "📈 My Level", text: "Show my current compounding level progress and what I need to reach the next level." },
      { label: "⚙️ Bot Status", text: "/status" },
      { label: "🔍 Last Trade", text: "Explain the last trade: why it was taken, what filters triggered, and what could be improved." }
    ],
    []
  )

  const addMessage = (m: Omit<Message, "id" | "timestamp">) => {
    const msg: Message = { ...m, id: uid(), timestamp: nowIso() }
    setMessages((prev) => [...prev, msg].slice(-50))
  }

  const triggerManualScan = async () => {
    await fetch("/api/bot/scan", { method: "POST" }).catch(() => undefined)
  }

  const pauseBot = async () => {
    await fetch("/api/bot/pause", { method: "POST" }).catch(() => undefined)
  }

  const resumeBot = async () => {
    await fetch("/api/bot/resume", { method: "POST" }).catch(() => undefined)
  }

  const sendDailyReport = async () => {
    const text = `📋 <b>DAILY REPORT</b>
━━━━━━━━━━━━━━
Bot: ${snapshot.botStatus}
Mode: ${snapshot.botMode}
Level: ${snapshot.currentLevel}/30
Equity: $${snapshot.equity.toFixed(2)}
Trades today: ${snapshot.dailyTrades}/1
Regime: ${snapshot.regime}
Active: ${snapshot.activeSymbol}
Last scan: ${snapshot.lastScore}/100`
    await fetch("/api/telegram/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    }).catch(() => undefined)
  }

  const handleCommand = async (cmd: string): Promise<string | null> => {
    const c = cmd.trim().split(/\s+/)[0] ?? cmd.trim()
    switch (c) {
      case "/status":
        return `Bot: ${snapshot.botStatus}\nLevel: ${snapshot.currentLevel}/30\nEquity: $${snapshot.equity.toFixed(2)}\nMode: ${snapshot.botMode}\nTrades today: ${snapshot.dailyTrades}/1\nRegime: ${snapshot.regime}`
      case "/scan":
        await triggerManualScan()
        return "Manual scan triggered — check scanner tab"
      case "/pause":
        await pauseBot()
        return "Bot paused ⏸"
      case "/resume":
        await resumeBot()
        return "Bot resumed ▶"
      case "/level":
        return `Current: Level ${snapshot.currentLevel}/30\nBalance: $${snapshot.equity.toFixed(2)}\nTarget: $${snapshot.levelTarget.toFixed(
          2
        )}\nProgress: ${snapshot.levelProgress.toFixed(0)}%`
      case "/report":
        await sendDailyReport()
        return "Daily report sent to Telegram ✅"
      case "/help":
        return `Available commands:\n/status — bot status\n/scan — manual scan\n/pause — pause bot\n/resume — resume bot\n/level — level progress\n/report — send report\n/help — show commands`
      default:
        return null
    }
  }

  const askGemini = async (userMessage: string, chatHistory: Message[]): Promise<string> => {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        systemPrompt,
        history: chatHistory
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }))
      })
    })
    const json = (await res.json().catch(() => null)) as any
    if (!json?.ok) {
      const err = typeof json?.error === "string" ? json.error : "Chat failed"
      throw new Error(err)
    }
    const out = json?.data?.text
    if (typeof out !== "string" || !out.trim()) throw new Error("Chat returned empty response")
    return out.trim()
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setInput("")
    addMessage({ role: "user", content: text, type: text.startsWith("/") ? "command" : "ai" })

    setBusy(true)
    try {
      const isCommand = mode === "COMMANDS" || text.startsWith("/")
      if (isCommand) {
        const handled = await handleCommand(text)
        if (handled) {
          addMessage({ role: "assistant", content: handled, type: "command" })
          return
        }
        if (mode === "COMMANDS") {
          addMessage({ role: "assistant", content: "Unknown command. Type /help", type: "command" })
          return
        }
      }

      const reply = await askGemini(text, messages)
      addMessage({ role: "assistant", content: reply, type: "ai" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed"
      addMessage({ role: "assistant", content: `Error: ${msg}`, type: "system" })
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const exportChat = () => {
    const lines = messages.map((m) => {
      const who = m.role === "user" ? "You" : "ABXK-BOT"
      return `[${fmtTime(m.timestamp)}] ${who}: ${m.content}`
    })
    downloadText(`abxk-chat-${new Date().toISOString().slice(0, 10)}.txt`, lines.join("\n\n"))
  }

  const clearChat = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setMessages([
      {
        id: "1",
        role: "assistant",
        content: "Namaste! Main ABXK-BOT assistant hoon. Trading ke baare mein kuch bhi pucho ya /help type karo commands ke liye.",
        timestamp: nowIso(),
        type: "system"
      }
    ])
  }

  return (
    <>
      {!open ? (
        <div
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "#00FF88",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "22px",
            zIndex: 1000,
            boxShadow: "0 0 20px #00FF8844"
          }}
          role="button"
          aria-label="Open chat"
        >
          💬
        </div>
      ) : (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            width: "380px",
            height: "500px",
            background: "#0a0a0a",
            border: "1px solid #00FF8833",
            zIndex: 1000,
            boxShadow: "0 0 30px rgba(0,255,136,0.15)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: "14px"
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-white">ABXK-BOT CHAT</div>
              <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1 text-[11px]">
                <button
                  className={`rounded-md px-2 py-1 ${mode === "AI" ? "bg-[#00FF88]/20 text-[#00FF88]" : "text-white/60 hover:text-white"}`}
                  onClick={() => setMode("AI")}
                  type="button"
                >
                  AI
                </button>
                <button
                  className={`rounded-md px-2 py-1 ${
                    mode === "COMMANDS" ? "bg-[#00FF88]/20 text-[#00FF88]" : "text-white/60 hover:text-white"
                  }`}
                  onClick={() => setMode("COMMANDS")}
                  type="button"
                >
                  CMD
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                onClick={exportChat}
              >
                Export
              </button>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                onClick={clearChat}
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white"
                type="button"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="flex flex-col gap-2">
              {messages.map((m) => {
                const isUser = m.role === "user"
                const mono = m.type === "command"
                return (
                  <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={[
                        "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                        isUser ? "bg-[#00FF88] text-black" : "bg-white/5 text-white",
                        mono ? "font-mono whitespace-pre-wrap" : "whitespace-pre-wrap",
                        "border border-white/10"
                      ].join(" ")}
                    >
                      <div className="text-[10px] opacity-70">{fmtTime(m.timestamp)}</div>
                      <div>{m.content}</div>
                    </div>
                  </div>
                )
              })}

              {busy ? (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                    <div className="text-[10px] opacity-70">{fmtTime(nowIso())}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-white/70">Thinking</div>
                      <div className="dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => void send(s.text)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                  disabled={busy}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type message or /command"
                className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#00FF88]/50"
                rows={2}
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={busy || !input.trim()}
                className="rounded-xl bg-[#00FF88] px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                Send ▶
              </button>
            </div>
          </div>

          <style jsx>{`
            .dots {
              display: inline-flex;
              gap: 4px;
              align-items: center;
            }
            .dots span {
              width: 6px;
              height: 6px;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.7);
              animation: bounce 1.2s infinite ease-in-out;
            }
            .dots span:nth-child(2) {
              animation-delay: 0.15s;
            }
            .dots span:nth-child(3) {
              animation-delay: 0.3s;
            }
            @keyframes bounce {
              0%,
              80%,
              100% {
                transform: translateY(0);
                opacity: 0.4;
              }
              40% {
                transform: translateY(-3px);
                opacity: 1;
              }
            }
          `}</style>
        </div>
      )}
    </>
  )
}
