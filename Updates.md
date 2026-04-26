Add a new trading module called "GRID VAULT" 
as a completely separate section in the bot.

═══════════════════════════════════════
SIDEBAR — Add new item
═══════════════════════════════════════

Add to sidebar navigation:
icon: 🔲
label: Grid Vault
path: /dashboard/grid-vault

═══════════════════════════════════════
PART 1 — PAGE LAYOUT
/app/dashboard/grid-vault/page.tsx
═══════════════════════════════════════

Page title: GRID VAULT
Subtitle: Consistent Growth Engine

Tabs on page:
[Overview] [Spot Grid] [Futures Grid] [Calculator] [History]

═══════════════════════════════════════
PART 2 — OVERVIEW TAB
═══════════════════════════════════════

Show 4 metric cards at top:

Card 1: Starting Capital
Card 2: Current Value (live)
Card 3: Total Profit
Card 4: Active Grids

Below metrics — two panels side by side:

LEFT PANEL — Active Grids:
┌─────────────────────────────────────┐
│ ACTIVE GRIDS                        │
│                                     │
│ BTC Spot Grid                       │
│ Range: $78,000 - $90,000           │
│ Cycles: 12 | Profit: +$48.20      │
│ Status: 🟢 RUNNING                  │
│                                     │
│ BTC Futures 3x Grid                 │
│ Range: $78,000 - $90,000           │
│ Cycles: 8 | Profit: +$84.60       │
│ Status: 🟢 RUNNING                  │
└─────────────────────────────────────┘

RIGHT PANEL — Growth Chart:
Equity curve showing capital growth
Line chart using Recharts
X axis: dates
Y axis: total vault value

═══════════════════════════════════════
PART 3 — SPOT GRID TAB
═══════════════════════════════════════

// /components/gridvault/SpotGridPanel.tsx

UI Layout:
┌─────────────────────────────────────┐
│ ⚙️ SPOT GRID SETTINGS               │
│                                     │
│ Symbol:        [BTC-USDT ▾]        │
│ Capital ($):   [________] input    │
│ Upper Price:   [________] input    │
│ Lower Price:   [________] input    │
│ Grid Levels:   [____] slider 2-20  │
│ Mode:          [PAPER] [LIVE]      │
│                                     │
│ AUTO CALCULATE:                     │
│ Grid interval: $2,000 (auto)       │
│ Profit/grid:   2.38% (auto)        │
│ Amount/level:  $166 (auto)         │
│                                     │
│ ESTIMATED RETURNS:                  │
│ Per cycle:   $4.40                 │
│ Daily (avg): $13.20                │
│ Monthly:     $396                  │
│                                     │
│ [▶ START SPOT GRID] [■ STOP]       │
└─────────────────────────────────────┘

Below settings — Grid Visualization:
Show price ladder as vertical bar:

╔═══════════════╗
║ $90,000 SELL  ║ ← green
║ $88,800 SELL  ║ ← green  
║ $87,600 SELL  ║ ← green
║───────────────║
║ $84,000 NOW ◄ ║ ← blue (current price)
║───────────────║
║ $82,800 BUY   ║ ← red
║ $81,600 BUY   ║ ← red
║ $78,000 BUY   ║ ← red
╚═══════════════╝

Each level shows:
- Price
- Order type (BUY/SELL)
- Status (FILLED / PENDING / ACTIVE)
- Profit from this level if filled

// Grid calculation logic:

interface SpotGridConfig {
  symbol: string
  capital: number
  upperPrice: number
  lowerPrice: number
  gridLevels: number
  mode: 'paper' | 'live'
}

interface GridLevel {
  price: number
  type: 'BUY' | 'SELL'
  amount: number
  quantity: number
  status: 'PENDING' | 'FILLED' | 'ACTIVE'
  orderId: string | null
  filledAt: number | null
  profit: number
}

function calculateGridLevels(config: SpotGridConfig): GridLevel[] {
  const { upperPrice, lowerPrice, gridLevels, capital } = config
  const interval = (upperPrice - lowerPrice) / gridLevels
  const amountPerLevel = capital / gridLevels
  const levels: GridLevel[] = []

  for (let i = 0; i <= gridLevels; i++) {
    const price = lowerPrice + (interval * i)
    levels.push({
      price: Math.round(price),
      type: 'BUY',  // will be updated based on current price
      amount: amountPerLevel,
      quantity: amountPerLevel / price,
      status: 'PENDING',
      orderId: null,
      filledAt: null,
      profit: 0
    })
  }
  return levels
}

