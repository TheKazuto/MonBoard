import { NextResponse } from 'next/server'
export const revalidate = 0

async function tryFetch(url: string, opts?: RequestInit) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store', ...opts })
    const text = await r.text()
    if (!r.ok) return { status: r.status, body: text.slice(0, 600) }
    try { return JSON.parse(text) } catch { return text.slice(0, 600) }
  } catch(e: any) { return { error: e.message } }
}

export async function GET() {
  const results: any = {}

  // 1. Pool detail endpoint — check all fields available on a single pool
  //    USD1/WMON pool = 0xe4228db368740b2de03174eb2f98d7976ff1e8fa
  const targetPool = '0xe4228db368740b2de03174eb2f98d7976ff1e8fa'
  results.pool_detail_1 = await tryFetch(`https://explorer.pancakeswap.com/api/cached/pools/${targetPool}`)
  results.pool_detail_2 = await tryFetch(`https://explorer.pancakeswap.com/api/cached/pools/v3/${targetPool}`)
  results.pool_detail_3 = await tryFetch(`https://explorer.pancakeswap.com/api/v1/pools/${targetPool}`)
  results.pool_detail_4 = await tryFetch(`https://explorer.pancakeswap.com/api/cached/pools/detail?id=${targetPool}&protocol=v3&chainId=143`)

  // 2. Farms with numeric IDs via different URL patterns
  results.farms_api_143 = await tryFetch('https://pancakeswap.finance/api/v3/143/farms/list')
  results.farms_api2_143 = await tryFetch(`https://pancakeswap.finance/api/farms?chainId=143`)
  results.farms_api3_143 = await tryFetch(`https://pancakeswap.finance/api/v0/farms?chainId=143`)
  results.farms_configs_num = await tryFetch('https://configs.pancakeswap.com/api/data/cached/farms/143')

  // 3. Try the explorer pools list with extra params to get farm APR 
  results.explorer_full = await tryFetch(
    'https://explorer.pancakeswap.com/api/cached/pools/list?protocols=v3&chains=monad&orderBy=apr24h&pageSize=5'
  )

  // 4. Check if there's a farming/rewards-specific endpoint
  results.farming_1 = await tryFetch('https://explorer.pancakeswap.com/api/cached/pools/farming?chains=monad&protocols=v3')
  results.farming_2 = await tryFetch('https://explorer.pancakeswap.com/api/cached/farming/list?chains=monad')
  results.farming_3 = await tryFetch('https://pancakeswap.finance/api/v3/143/farms/apr')

  // 5. Merkl rewards (PancakeSwap often uses Merkl for extra incentives on Monad)
  results.merkl_pancake = await tryFetch('https://api.merkl.xyz/v4/opportunities?chainId=143&protocol=pancakeswap')
  results.merkl_monad = await tryFetch('https://api.merkl.xyz/v4/opportunities?chainId=143&action=POOL&status=LIVE&items=20')

  // 6. CakeAPR / position manager endpoints
  results.cake_apr_1 = await tryFetch('https://explorer.pancakeswap.com/api/cached/pools/farming/apr?chains=monad&protocols=v3')
  results.cake_apr_2 = await tryFetch(`https://pancakeswap.finance/api/cake-staking/apr?chainId=143`)

  // 7. Check what fields the top pool actually returns — log ALL keys
  const topPoolRes = await tryFetch(
    'https://explorer.pancakeswap.com/api/cached/pools/list?protocols=v3&chains=monad&orderBy=tvlUSD&pageSize=1'
  )
  if (topPoolRes?.rows?.[0]) {
    results.pool_all_keys = Object.keys(topPoolRes.rows[0])
    results.pool_sample = topPoolRes.rows[0]
  }

  return NextResponse.json(results, { status: 200 })
}
