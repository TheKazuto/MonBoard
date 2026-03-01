import { NextResponse } from 'next/server'
export const revalidate = 0

async function tryFetch(url: string, opts?: RequestInit) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store', ...opts })
    const text = await r.text()
    if (!r.ok) return { status: r.status, body: text.slice(0, 500) }
    try { return JSON.parse(text) } catch { return text.slice(0, 500) }
  } catch(e: any) { return { error: e.message } }
}

export async function GET() {
  const results: any = {}

  // 1. Farms with numeric chain IDs (discovered: 143 and 10143 are valid)
  results.farms_143 = await tryFetch('https://pancakeswap.finance/api/v3/143/farms')
  results.farms_10143 = await tryFetch('https://pancakeswap.finance/api/v3/10143/farms')

  // 2. Explorer cached pools with QUERY PARAMS (not POST body)
  const explorerBase = 'https://explorer.pancakeswap.com/api/cached/pools/list'
  for (const proto of ['v2', 'v3', 'v4']) {
    for (const chain of ['monad', 'monadMainnet', '10143', '143']) {
      const url = `${explorerBase}?protocols=${proto}&chains=${chain}&orderBy=tvlUSD`
      results[`explorer_${proto}_${chain}`] = await tryFetch(url)
    }
  }

  // 3. Try tvl-refs with query params instead of POST
  const tvlBase = 'https://explorer.pancakeswap.com/api/cached/pools/tvl-refs'
  for (const chain of ['monad', 'monadMainnet', '10143', '143']) {
    results[`tvlrefs_v3_${chain}`] = await tryFetch(`${tvlBase}?protocols=v3&chains=${chain}`)
  }

  // 4. Summarize farms response if it works
  for (const key of ['farms_143', 'farms_10143']) {
    const data = results[key]
    if (Array.isArray(data)) {
      results[`${key}_summary`] = {
        count: data.length,
        first: data[0] ? { 
          token0: data[0].token0?.symbol || data[0].quoteToken?.symbol,
          token1: data[0].token1?.symbol || data[0].token?.symbol,
          apr: data[0].apr || data[0].cakeApr,
          tvl: data[0].tvl || data[0].liquidity
        } : null
      }
    } else if (data && typeof data === 'object' && !data.status) {
      // Might be an object with farms inside
      const keys = Object.keys(data).slice(0, 5)
      results[`${key}_keys`] = keys
      if (data.farmsWithPrice || data.data || data.pools) {
        const arr = data.farmsWithPrice || data.data || data.pools
        results[`${key}_summary`] = { count: arr?.length, first: arr?.[0] }
      }
    }
  }

  return NextResponse.json(results, { status: 200 })
}
