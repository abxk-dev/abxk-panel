import { GridVaultPage } from "@/components/gridvault/GridVaultPage"

function envBool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback
  const s = v.trim().toLowerCase()
  if (s === "true" || s === "1" || s === "yes") return true
  if (s === "false" || s === "0" || s === "no") return false
  return fallback
}

function envNumber(v: string | undefined, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function GridVaultRoute() {
  const enabled = envBool(process.env.GRID_VAULT_ENABLED, false)
  const defaultSymbol = process.env.GRID_DEFAULT_SYMBOL ?? process.env.DEFAULT_SYMBOL ?? "BTC-USDT"
  const defaultLeverage = envNumber(process.env.GRID_DEFAULT_LEVERAGE, 3)
  const defaultLevels = envNumber(process.env.GRID_DEFAULT_LEVELS, 6)
  const telegramUpdates = envBool(process.env.GRID_TELEGRAM_UPDATES, true)
  const hourlyUpdates = envBool(process.env.GRID_HOURLY_UPDATES, true)

  return (
    <GridVaultPage
      defaults={{
        enabled,
        defaultSymbol,
        defaultLeverage,
        defaultLevels,
        telegramUpdates,
        hourlyUpdates
      }}
    />
  )
}

