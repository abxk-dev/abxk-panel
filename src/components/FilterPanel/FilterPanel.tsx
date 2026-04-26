"use client"

import { useBotStore } from "@/store/botStore"
import type { FilterKey } from "@/types/bot"

const labels: Record<FilterKey, string> = {
  trendEma: "Trend confirmation (EMA 20/50/200)",
  volumeSpike: "Volume spike (1.5x avg)",
  atrVolatility: "ATR volatility (within thresholds)",
  rsi: "RSI filter (40-60 band + direction)",
  macd: "MACD confirmation (crossover)",
  bbSqueeze: "Bollinger squeeze (bandwidth < avg)",
  fibGoldenPocket: "Fibonacci golden pocket (50-61.8%)",
  stochRsi: "Stoch RSI signal (3,3,14,14)",
  macdDivergence: "MACD divergence (regular/hidden)",
  openInterest: "Open interest change (4H)",
  liquidity: "Liquidity check (spread + depth)",
  fundingRate: "Funding rate favorable",
  fundingHardBlock: "Funding hard block (skip crowded longs)",
  session: "London/NY overlap only",
  htfDailyBias: "HTF daily bias alignment",
  newsBlackout: "News blackout (± window)",
  oiDivergence: "OI divergence block (price up + OI down)",
  fearGreed: "Fear & Greed directional constraint",
  liquidationTp: "Liquidation cluster TP targeting (Coinglass)"
}

export function FilterPanel() {
  const settings = useBotStore((s) => s.settings)
  const toggleFilter = useBotStore((s) => s.toggleFilter)
  const setSettings = useBotStore((s) => s.setSettings)
  const snapshot = useBotStore((s) => s.strategySnapshot)
  const lastScanResult = useBotStore((s) => s.lastScanResult)
  const scannerLastScanAt = useBotStore((s) => s.scannerLastScanAt)
  const runBotCycle = useBotStore((s) => s.runBotCycle)

  const liveScore = snapshot?.totalScore && snapshot.totalScore > 0 ? snapshot.totalScore : lastScanResult?.score ?? 0
  const liveAsOf = snapshot?.asOf ?? scannerLastScanAt

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-white">Strategy Controls</div>
          <button
            className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-black hover:bg-brand/90"
            onClick={() => void runBotCycle()}
          >
            Run Scan Now
          </button>
        </div>

        <div className="grid gap-3">
          <Field label="Timeframe">
            <select
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              value={settings.timeframe}
              onChange={(e) => setSettings({ timeframe: e.target.value as any })}
            >
              <option value="15m">15M (Scalping)</option>
              <option value="1h">1H (Intraday Fast)</option>
              <option value="4h">4H (Intraday)</option>
              <option value="1d">1D (Swing)</option>
            </select>
          </Field>

          <Field label="Symbol">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              value={settings.symbol}
              onChange={(e) => setSettings({ symbol: e.target.value })}
              placeholder="BTC-USDT"
            />
          </Field>

          <Field label="Min Setup Score (0-100)">
            <input
              className="w-full"
              type="range"
              min={0}
              max={100}
              value={settings.minSetupScore}
              onChange={(e) => setSettings({ minSetupScore: Number(e.target.value) })}
            />
            <div className="text-xs text-white/60">{settings.minSetupScore}/100</div>
          </Field>

          <Field label="Setup Score (live)">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-sm text-white">{liveScore}/100</div>
              <div className="text-xs text-white/50">{liveAsOf ? new Date(liveAsOf).toUTCString() : ""}</div>
            </div>
            {snapshot?.blocked && snapshot.blocks.length ? (
              <div className="text-xs text-rose-400">{snapshot.blocks.join(" • ")}</div>
            ) : null}
            {snapshot?.reasons?.length ? (
              <div className="text-xs text-white/50">{snapshot.reasons.join(" • ")}</div>
            ) : null}
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Smart Filters</div>
        <div className="grid gap-2">
          {(Object.keys(settings.filters) as FilterKey[]).map((key) => (
            <label key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-xs text-white/80">{labels[key]}</div>
              <input type="checkbox" checked={settings.filters[key]} onChange={() => toggleFilter(key)} />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Thresholds</div>
          <Field label="Volume Spike Multiplier">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              type="number"
              value={settings.thresholds.volumeSpikeMultiplier}
              min={1}
              step={0.1}
              onChange={(e) =>
                setSettings({
                  thresholds: { ...settings.thresholds, volumeSpikeMultiplier: Number(e.target.value) }
                })
              }
            />
          </Field>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="ATR Min">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.atrMin}
                min={0}
                step={1}
                onChange={(e) =>
                  setSettings({ thresholds: { ...settings.thresholds, atrMin: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="ATR Max">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.atrMax}
                min={0}
                step={1}
                onChange={(e) =>
                  setSettings({ thresholds: { ...settings.thresholds, atrMax: Number(e.target.value) } })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Max Spread %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.maxSpreadPct}
                min={0}
                step={0.01}
                onChange={(e) =>
                  setSettings({ thresholds: { ...settings.thresholds, maxSpreadPct: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="Max Funding Rate %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.maxFundingRatePct}
                min={0}
                step={0.001}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, maxFundingRatePct: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Funding Hard Block %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.fundingHardBlockPct}
                min={0}
                step={0.001}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, fundingHardBlockPct: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="BB Squeeze % of Avg">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.bbSqueezePctOfAvg}
                min={0.1}
                step={0.05}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, bbSqueezePctOfAvg: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Fib Lookback Candles">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.fibLookbackCandles}
                min={20}
                step={1}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, fibLookbackCandles: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="News Blackout Minutes">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.newsBlackoutMinutes}
                min={0}
                step={1}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, newsBlackoutMinutes: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Fear&Greed Long-Only Below">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.fearGreedLongOnlyBelow}
                min={0}
                max={100}
                step={1}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, fearGreedLongOnlyBelow: Number(e.target.value) }
                  })
                }
              />
            </Field>
            <Field label="Fear&Greed Short-Only Above">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.fearGreedShortOnlyAbove}
                min={0}
                max={100}
                step={1}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, fearGreedShortOnlyAbove: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Liquidation Exchange">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                value={settings.thresholds.liquidationExchange}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, liquidationExchange: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Liquidation Range">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                value={settings.thresholds.liquidationRange}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, liquidationRange: e.target.value }
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Liquidation Symbol">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                value={settings.thresholds.liquidationSymbol}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, liquidationSymbol: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="TP Offset %">
              <input
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                type="number"
                value={settings.thresholds.liquidationTpOffsetPct}
                min={0}
                step={0.05}
                onChange={(e) =>
                  setSettings({
                    thresholds: { ...settings.thresholds, liquidationTpOffsetPct: Number(e.target.value) }
                  })
                }
              />
            </Field>
          </div>
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
