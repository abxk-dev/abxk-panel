"use client"

import { useBotStore } from "@/store/botStore"

export function RiskControls() {
  const settings = useBotStore((s) => s.settings)
  const setSettings = useBotStore((s) => s.setSettings)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Capital & Compounding</div>
        <div className="grid gap-3">
          <Field label="Initial Capital (USD)">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.capital.initialCapitalUsd}
              min={0}
              step={1}
              onChange={(e) =>
                setSettings({ capital: { initialCapitalUsd: Number(e.target.value) } })
              }
            />
          </Field>

          <Field label="Trades per Day (Max)">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.maxTradesPerDay}
              min={1}
              max={100}
              step={1}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value))
                setSettings({ maxTradesPerDay: Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 1 })
              }}
            />
          </Field>

          <Field label="Levels">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.compounding.levels}
              min={1}
              max={50}
              step={1}
              onChange={(e) =>
                setSettings({ compounding: { ...settings.compounding, levels: Number(e.target.value) } })
              }
            />
          </Field>

          <Field label="Profit Target % per Level">
            <input
              className="w-full"
              type="range"
              min={1}
              max={100}
              value={settings.compounding.profitTargetPct}
              onChange={(e) =>
                setSettings({
                  compounding: { ...settings.compounding, profitTargetPct: Number(e.target.value) }
                })
              }
            />
            <div className="text-xs text-white/60">{settings.compounding.profitTargetPct}%</div>
          </Field>

          <Field label="Risk % of Balance per Trade">
            <input
              className="w-full"
              type="range"
              min={1}
              max={50}
              value={settings.compounding.riskPctOfBalance}
              onChange={(e) =>
                setSettings({
                  compounding: { ...settings.compounding, riskPctOfBalance: Number(e.target.value) }
                })
              }
            />
            <div className="text-xs text-white/60">{settings.compounding.riskPctOfBalance}%</div>
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Risk Management</div>
        <div className="grid gap-3">
          <Field label="Leverage">
            <input
              className="w-full"
              type="range"
              min={1}
              max={50}
              value={settings.risk.leverage}
              onChange={(e) => setSettings({ risk: { ...settings.risk, leverage: Number(e.target.value) } })}
            />
            <div className="text-xs text-white/60">{settings.risk.leverage}x</div>
          </Field>

          <Field label="Stop Loss Mode">
            <select
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              value={settings.risk.slMode}
              onChange={(e) => setSettings({ risk: { ...settings.risk, slMode: e.target.value as any } })}
            >
              <option value="fixedPct">Fixed %</option>
              <option value="atr">ATR</option>
            </select>
          </Field>

          {settings.risk.slMode === "fixedPct" ? (
            <Field label="Stop Loss Fixed %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.risk.slFixedPct}
                min={0.1}
                step={0.1}
                onChange={(e) =>
                  setSettings({ risk: { ...settings.risk, slFixedPct: Number(e.target.value) } })
                }
              />
            </Field>
          ) : (
            <Field label="Stop Loss ATR Multiplier">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.risk.slAtrMultiplier}
                min={0.1}
                step={0.1}
                onChange={(e) =>
                  setSettings({ risk: { ...settings.risk, slAtrMultiplier: Number(e.target.value) } })
                }
              />
            </Field>
          )}

          <Field label="Take Profit Mode">
            <select
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              value={settings.risk.tpMode}
              onChange={(e) => setSettings({ risk: { ...settings.risk, tpMode: e.target.value as any } })}
            >
              <option value="fixedPct">Fixed %</option>
              <option value="rr">RR</option>
            </select>
          </Field>

          {settings.risk.tpMode === "fixedPct" ? (
            <Field label="Take Profit Fixed %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.risk.tpFixedPct}
                min={0.1}
                step={0.1}
                onChange={(e) =>
                  setSettings({ risk: { ...settings.risk, tpFixedPct: Number(e.target.value) } })
                }
              />
            </Field>
          ) : (
            <Field label="RR Ratio (1 : X)">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.risk.rrRatio}
                min={0.1}
                step={0.1}
                onChange={(e) => setSettings({ risk: { ...settings.risk, rrRatio: Number(e.target.value) } })}
              />
            </Field>
          )}

          <Field label="Trailing Stop">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={settings.risk.trailingStopEnabled}
                onChange={(e) =>
                  setSettings({ risk: { ...settings.risk, trailingStopEnabled: e.target.checked } })
                }
              />
              Enabled
            </label>
          </Field>

          <Field label="Trailing Activation %">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.risk.trailingActivationPct}
              min={0}
              step={0.1}
              onChange={(e) =>
                setSettings({ risk: { ...settings.risk, trailingActivationPct: Number(e.target.value) } })
              }
            />
          </Field>

          <Field label="Daily Loss Limit (USD)">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.risk.dailyLossLimitUsd}
              min={0}
              step={1}
              onChange={(e) =>
                setSettings({ risk: { ...settings.risk, dailyLossLimitUsd: Number(e.target.value) } })
              }
            />
          </Field>

          <Field label="Max Drawdown %">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.risk.maxDrawdownPct}
              min={0}
              max={100}
              step={1}
              onChange={(e) =>
                setSettings({ risk: { ...settings.risk, maxDrawdownPct: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-white/60">{label}</div>
      {children}
    </div>
  )
}
