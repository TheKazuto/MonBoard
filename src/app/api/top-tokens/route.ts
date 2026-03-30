import { NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'
import { buildCoinGeckoHeaders } from '@/lib/priceCache'

export const dynamic = 'force-dynamic'

// Increased from 5 minutes to 30 minutes — market cap rankings change at most
// a few times per day. 30 minutes is well within acceptable freshness for a dashboard widget.
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export async function GET() {
  try {
    const data = await cached('top-tokens', async () => {
      const headers = buildCoinGeckoHeaders()
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=monad-ecosystem&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h',
        { headers, cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`CoinGecko error ${res.status}`)
      return await res.json()
    }, CACHE_TTL)

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
