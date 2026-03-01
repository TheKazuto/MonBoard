import { NextResponse } from 'next/server'
export const revalidate = 0

async function tryFetch(url: string, opts?: RequestInit) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store', ...opts })
    if (!r.ok) return { status: r.status, statusText: r.statusText }
    const text = await r.text()
    try { return JSON.parse(text) } catch { return text.slice(0, 500) }
  } catch(e: any) { return { error: e.message } }
}

export async function GET() {
  const results: any = {}
  // Monad chainId = 10143 on PancakeSwap (their internal ID) or 143 (actual chain ID)
  const chainIds = [143, 10143]

  // 1. V3 pools TVL endpoint
  for (const id of chainIds) {
    results[`v3_pools_tvl_${id}`] = await tryFetch(`https://routing-api.pancakeswap.com/v0/v3-pools-tvl/${id}`)
  }

  // 2. V3 farms endpoint
  for (const chain of ['monad', 'mon', '143', '10143']) {
    results[`v3_farms_${chain}`] = await tryFetch(`https://pancakeswap.finance/api/v3/${chain}/farms`)
  }

  // 3. Explorer API - cached pools
  for (const id of chainIds) {
    results[`explorer_pools_${id}`] = await tryFetch(
      `https://explorer.pancakeswap.com/api/cached/pools/tvl-refs`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocols: ['v3'], chains: [id] }) }
    )
  }

  // 4. Configs - farms with chainId
  for (const id of chainIds) {
    results[`config_farms_${id}`] = await tryFetch(`https://configs.pancakeswap.com/api/data/cached/farms?chainId=${id}`)
  }

  // 5. NodeReal GraphQL for PancakeSwap V3
  const gql = 'https://open-platform.nodereal.io/2f9e7753b78d4ab983e5d60c47d7fdfb/pancakeswap-v3/graphql'
  for (const id of chainIds) {
    results[`nodereal_gql_${id}`] = await tryFetch(gql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ pools(first: 5, where: { chainId: ${id} }, orderBy: totalValueLockedUSD, orderDirection: desc) { id token0 { symbol } token1 { symbol } feeTier totalValueLockedUSD volumeUSD } }` }),
    })
  }

  // 6. Try their wallet-api for prices (to confirm Monad support)
  results.wallet_api_prices = await tryFetch('https://wallet-api.pancakeswap.com/v1/prices?chainId=143')

  // 7. Sol explorer style API for Monad
  results.sol_explorer_pools = await tryFetch('https://sol-explorer.pancakeswap.com/api/cached/v1/pools/info/list?chainId=143')

  // 8. Stableswaps
  for (const id of chainIds) {
    results[`stableswaps_${id}`] = await tryFetch(`https://configs.pancakeswap.com/api/data/cached/stableswaps?chainId=${id}`)
  }

  return NextResponse.json(results, { status: 200 })
}
