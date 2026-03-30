import { NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'

export const dynamic = 'force-dynamic'

const GECKO = 'https://api.geckoterminal.com/api/v2'

interface Gainer {
  symbol: string
  name: string
  address: string
  priceUsd: number
  change24h: number
  volume24h: number
  imageUrl: string | null
}

async function fetchTopGainers(): Promise<Gainer[]> {
  // Fetch trending + top pools WITH included base_token metadata (has image_url)
  const [trendingRes, volumeRes] = await Promise.all([
    fetch(`${GECKO}/networks/monad/trending_pools?page=1&include=base_token`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null),
    fetch(`${GECKO}/networks/monad/pools?page=1&sort=h24_volume_usd_desc&include=base_token`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null),
  ])

  const allPools: any[] = []
  // Map: token GeckoTerminal ID (e.g. "monad_0x123...") → image URL
  const tokenImages = new Map<string, string>()

  for (const res of [trendingRes, volumeRes]) {
    if (!res || !res.ok) continue
    const json = await res.json()
    allPools.push(...(json?.data ?? []))
    // "included" contains full token objects with image_url
    for (const inc of (json?.included ?? [])) {
      if (inc.type === 'token' && inc.attributes?.image_url) {
        tokenImages.set(inc.id, inc.attributes.image_url)
      }
    }
  }

  if (allPools.length === 0) return []

  const seen = new Map<string, Gainer>()

  for (const pool of allPools) {
    const attrs = pool.attributes
    if (!attrs) continue

    const change24h = parseFloat(attrs.price_change_percentage?.h24 ?? '0')
    const volume24h = parseFloat(attrs.volume_usd?.h24 ?? '0')
    const priceUsd  = parseFloat(attrs.base_token_price_usd ?? '0')

    const poolName = attrs.name ?? ''
    const baseSymbol = poolName.split('/')[0]?.trim() ?? ''
    if (!baseSymbol) continue

    // Get base token ID and address from relationship
    const baseTokenId = pool.relationships?.base_token?.data?.id ?? ''
    const address = baseTokenId.split('_').pop() ?? ''

    // Skip wrapped native tokens
    if (['WMON', 'wMON'].includes(baseSymbol)) continue
    if (volume24h < 100) continue

    // Look up image from included tokens
    const imageUrl = attrs.base_token_image_url
      ?? tokenImages.get(baseTokenId)
      ?? null

    const existing = seen.get(address.toLowerCase())
    if (!existing || change24h > existing.change24h) {
      seen.set(address.toLowerCase(), {
        symbol: baseSymbol,
        name: baseSymbol,
        address,
        priceUsd,
        change24h,
        volume24h,
        imageUrl,
      })
    }
  }

  return [...seen.values()]
    .filter(t => t.change24h > -100)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 10)
}

export async function GET() {
  try {
    const data = await cached('top-gainers', fetchTopGainers, 3 * 60 * 1000)
    return NextResponse.json(data)
  } catch (e) {
    console.error('[top-gainers] Error:', e)
    return NextResponse.json([], { status: 200 })
  }
}
