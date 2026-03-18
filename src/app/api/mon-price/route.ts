import { NextResponse } from 'next/server'
import { getMonPriceData } from '@/lib/priceCache'

export const dynamic = 'force-dynamic'

// Reads from the shared 5-minute priceCache — zero direct CoinGecko calls.
// Cache is shared with token-exposure, defi, nfts routes.
export async function GET() {
  try {
    const data = await getMonPriceData()
    return NextResponse.json(data)
  } catch (err) {
    console.error('[mon-price]', err)
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 502 })
  }
}
