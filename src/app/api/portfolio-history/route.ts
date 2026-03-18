import { NextRequest, NextResponse } from 'next/server'
import { KNOWN_TOKENS, rpcBatch, buildBalanceOfCall } from '@/lib/monad'
import { cached } from '@/lib/serverCache'

export const revalidate = 0

// ─── Balance fetching ─────────────────────────────────────────────────────────
async function fetchAllBalances(address: string): Promise<{ native: number; tokens: number[] }> {
  const nativeCall = {
    jsonrpc: '2.0',
    method:  'eth_getBalance',
    params:  [address, 'latest'],
    id:      'native',
  }
  const erc20Calls = KNOWN_TOKENS.map((t, i) => buildBalanceOfCall(t.contract, address, i))

  try {
    const results      = await rpcBatch([nativeCall, ...erc20Calls], 12_000)
    const nativeResult = results.find((r: any) => r.id === 'native')
    const native       = nativeResult?.result
      ? Number(BigInt(nativeResult.result)) / 1e18
      : 0

    const tokens = KNOWN_TOKENS.map((t, i) => {
      const r   = results.find((x: any) => x.id === i)
      const raw = r?.result
      if (!raw || raw === '0x' || raw === '0x0' || raw === '0x' + '0'.repeat(64)) return 0
      return Number(BigInt(raw)) / Math.pow(10, t.decimals)
    })

    return { native, tokens }
  } catch {
    return { native: 0, tokens: KNOWN_TOKENS.map(() => 0) }
  }
}

// ─── Price history — cached per (coinId, days) — 2h TTL ──────────────────────
// Historical daily prices are identical for all users requesting the same
// coinId+days combination. Cache prevents N users → N CoinGecko calls.
// 2 hours is safe: daily candles don't change retroactively.
const HISTORY_TTL = 2 * 60 * 60 * 1000 // 2 hours

async function fetchPriceHistory(coinId: string, days: number): Promise<[number, number][]> {
  return cached(`price-history:${coinId}:${days}`, async () => {
    const apiKey  = process.env.COINGECKO_API_KEY
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey

    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`
    const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`CoinGecko market_chart ${res.status}`)
    const data = await res.json()
    return (data?.prices ?? []) as [number, number][]
  }, HISTORY_TTL)
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')

  const VALID_DAYS = new Set([7, 30, 90, 180, 365])
  const rawDays    = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const days       = VALID_DAYS.has(rawDays) ? rawDays : 30

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    // ── 1. Fetch balances ─────────────────────────────────────────────────────
    const { native: monBalance, tokens: tokenBalances } = await fetchAllBalances(address)

    const balances: Record<string, number> = {}
    if (monBalance > 0.0001) balances['monad'] = monBalance
    KNOWN_TOKENS.forEach((t, i) => {
      if (tokenBalances[i] > 0.0001) balances[t.coingeckoId] = tokenBalances[i]
    })

    const heldCoinIds = Object.keys(balances)
    if (heldCoinIds.length === 0) {
      return NextResponse.json({ history: [], totalValue: 0, change: 0 })
    }

    // ── 2. Fetch price histories (cached per coin+days, shared across users) ──
    const priceHistories = await Promise.all(
      heldCoinIds.map(id => fetchPriceHistory(id, days))
    )

    // ── 3. Build daily portfolio value ────────────────────────────────────────
    const referenceHistory = priceHistories[0] ?? []
    if (referenceHistory.length === 0) {
      return NextResponse.json({ history: [], totalValue: 0, change: 0 })
    }

    const priceMaps = new Map<string, Map<string, number>>()
    heldCoinIds.forEach((id, i) => {
      const map = new Map<string, number>()
      priceHistories[i].forEach(([ts, price]) => {
        map.set(new Date(ts).toISOString().split('T')[0], price)
      })
      priceMaps.set(id, map)
    })

    const history: { date: string; value: number }[] = []
    referenceHistory.forEach(([ts]) => {
      const date = new Date(ts).toISOString().split('T')[0]
      let totalValue = 0
      for (const [coinId, balance] of Object.entries(balances)) {
        totalValue += balance * (priceMaps.get(coinId)?.get(date) ?? 0)
      }
      history.push({ date, value: Math.round(totalValue * 100) / 100 })
    })

    const first  = history[0]?.value ?? 0
    const last   = history[history.length - 1]?.value ?? 0
    const change = first > 0 ? ((last - first) / first) * 100 : 0

    return NextResponse.json({ history, totalValue: last, change })
  } catch (err) {
    console.error('[portfolio-history] error:', err)
    return NextResponse.json({ error: 'Failed to fetch portfolio history' }, { status: 500 })
  }
}
