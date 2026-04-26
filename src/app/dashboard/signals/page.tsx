"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type SignalSource = "NEWS_AI" | "FEAR_GREED" | "TRADINGVIEW" | "WHALE_ALERT" | "MANUAL"
type SignalDirection = "LONG" | "SHORT"

type IncomingSignal = {
  id: string
  createdAt: number
  source: SignalSource
  symbol: string
  direction: SignalDirection
  confidence: number
  reason: string
  executedAt?: number
  skippedAt?: number
  analysis?: string
}

type SignalSettings = {
  sources: Record<SignalSource, boolean>
  autoExecute: boolean
  minConfidence: number
}

const STORAGE_KEY = "signal_center_settings"
const STORAGE_QUEUE_KEY = "signal_center_queue"

function nowId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

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

function Tag(props: { ok: boolean; text: string }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${props.ok ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60"}`}>
      {props.text}
    </span>
  )
}

function defaultSettings(): SignalSettings {
  return {
    sources: {
      NEWS_AI: true,
      FEAR_GREED: true,
      TRADINGVIEW: true,
      WHALE_ALERT: true,
      MANUAL: false
    },
    autoExecute: false,
    minConfidence: 75
  }
}

function loadSettings(): SignalSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const x = JSON.parse(raw) as any
    const base = defaultSettings()
    const sources = { ...base.sources }
    for (const k of Object.keys(base.sources) as SignalSource[]) {
      sources[k] = Boolean(x?.sources?.[k] ?? base.sources[k])
    }
    return {
      sources,
      autoExecute: Boolean(x?.autoExecute ?? base.autoExecute),
      minConfidence: clampNumber(Number(x?.minConfidence ?? base.minConfidence), 0, 100)
    }
  } catch {
    return defaultSettings()
  }
}

function loadQueue(): IncomingSignal[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_QUEUE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((s: any): IncomingSignal | null => {
        const id = String(s?.id ?? "").trim()
        if (!id) return null
        const source = String(s?.source ?? "MANUAL") as SignalSource
        const createdAt = Number(s?.createdAt ?? Date.now())
        const symbol = String(s?.symbol ?? "").trim()
        const direction = (String(s?.direction ?? "LONG").toUpperCase() as SignalDirection) === "SHORT" ? "SHORT" : "LONG"
        const confidence = clampNumber(Number(s?.confidence ?? 0), 0, 100)
        const reason = String(s?.reason ?? "").trim()
        const executedAt = s?.executedAt ? Number(s.executedAt) : undefined
        const skippedAt = s?.skippedAt ? Number(s.skippedAt) : undefined
        const analysis = s?.analysis ? String(s.analysis) : undefined
        if (!symbol || !reason) return null
        return { id, source, createdAt, symbol, direction, confidence, reason, executedAt, skippedAt, analysis }
      })
      .filter(Boolean) as IncomingSignal[]
  } catch {
    return []
  }
}

function persist(settings: SignalSettings, queue: IncomingSignal[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(queue.slice(0, 200)))
}

function mergeQueue(local: IncomingSignal[], incoming: IncomingSignal[]): IncomingSignal[] {
  const byId = new Map<string, IncomingSignal>()
  for (const s of local) byId.set(s.id, s)
  for (const s of incoming) {
    if (!byId.has(s.id)) byId.set(s.id, s)
  }
  return Array.from(byId.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 200)
}

function analyzeLocally(sig: IncomingSignal): string {
  const c = sig.confidence
  const risk = c >= 85 ? "LOW" : c >= 70 ? "MEDIUM" : "HIGH"
  const bias = sig.direction === "LONG" ? "bullish" : "bearish"
  return `Signal looks ${bias}. Confidence ${c.toFixed(0)}% (${risk} risk). Check funding/open-interest before execution.`
}

async function sendTelegram(message: string) {
  await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  })
}