function calculateGridStats(config: SpotGridConfig) {
  const interval = (config.upperPrice - config.lowerPrice) / config.gridLevels
  const profitPerGrid = interval / config.upperPrice * 100
  const amountPerLevel = config.capital / config.gridLevels
  const profitPerCycle = amountPerLevel * (profitPerGrid / 100)

  return {
    interval,
    profitPerGridPercent: profitPerGrid.toFixed(3),
    amountPerLevel: amountPerLevel.toFixed(2),
    profitPerCycle: profitPerCycle.toFixed(4),
    dailyProfitConservative: (profitPerCycle * 1.5).toFixed(4),
    dailyProfitAverage: (profitPerCycle * 3.5).toFixed(4),
    monthlyConservative: (profitPerCycle * 1.5 * 30).toFixed(2),
    monthlyAverage: (profitPerCycle * 3.5 * 30).toFixed(2),
  }
}

// Paper grid simulation:
// Monitor price via WebSocket
// When price crosses a level:
// - Mark level as FILLED
// - Create opposite order at next level
// - Calculate profit
// - Update stats

async function runPaperSpotGrid(
  config: SpotGridConfig,
  levels: GridLevel[]
) {
  // Subscribe to BTC price via WebSocket
  // On each price update:
  const currentPrice = await getLivePrice(config.symbol)

  for (const level of levels) {
    // BUY order filled (price dropped to level)
    if (level.type === 'BUY' &&
        level.status === 'PENDING' &&
        currentPrice <= level.price) {
      level.status = 'FILLED'
      level.filledAt = Date.now()

      // Place SELL at next level up
      const nextLevel = levels.find(l => l.price > level.price)
      if (nextLevel) {
        nextLevel.type = 'SELL'
        nextLevel.status = 'ACTIVE'
      }

      await sendTelegram(`
🔲 [SPOT GRID] BUY FILLED
━━━━━━━━━━━━━━
Symbol: ${config.symbol}
Bought at: $${level.price.toLocaleString()}
Amount: $${level.amount.toFixed(2)}
Qty: ${level.quantity.toFixed(6)} BTC
Next sell: $${nextLevel?.price.toLocaleString()}
Mode: ${config.mode.toUpperCase()}
      `)
    }

    // SELL order filled (price rose to level)
    if (level.type === 'SELL' &&
        level.status === 'ACTIVE' &&
        currentPrice >= level.price) {
      const buyLevel = levels.find(
        l => l.type === 'BUY' &&
        l.status === 'FILLED' &&
        l.price < level.price
      )
      const profit = buyLevel
        ? (level.price - buyLevel.price) * level.quantity
        : 0

      level.status = 'FILLED'
      level.profit = profit

      // Reset buy level for next cycle
      if (buyLevel) {
        buyLevel.status = 'PENDING'
      }

      updateGridStats({ profit, cycleComplete: true })

      await sendTelegram(`
✅ [SPOT GRID] CYCLE COMPLETE
━━━━━━━━━━━━━━
Bought: $${buyLevel?.price.toLocaleString()}
Sold:   $${level.price.toLocaleString()}
Profit: +$${profit.toFixed(4)}
Total cycles: ${getTotalCycles()}
Total profit: +$${getTotalGridProfit().toFixed(4)}
Mode: ${config.mode.toUpperCase()}
      `)
    }
  }
}

═══════════════════════════════════════
PART 4 — FUTURES GRID TAB
═══════════════════════════════════════

// /components/gridvault/FuturesGridPanel.tsx

UI Layout:
┌─────────────────────────────────────┐
│ ⚡ FUTURES GRID SETTINGS             │
│                                     │
│ Symbol:        [BTC-USDT ▾]        │
│ Capital ($):   [________] input    │
│ Leverage:      [3x] [5x] [10x]    │
│ Position:      $300 (auto calc)    │
│ Upper Price:   [________] input    │
│ Lower Price:   [________] input    │
│ Grid Levels:   [____] slider 2-20  │
│ Direction:     [NEUTRAL ▾]         │
│   Options: NEUTRAL / LONG / SHORT  │
│ Mode:          [PAPER] [LIVE]      │
│                                     │
│ RISK DISPLAY:                       │
│ ⚠️ Liquidation price: $56,000      │
│ Distance to liq: -33.3%            │
│ Status: SAFE ✅                     │
│                                     │
│ ESTIMATED RETURNS:                  │
│ Per cycle (3x):  $1.32             │
│ Daily (avg):     $3.96             │
│ Monthly:         $118.80           │
│                                     │
│ [▶ START FUTURES GRID] [■ STOP]    │
└─────────────────────────────────────┘

