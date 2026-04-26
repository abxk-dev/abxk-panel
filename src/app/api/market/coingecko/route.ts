import { NextResponse } from "next/server"

export async function GET() {
  const res = await fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, error: text }, { status: 502 })
  }
  const json = (await res.json()) as any
  const btcDominance = Number(json?.data?.market_cap_percentage?.btc)
  const marketCapChange24hPct = Number(json?.data?.market_cap_change_percentage_24h_usd)

  return NextResponse.json({
    ok: true,
    data: {
      btcDominance: Number.isFinite(btcDominance) ? btcDominance : undefined,
      marketCapChange24hPct: Number.isFinite(marketCapChange24hPct) ? marketCapChange24hPct : undefined
    }
  })
}