export default function SignalsPage() {
  const [settings, setSettings] = useState<SignalSettings>(() => defaultSettings())
  const [queue, setQueue] = useState<IncomingSignal[]>([])
  const [error, setError] = useState<string>("")

  const [manualSymbol, setManualSymbol] = useState("BTC-USDT")
  const [manualDir, setManualDir] = useState<SignalDirection>("LONG")
  const [manualConf, setManualConf] = useState(80)
  const [manualReason, setManualReason] = useState("")

  const autoExecRef = useRef({ settings, queue })
  useEffect(() => {
    autoExecRef.current = { settings, queue }
  }, [settings, queue])

  useEffect(() => {
    const s = loadSettings()
    const q = loadQueue()
    setSettings(s)
    setQueue(q)
  }, [])

  const pullServerQueue = async () => {
    try {
      const res = await fetch("/api/signals/queue", { cache: "no-store" })
      const json = (await res.json()) as any
      if (!json?.ok) return
      const arr = Array.isArray(json?.data) ? (json.data as IncomingSignal[]) : []
      if (arr.length) setQueue((prev) => mergeQueue(prev, arr))
    } catch {
      return
    }
  }

  const pullServerQueueRef = useRef(pullServerQueue)
  useEffect(() => {
    pullServerQueueRef.current = pullServerQueue
  })

  useEffect(() => {
    void pullServerQueueRef.current()
    const t = window.setInterval(() => void pullServerQueueRef.current(), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    persist(settings, queue)
  }, [settings, queue])

  const incoming = useMemo(() => queue.filter((s) => !s.executedAt && !s.skippedAt), [queue])

  const addSignal = (sig: Omit<IncomingSignal, "id" | "createdAt">) => {
    const full: IncomingSignal = { ...sig, id: nowId(), createdAt: Date.now() }
    setQueue((prev) => [full, ...prev].slice(0, 200))
  }

  const execute = useCallback(async (id: string) => {
    const sig = autoExecRef.current.queue.find((s) => s.id === id)
    if (!sig) return
    const text = `📡 <b>SIGNAL EXECUTE</b>
━━━━━━━━━━━━━━
${sig.symbol} ${sig.direction}
Source: ${sig.source}
Confidence: ${sig.confidence.toFixed(0)}%
Reason: ${sig.reason}`
    await sendTelegram(text).catch(() => undefined)
    setQueue((prev) => prev.map((s) => (s.id === id ? { ...s, executedAt: Date.now() } : s)))
  }, [])

  const executeRef = useRef(execute)
  useEffect(() => {
    executeRef.current = execute
  }, [execute])

  const skip = (id: string) => {
    setQueue((prev) => prev.map((s) => (s.id === id ? { ...s, skippedAt: Date.now() } : s)))
  }

  const analyze = (id: string) => {
    setQueue((prev) => prev.map((s) => (s.id === id ? { ...s, analysis: analyzeLocally(s) } : s)))
  }

  const fetchFearGreedSignal = async () => {
    setError("")
    try {
      const res = await fetch("/api/sentiment/fng", { cache: "no-store" })
      const json = (await res.json()) as any
      if (!json?.ok) throw new Error(json?.error ?? "Fear & Greed fetch failed")
      const valueRaw = json?.data?.data?.[0]?.value
      const value = Number(valueRaw)
      if (!Number.isFinite(value)) throw new Error("Invalid Fear & Greed value")
      if (value < 20) {
        addSignal({
          source: "FEAR_GREED",
          symbol: "BTC-USDT",
          direction: "LONG",
          confidence: 85,
          reason: `Fear & Greed ${value} (Extreme Fear)`,
          analysis: undefined
        })
      } else if (value > 80) {
        addSignal({
          source: "FEAR_GREED",
          symbol: "BTC-USDT",
          direction: "SHORT",
          confidence: 85,
          reason: `Fear & Greed ${value} (Extreme Greed)`,
          analysis: undefined
        })
      } else {
        setError(`Fear & Greed ${value} (no extreme signal)`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed"
      setError(msg)
    }
  }

  const fetchWhaleSignals = async () => {
    setError("")
    try {
      const res = await fetch("/api/whale/transactions?currency=btc&min_value=500000", { cache: "no-store" })
      const json = (await res.json()) as any
      if (!json?.ok) throw new Error(json?.error ?? "Whale fetch failed")
      const txs = Array.isArray(json?.data?.transactions) ? json.data.transactions : []
      const relevant = txs.slice(0, 5)
      for (const tx of relevant) {
        const amountUsd = Number(tx?.amount_usd ?? 0)
        const toExchange = String(tx?.to?.owner_type ?? "").toLowerCase().includes("exchange")
        const fromExchange = String(tx?.from?.owner_type ?? "").toLowerCase().includes("exchange")
        const direction: SignalDirection = toExchange ? "SHORT" : fromExchange ? "LONG" : "LONG"
        const reason = toExchange
          ? `Large exchange inflow ~$${Math.round(amountUsd).toLocaleString()}`
          : fromExchange
            ? `Large exchange outflow ~$${Math.round(amountUsd).toLocaleString()}`
            : `Large whale tx ~$${Math.round(amountUsd).toLocaleString()}`
        addSignal({
          source: "WHALE_ALERT",
          symbol: "BTC-USDT",
          direction,
          confidence: 78,
          reason
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed"
      setError(msg)
    }
  }

  useEffect(() => {
    if (!settings.autoExecute) return
    const doAuto = async () => {
      const { settings: s, queue: q } = autoExecRef.current
      const cand = q.find((x) => !x.executedAt && !x.skippedAt && x.confidence >= s.minConfidence)
      if (!cand) return
      await executeRef.current(cand.id)
    }
    void doAuto()
  }, [queue, settings.autoExecute, settings.minConfidence])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-1 text-lg font-semibold text-white">📡 SIGNAL CENTER</div>
        <div className="text-sm text-white/60">Aggregate signals and optionally auto-execute by confidence</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Section title="ACTIVE SOURCES">
            <div className="space-y-2">
              {(Object.keys(settings.sources) as SignalSource[]).map((k) => (
                <label key={k} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div className="text-sm text-white/80">{k.replace("_", " ")}</div>
                  <input
                    type="checkbox"
                    checked={settings.sources[k]}
                    onChange={(e) => setSettings((s) => ({ ...s, sources: { ...s.sources, [k]: e.target.checked } }))}
                  />
                </label>
              ))}
            </div>
          </Section>

          <Section title="AUTO-EXECUTE">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-sm text-white/80">Auto-execute</div>
              <input
                type="checkbox"
                checked={settings.autoExecute}
                onChange={(e) => setSettings((s) => ({ ...s, autoExecute: e.target.checked }))}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Min confidence</div>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.minConfidence}
                onChange={(e) => setSettings((s) => ({ ...s, minConfidence: clampNumber(Number(e.target.value), 0, 100) }))}
                className="w-full"
              />
              <div className="text-xs text-white/60">{settings.minConfidence.toFixed(0)}%</div>
            </label>
          </Section>

          <Section title="FETCH FREE SIGNALS">
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void fetchFearGreedSignal()}
              disabled={!settings.sources.FEAR_GREED}
            >
              Fetch Fear &amp; Greed
            </button>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void fetchWhaleSignals()}
              disabled={!settings.sources.WHALE_ALERT}
            >
              Fetch Whale Signals
            </button>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/40"
              disabled
            >
              News AI (Gemini) (requires API integration)
            </button>
            <button
              type="button"
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
              onClick={() => void pullServerQueue()}
              disabled={!settings.sources.TRADINGVIEW}
            >
              Pull TradingView Webhook Signals
            </button>
            {error ? <div className="text-xs text-red-400">{error}</div> : null}
          </Section>

          <Section title="MANUAL SIGNAL">
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Symbol</div>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={manualSymbol}
                onChange={(e) => setManualSymbol(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  manualDir === "LONG" ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={() => setManualDir("LONG")}
              >
                LONG
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  manualDir === "SHORT" ? "bg-[#00FF88]/20 text-[#00FF88]" : "bg-white/5 text-white/60 hover:text-white"
                }`}
                onClick={() => setManualDir("SHORT")}
              >
                SHORT
              </button>
            </div>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Confidence</div>
              <input
                type="number"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={manualConf}
                min={0}
                max={100}
                onChange={(e) => setManualConf(clampNumber(Number(e.target.value), 0, 100))}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-white/50">Reason</div>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder='e.g. "Breakout from range"'
              />
            </label>
            <button
              type="button"
              className="w-full rounded-lg bg-[#00FF88]/20 px-3 py-2 text-xs font-semibold text-[#00FF88]"
              onClick={() => {
                if (!settings.sources.MANUAL) return
                if (!manualSymbol.trim() || !manualReason.trim()) return
                addSignal({
                  source: "MANUAL",
                  symbol: manualSymbol.trim(),
                  direction: manualDir,
                  confidence: clampNumber(manualConf, 0, 100),
                  reason: manualReason.trim()
                })
                setManualReason("")
              }}
              disabled={!settings.sources.MANUAL}
            >
              Add Manual Signal
            </button>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={`INCOMING SIGNALS (${incoming.length})`}>
            {incoming.length ? (
              <div className="space-y-3">
                {incoming.slice(0, 30).map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">
                        {s.direction === "SHORT" ? "🔴" : "🟢"} {s.symbol} {s.direction}
                      </div>
                      <div className="flex items-center gap-2">
                        <Tag ok={true} text={`${s.source}`} />
                        <Tag ok={s.confidence >= settings.minConfidence} text={`${s.confidence.toFixed(0)}%`} />
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-white/70">{s.reason}</div>
                    {s.analysis ? <div className="mt-2 rounded-lg bg-black/40 p-3 text-xs text-white/70">{s.analysis}</div> : null}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="flex-1 rounded-lg bg-[#00FF88]/20 px-3 py-2 text-xs font-semibold text-[#00FF88]"
                        onClick={() => void execute(s.id)}
                      >
                        Execute
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
                        onClick={() => skip(s.id)}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
                        onClick={() => analyze(s.id)}
                      >
                        Analyze
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                No incoming signals yet. Use the fetch buttons or enable manual signals.
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