// Liquidation calculator:
function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
): LiquidationInfo {
  const liqDistance = 1 / leverage
  const liqPriceLong  = entryPrice * (1 - liqDistance)
  const liqPriceShort = entryPrice * (1 + liqDistance)
  const distancePercent = liqDistance * 100

  let riskLevel = 'SAFE'
  let riskColor = 'green'
  if (distancePercent < 15) { riskLevel = 'DANGER'; riskColor = 'red' }
  else if (distancePercent < 25) { riskLevel = 'CAUTION'; riskColor = 'yellow' }

  return {
    liqPriceLong,
    liqPriceShort,
    distancePercent,
    riskLevel,
    riskColor,
    message: `BTC must drop ${distancePercent.toFixed(1)}% to liquidate`
  }
}

// Futures grid profit calculation:
function calculateFuturesGridStats(
  config: SpotGridConfig,
  leverage: number
) {
  const baseStats = calculateGridStats(config)
  return {
    ...baseStats,
    positionSize: config.capital * leverage,
    profitPerCycle: parseFloat(baseStats.profitPerCycle) * leverage,
    monthlyConservative: parseFloat(baseStats.monthlyConservative) * leverage,
    monthlyAverage: parseFloat(baseStats.monthlyAverage) * leverage,
    leverage,
    liquidationInfo: calculateLiquidationPrice(
      (config.upperPrice + config.lowerPrice) / 2,
      leverage,
      'NEUTRAL'
    )
  }
}

// Leverage comparison table (show in UI):
// Auto-calculate for current settings:
function getLeverageComparison(baseStats: any, capital: number) {
  return [1, 3, 5, 10].map(lev => ({
    leverage: `${lev}x`,
    position: `$${capital * lev}`,
    perCycle: `$${(parseFloat(baseStats.profitPerCycle) * lev).toFixed(4)}`,
    monthly: `$${(parseFloat(baseStats.monthlyAverage) * lev).toFixed(2)}`,
    liqDistance: `${(100/lev).toFixed(0)}%`,
    risk: lev <= 3 ? 'LOW' : lev <= 5 ? 'MEDIUM' : 'HIGH'
  }))
}

Show as table in UI:
Lev | Position | Per Cycle | Monthly | Liq Distance | Risk
1x  | $100     | $0.44     | $46     | -100% (never)| LOW
3x  | $300     | $1.32     | $138    | -33%         | LOW
5x  | $500     | $2.20     | $231    | -20%         | MEDIUM
10x | $1000    | $4.40     | $462    | -10%         | HIGH

═══════════════════════════════════════
PART 5 — CALCULATOR TAB
═══════════════════════════════════════

// /components/gridvault/GridCalculator.tsx

Interactive profit calculator:

INPUTS:
- Capital: $[100] slider $10-$10,000
- Leverage: [1x] [3x] [5x] [10x]
- Daily cycles: [1] [2] [3] [4] [5] [6]
- Compound: [ON/OFF]
- Months: [1] [3] [6] [12]

OUTPUTS (update live as inputs change):

WITHOUT COMPOUNDING:
Month 1:  $100 → $160  (+$60)
Month 3:  $100 → $280  (+$180)
Month 6:  $100 → $460  (+$360)
Month 12: $100 → $820  (+$720)

WITH COMPOUNDING:
Month 1:  $100 → $160   (+$60)
Month 3:  $100 → $410   (+$310)
Month 6:  $100 → $1,680 (+$1,580)
Month 12: $100 → $28,000(+$27,900)

Show as line chart:
- Blue line: without compounding
- Green line: with compounding
- X axis: months
- Y axis: capital value

Also show:
Daily profit: $2.00
Weekly:       $14.00
Monthly:      $60.00
Break even:   immediate (grid always earns)

// Compound calculation:
function calculateCompoundGrowth(
  capital: number,
  monthlyReturnPercent: number,
  months: number,
  compound: boolean
): GrowthData[] {
  const results: GrowthData[] = []
  let current = capital

  for (let m = 1; m <= months; m++) {
    if (compound) {
      current = current * (1 + monthlyReturnPercent / 100)
    } else {
      current = capital + (capital * monthlyReturnPercent / 100 * m)
    }
    results.push({
      month: m,
      value: parseFloat(current.toFixed(2)),
      profit: parseFloat((current - capital).toFixed(2)),
      returnPercent: parseFloat(((current - capital) / capital * 100).toFixed(1))
    })
  }
  return results
}

