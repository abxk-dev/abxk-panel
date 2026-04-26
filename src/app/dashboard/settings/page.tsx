"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useForm } from "react-hook-form"
import { useBotStore } from "@/store/botStore"
import type { ExecutionMode } from "@/types/bot"
import { useBranding } from "@/components/BrandingProvider"

type FormValues = {
  mode: ExecutionMode
  apiKey: string
  secretKey: string
}

export default function SettingsPage() {
  const settings = useBotStore((s) => s.settings)
  const setSettings = useBotStore((s) => s.setSettings)
  const [validation, setValidation] = useState<{ ok: boolean; message: string } | null>(null)
  const { logo, botName, tagline, updateBranding } = useBranding()
  const [draftLogo, setDraftLogo] = useState<string | null>(logo)
  const [draftName, setDraftName] = useState<string>(botName)
  const [draftTagline, setDraftTagline] = useState<string>(tagline)
  const [brandingSaved, setBrandingSaved] = useState<string | null>(null)

  useEffect(() => {
    setDraftLogo(logo)
    setDraftName(botName)
    setDraftTagline(tagline)
  }, [logo, botName, tagline])

  const defaults = useMemo<FormValues>(
    () => ({
      mode: settings.mode,
      apiKey: "",
      secretKey: ""
    }),
    [settings.mode]
  )

  const { register, handleSubmit, watch } = useForm<FormValues>({ defaultValues: defaults })
  const mode = watch("mode")

  const onSubmit = handleSubmit(async (values) => {
    setSettings({ mode: values.mode })

    if (values.apiKey.trim() && values.secretKey.trim()) {
      try {
        const res = await fetch("/api/bingx/validateKeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: values.apiKey.trim(), secretKey: values.secretKey.trim() })
        })
        if (!res.ok) {
          const text = await res.text()
          setValidation({ ok: false, message: text })
          return
        }
        setValidation({ ok: true, message: "Keys validated successfully (not stored)" })
      } catch (e) {
        setValidation({ ok: false, message: e instanceof Error ? e.message : "Validation failed" })
      }
    } else {
      setValidation({ ok: true, message: "Mode saved" })
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-white">Settings</div>
        <div className="text-sm text-white/60">Execution mode and BingX API configuration</div>
      </div>

      <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">Bot Branding</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3">
              <Field label="Logo">
                <div className="flex items-center gap-3">
                  {draftLogo ? (
                    <Image
                      src={draftLogo}
                      alt="Logo preview"
                      width={60}
                      height={60}
                      className="h-[60px] w-[60px] rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div
                      className="flex h-[60px] w-[60px] items-center justify-center font-mono text-[18px] font-bold"
                      style={{
                        background: "#0a0a0a",
                        border: "1.5px solid #00FF88",
                        borderRadius: 8,
                        color: "#00FF88"
                      }}
                    >
                      ▶
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        const v = typeof reader.result === "string" ? reader.result : ""
                        setDraftLogo(v || null)
                        setBrandingSaved(null)
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                </div>
              </Field>
              <Field label="Bot Name">
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={draftName}
                  onChange={(e) => {
                    setDraftName(e.target.value)
                    setBrandingSaved(null)
                  }}
                  placeholder="ABXK-BOT"
                />
              </Field>
              <Field label="Tagline">
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={draftTagline}
                  onChange={(e) => {
                    setDraftTagline(e.target.value)
                    setBrandingSaved(null)
                  }}
                  placeholder="Next.js + BingX Futures"
                />
              </Field>
            </div>

            <div className="grid gap-3">
              <div className="text-xs text-white/60">Live Preview:</div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="pointer-events-none">
                  <PreviewHeader logo={draftLogo} botName={draftName} tagline={draftTagline} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-brand/90"
                  onClick={() => {
                    updateBranding({
                      logo: draftLogo,
                      botName: draftName.trim() ? draftName.trim() : "ABXK-BOT",
                      tagline: draftTagline.trim() ? draftTagline.trim() : "Next.js + BingX Futures"
                    })
                    setBrandingSaved("Branding saved")
                  }}
                >
                  Save Branding
                </button>
                {brandingSaved ? <div className="text-xs text-emerald-400">{brandingSaved}</div> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">Execution</div>
          <div className="grid gap-3">
            <Field label="Mode">
              <select
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                {...register("mode")}
              >
                <option value="paper">Paper Trading</option>
                <option value="live">Live BingX Futures</option>
                <option value="mirror">Mirror (Paper + Live)</option>
              </select>
            </Field>
            <div className="text-xs text-white/50">
              Current: {mode.toUpperCase()} • Orders route: /openApi/swap/v2/trade/order
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">BingX API</div>
          <div className="grid gap-3">
            <Field label="API Key">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="password"
                autoComplete="off"
                placeholder="Enter to validate (not saved)"
                {...register("apiKey")}
              />
            </Field>
            <Field label="Secret Key">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="password"
                autoComplete="off"
                placeholder="Enter to validate (not saved)"
                {...register("secretKey")}
              />
            </Field>
            {validation ? (
              <div className={validation.ok ? "text-xs text-emerald-400" : "text-xs text-rose-400"}>
                {validation.message}
              </div>
            ) : (
              <div className="text-xs text-white/50">Keys are used server-side via environment variables.</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 text-sm font-semibold text-white">Feature Toggles</div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Toggle
              label="Market Regime Detector"
              checked={settings.features.marketRegime}
              onChange={(v) => setSettings({ features: { ...settings.features, marketRegime: v } })}
            />
            <Toggle
              label="Correlation Filter"
              checked={settings.features.correlationFilter}
              onChange={(v) => setSettings({ features: { ...settings.features, correlationFilter: v } })}
            />
            <Toggle
              label="AI Pattern Recognition"
              checked={settings.features.patternRecognition}
              onChange={(v) => setSettings({ features: { ...settings.features, patternRecognition: v } })}
            />
            <Toggle
              label="SMC (Order Blocks/FVG)"
              checked={settings.features.smc}
              onChange={(v) => setSettings({ features: { ...settings.features, smc: v } })}
            />
            <Toggle
              label="On-Chain Intelligence"
              checked={settings.features.onChain}
              onChange={(v) => setSettings({ features: { ...settings.features, onChain: v } })}
            />
            <Toggle
              label="Sentiment Engine"
              checked={settings.features.sentiment}
              onChange={(v) => setSettings({ features: { ...settings.features, sentiment: v } })}
            />
            <Toggle
              label="Disaster Recovery"
              checked={settings.features.disasterRecovery}
              onChange={(v) => setSettings({ features: { ...settings.features, disasterRecovery: v } })}
            />
            <Toggle
              label="Adaptive SL/TP"
              checked={settings.features.adaptiveLevels}
              onChange={(v) => setSettings({ features: { ...settings.features, adaptiveLevels: v } })}
            />
            <Toggle
              label="Opportunity Scanner"
              checked={settings.features.scanner}
              onChange={(v) => setSettings({ features: { ...settings.features, scanner: v } })}
            />
            <Toggle
              label="Liquidation Heatmap"
              checked={settings.features.liquidationHeatmap}
              onChange={(v) => setSettings({ features: { ...settings.features, liquidationHeatmap: v } })}
            />
            <Toggle
              label="Self-Learning Backtester"
              checked={settings.features.selfLearner}
              onChange={(v) => setSettings({ features: { ...settings.features, selfLearner: v } })}
            />
            <Toggle
              label="Pre-Trade Alerts"
              checked={settings.features.preTradeAlerts}
              onChange={(v) => setSettings({ features: { ...settings.features, preTradeAlerts: v } })}
            />
            <Toggle
              label="Market Monitor"
              checked={settings.features.marketMonitor}
              onChange={(v) => setSettings({ features: { ...settings.features, marketMonitor: v } })}
            />
            <Toggle
              label="Journal"
              checked={settings.features.journal}
              onChange={(v) => setSettings({ features: { ...settings.features, journal: v } })}
            />
            <Toggle
              label="Partial Profit Lock"
              checked={settings.features.partialProfitLock}
              onChange={(v) => setSettings({ features: { ...settings.features, partialProfitLock: v } })}
            />
            <Toggle
              label="Projection"
              checked={settings.features.projection}
              onChange={(v) => setSettings({ features: { ...settings.features, projection: v } })}
            />
            <Toggle
              label="News Filter"
              checked={settings.features.newsFilter}
              onChange={(v) => setSettings({ features: { ...settings.features, newsFilter: v } })}
            />
            <Toggle
              label="Exchange Health Check"
              checked={settings.features.healthCheck}
              onChange={(v) => setSettings({ features: { ...settings.features, healthCheck: v } })}
            />
            <Toggle
              label="Whale Alerts"
              checked={settings.features.whaleAlert}
              onChange={(v) => setSettings({ features: { ...settings.features, whaleAlert: v } })}
            />
          </div>

          {settings.features.partialProfitLock ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Field label={`Partial lock trigger (${settings.partialProfitLock.triggerPctOfLevelTarget}%)`}>
                <input
                  className="w-full"
                  type="range"
                  min={30}
                  max={70}
                  value={settings.partialProfitLock.triggerPctOfLevelTarget}
                  onChange={(e) =>
                    setSettings({
                      partialProfitLock: {
                        ...settings.partialProfitLock,
                        triggerPctOfLevelTarget: Number(e.target.value)
                      }
                    })
                  }
                />
              </Field>
              <Field label={`Lock amount (${settings.partialProfitLock.lockPctOfProfitSoFar}%)`}>
                <input
                  className="w-full"
                  type="range"
                  min={25}
                  max={50}
                  value={settings.partialProfitLock.lockPctOfProfitSoFar}
                  onChange={(e) =>
                    setSettings({
                      partialProfitLock: {
                        ...settings.partialProfitLock,
                        lockPctOfProfitSoFar: Number(e.target.value)
                      }
                    })
                  }
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-6 mb-3 text-sm font-semibold text-white">Telegram Notifications</div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Toggle
              label="Regime Alerts"
              checked={settings.notifications.regime}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, regime: v } })}
            />
            <Toggle
              label="Correlation Alerts"
              checked={settings.notifications.correlation}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, correlation: v } })}
            />
            <Toggle
              label="Pattern Alerts"
              checked={settings.notifications.patternRecognition}
              onChange={(v) =>
                setSettings({ notifications: { ...settings.notifications, patternRecognition: v } })
              }
            />
            <Toggle
              label="SMC Alerts"
              checked={settings.notifications.smc}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, smc: v } })}
            />
            <Toggle
              label="On-Chain Alerts"
              checked={settings.notifications.onChain}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, onChain: v } })}
            />
            <Toggle
              label="Sentiment Alerts"
              checked={settings.notifications.sentiment}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, sentiment: v } })}
            />
            <Toggle
              label="Recovery Alerts"
              checked={settings.notifications.disasterRecovery}
              onChange={(v) =>
                setSettings({ notifications: { ...settings.notifications, disasterRecovery: v } })
              }
            />
            <Toggle
              label="Scanner Alerts"
              checked={settings.notifications.scanner}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, scanner: v } })}
            />
            <Toggle
              label="Self-Learner Alerts"
              checked={settings.notifications.selfLearner}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, selfLearner: v } })}
            />
            <Toggle
              label="Heatmap Alerts"
              checked={settings.notifications.liquidationHeatmap}
              onChange={(v) =>
                setSettings({ notifications: { ...settings.notifications, liquidationHeatmap: v } })
              }
            />
            <Toggle
              label="Journal Alerts"
              checked={settings.notifications.journal}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, journal: v } })}
            />
            <Toggle
              label="Pre-Trade Alerts"
              checked={settings.notifications.preTrade}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, preTrade: v } })}
            />
            <Toggle
              label="Market Monitor Alerts"
              checked={settings.notifications.marketMonitor}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, marketMonitor: v } })}
            />
            <Toggle
              label="Projection Alerts"
              checked={settings.notifications.projection}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, projection: v } })}
            />
            <Toggle
              label="Partial Lock Alerts"
              checked={settings.notifications.partialProfitLock}
              onChange={(v) =>
                setSettings({ notifications: { ...settings.notifications, partialProfitLock: v } })
              }
            />
            <Toggle
              label="Health Alerts"
              checked={settings.notifications.health}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, health: v } })}
            />
            <Toggle
              label="Whale Alerts"
              checked={settings.notifications.whale}
              onChange={(v) => setSettings({ notifications: { ...settings.notifications, whale: v } })}
            />
          </div>
        </div>

        <div className="lg:col-span-2 flex items-center gap-3">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-brand/90" type="submit">
            Save
          </button>
          <div className="text-xs text-white/50">
            BINGX_API_KEY and BINGX_SECRET_KEY must be set for live requests.
          </div>
        </div>
      </form>
    </div>
  )
}

function PreviewHeader({ logo, botName, tagline }: { logo: string | null; botName: string; tagline: string }) {
  const parts = splitName(botName || "ABXK-BOT")
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
            <span>{parts.head}</span>
            {parts.tail !== null ? (
              <>
                <span style={{ color: "#ffffff" }}>-</span>
                <span>{parts.tail}</span>
              </>
            ) : null}
          </span>
          <span className="blink-cursor" style={{ color: "#00FF88" }}>
            |
          </span>
        </div>
        <div className="font-mono text-[11px]" style={{ color: "#666666" }}>
          {`> ${(tagline || "Next.js + BingX Futures")}_`}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-white/60">{label}</div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
      <div className="text-sm text-white/80">{label}</div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
