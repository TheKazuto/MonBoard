import { NextRequest, NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'

// Migrated from local Map cache to serverCache (L1 in-memory + L2 KV).
// TTL 24h — token lists change rarely. Both GeckoTerminal and CoinGecko
// token-list endpoints are free, but the payloads are large (ethereum has
// thousands of tokens), so persisting them in KV avoids repeated heavy fetches
// across cold starts and multiple isolates.
const TTL = 24 * 60 * 60 * 1000 // 24 hours

/** Platforms served via GeckoTerminal (Monad not yet on CoinGecko token list) */
const GECKO_TERMINAL_NETWORKS: Record<string, string> = {
  monad:           'monad',
  'monad-mainnet': 'monad',
}

/** All valid CoinGecko token-list platform slugs supported by the swap page */
const COINGECKO_PLATFORMS = new Set([
  'ethereum',
  'binance-smart-chain',
  'polygon-pos',
  'avalanche',
  'arbitrum-one',
  'optimistic-ethereum',
  'base',
  'fantom',
  'aurora',
  'celo',
  'harmony-shard-0',
  'moonbeam',
  'moonriver',
  'cronos',
  'xdai',
  'klay-token',
  'boba',
  'okex-chain',
  'telos',
  'fuse',
  'iotex',
  'tron',
  'near-protocol',
  'linea',
  'zksync',
  'scroll',
  'mantle',
  'blast',
  'metis-andromeda',
  'zkfair',
  'solana',
])

async function fetchFromGeckoTerminal(network: string) {
  const tokenMap = new Map<string, {
    symbol: string; name: string; address: string; decimals: number; logoURI: string
  }>()

  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch(
        `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools?include=base_token,quote_token&page=${page}&sort=h24_volume_usd_desc`,
        { headers: { 'Accept': 'application/json' }, cache: 'no-store' }
      )
      if (!res.ok) break

      const data = await res.json()
      const included: unknown[] = data.included ?? []

      for (const item of included) {
        if (typeof item !== 'object' || item === null) continue
        const obj = item as Record<string, unknown>
        if (obj.type !== 'token') continue
        const a = obj.attributes as Record<string, unknown>
        const addr = (a.address as string)?.toLowerCase()
        if (!addr || tokenMap.has(addr)) continue

        tokenMap.set(addr, {
          symbol:   (a.symbol   as string) ?? '',
          name:     (a.name     as string) ?? (a.symbol as string) ?? '',
          address:  a.address   as string,
          decimals: (a.decimals as number) ?? 18,
          logoURI:  a.image_url && a.image_url !== 'missing.png'
            ? (a.image_url as string)
            : '',
        })
      }
    } catch { break }
  }

  return { tokens: Array.from(tokenMap.values()) }
}

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get('platform')
  if (!platform) {
    return NextResponse.json({ error: 'Missing platform', tokens: [] }, { status: 400 })
  }

  const gtNetwork   = GECKO_TERMINAL_NETWORKS[platform]
  const isCoinGecko = COINGECKO_PLATFORMS.has(platform)
  if (!gtNetwork && !isCoinGecko) {
    return NextResponse.json({ error: 'Unsupported platform', tokens: [] }, { status: 400 })
  }

  try {
    const data = await cached(`token-list:${platform}`, async () => {
      if (gtNetwork) {
        return fetchFromGeckoTerminal(gtNetwork)
      }
      // CoinGecko static token list — free endpoint, no API key required
      const res = await fetch(`https://tokens.coingecko.com/${platform}/all.json`, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
      return res.json()
    }, TTL)

    return NextResponse.json(data)
  } catch (e: unknown) {
    console.error('[token-list] platform:', platform, 'error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to fetch token list', tokens: [] }, { status: 502 })
  }
}