═══════════════════════════════════════
PART 6 — HISTORY TAB
═══════════════════════════════════════

Show table of all completed grid cycles:

Columns:
Time | Type | Buy Price | Sell Price | Profit | Cumulative

Row example:
14:32 | SPOT  | $82,800 | $84,800 | +$4.40  | +$48.40
12:15 | FUT3x | $83,200 | $84,800 | +$3.96  | +$44.00

Stats above table:
Total cycles: 24
Total profit: +$132.40
Best cycle: +$8.20
Avg cycle: +$5.52
Win rate: 100% (grid always profits on cycle)

═══════════════════════════════════════
PART 7 — TELEGRAM NOTIFICATIONS
═══════════════════════════════════════

On grid start:
🔲 GRID VAULT STARTED
━━━━━━━━━━━━━━
Type: Futures 3x
Symbol: BTC-USDT
Capital: $100
Position: $300
Range: $78,000 - $90,000
Levels: 6
Mode: PAPER
━━━━━━━━━━━━━━
Per cycle profit: $1.32
Daily estimate: $3.96
Monthly estimate: $118.80
Liq price: $56,000 (-33%)
Risk: LOW ✅

On cycle complete:
✅ GRID CYCLE COMPLETE
━━━━━━━━━━━━━━
BTC Futures 3x
Buy: $82,800 → Sell: $85,200
Gross profit: +$1.32
Total cycles: 8
Total profit: +$10.56
Capital: $100 → $110.56

Hourly update (if active):
📊 GRID HOURLY UPDATE
━━━━━━━━━━━━━━
BTC: $84,250
Grid: ACTIVE ✅
Cycles today: 3
Today profit: +$3.96
Total profit: +$18.40
Nearest buy: $82,800
Nearest sell: $85,200

Daily summary (11 PM):
📊 GRID DAILY REPORT
━━━━━━━━━━━━━━
Date: DD/MM/YYYY
Cycles: 4
Daily profit: +$5.28
Total profit: +$24.00
Capital: $100 → $124.00 (+24%)
Est monthly: $118.80

On liquidation warning:
🚨 GRID VAULT WARNING
━━━━━━━━━━━━━━
BTC price approaching danger zone
Current: $70,000
Liq price: $56,000
Distance: -20% remaining
Action: Consider reducing leverage

═══════════════════════════════════════
PART 8 — STATE MANAGEMENT
/lib/gridVaultState.ts
═══════════════════════════════════════

interface GridVaultState {
  spotGrids: SpotGrid[]
  futuresGrids: FuturesGrid[]
  totalCapital: number
  totalProfit: number
  totalCycles: number
  startDate: number
  profitHistory: ProfitEntry[]
  settings: GridVaultSettings
}

Save to localStorage: 'grid_vault_state'
Update on every cycle complete
Persist across sessions

═══════════════════════════════════════
PART 9 — AUTO PRICE SUGGESTION
═══════════════════════════════════════

When user opens Grid Vault:
Auto-fetch current BTC price
Auto-suggest grid range:

async function suggestGridRange(symbol: string) {
  const price = await getLivePrice(symbol)
  const candles = await fetchCandles(symbol, '1d', 30)

  // Recent 30-day high and low
  const high30 = Math.max(...candles.map((c: any) => c.high))
  const low30  = Math.min(...candles.map((c: any) => c.low))

  // Suggested range: recent range expanded 5%
  const suggestedUpper = Math.round(high30 * 1.05)
  const suggestedLower = Math.round(low30  * 0.95)

  return {
    currentPrice: price,
    suggestedUpper,
    suggestedLower,
    suggestedLevels: 6,
    rangePercent: ((suggestedUpper - suggestedLower) / price * 100).toFixed(1),
    message: `Based on 30-day price range`
  }
}

Show in UI:
💡 Suggested range based on 30-day history:
Upper: $90,000 | Lower: $78,000
Range: 14.3% | [Apply Suggestion]

═══════════════════════════════════════
PART 10 — ENV VARIABLES
═══════════════════════════════════════

Add to .env.local:
GRID_VAULT_ENABLED=true
GRID_DEFAULT_SYMBOL=BTC-USDT
GRID_DEFAULT_LEVERAGE=3
GRID_DEFAULT_LEVELS=6
GRID_TELEGRAM_UPDATES=true
GRID_HOURLY_UPDATES=true