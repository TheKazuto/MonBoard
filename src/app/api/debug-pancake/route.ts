import { NextResponse } from 'next/server'
export const revalidate = 0

async function tryFetch(url: string, opts?: RequestInit) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store', ...opts })
    const text = await r.text()
    if (!r.ok) return { status: r.status, body: text.slice(0, 300) }
    try { return JSON.parse(text) } catch { return text.slice(0, 500) }
  } catch(e: any) { return { error: e.message } }
}

export async function GET() {
  const results: any = {}

  // 1. Merkl API - PancakeSwap uses this for liquidity campaigns
  for (const id of [10143, 143]) {
    results[`merkl_${id}`] = await tryFetch(
      `https://api.merkl.xyz/v4/opportunities/?chainId=${id}&test=false&mainProtocolId=pancakeswap`,
    )
  }

  // 2. Explorer API - try different paths
  const explorerBase = 'https://explorer.pancakeswap.com/api'
  for (const id of [10143, 143]) {
    results[`explorer_cached_${id}`] = await tryFetch(`${explorerBase}/cached/pools/list?chainId=${id}`)
    results[`explorer_v1_${id}`] = await tryFetch(`${explorerBase}/v1/pools?chainId=${id}`)
  }

  // 3. Try their main config endpoint to discover Monad chain info
  results.config_chains = await tryFetch('https://configs.pancakeswap.com/api/data/cached/chains')

  // 4. PancakeSwap specific config endpoints
  for (const id of [10143, 143]) {
    results[`config_pools_${id}`] = await tryFetch(`https://configs.pancakeswap.com/api/data/cached/pools?chainId=${id}`)
    results[`config_v4_${id}`] = await tryFetch(`https://configs.pancakeswap.com/api/data/cached/v4-pools?chainId=${id}`)
  }

  // 5. Try the incentra/brevis endpoint from the scan
  results.incentra = await tryFetch('https://incentra-prd.brevis.network/sdk/v1/campaigns?protocol=pancakeswap&chainId=10143')

  // 6. Try the liquidityCampaigns endpoint from the scan
  for (const base of [
    'https://explorer.pancakeswap.com/api',
    'https://configs.pancakeswap.com/api/data'
  ]) {
    results[`liqCampaigns_${base.includes('explorer') ? 'explorer' : 'configs'}`] = await tryFetch(
      `${base}/liquidityCampaigns`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chainId: 10143 }) }
    )
  }

  // 7. Try the farms endpoint with proper chain names
  for (const chain of ['monadMainnet', 'monad-mainnet', 'MONAD_MAINNET']) {
    results[`farms_${chain}`] = await tryFetch(`https://pancakeswap.finance/api/v3/${chain}/farms`)
  }

  // 8. Explorer cached/pools/tvl-refs with different protocol values
  for (const proto of ['v2', 'v3', 'v4', 'stable']) {
    results[`tvlrefs_${proto}`] = await tryFetch(
      `${explorerBase}/cached/pools/tvl-refs`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocols: [proto], chains: [10143] }) }
    )
  }

  return NextResponse.json(results, { status: 200 })
}
