import { NextResponse } from 'next/server'
export const revalidate = 0

export async function GET() {
  const results: any = {}

  // Test 1: minimal query — see if any data comes back at all
  const q1 = `{ markets(where:{chainId_in:[143]}, first:5) { uniqueKey loanAsset{symbol} collateralAsset{symbol} state{supplyApy} } vaults(where:{chainId_in:[143]}, first:5) { address name asset{symbol} state{netApy} } }`
  try {
    const r1 = await fetch('https://api.morpho.org/graphql', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q1 }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    const d1 = await r1.json()
    results.q1_status = r1.status
    results.q1_errors = d1.errors ?? null
    results.q1_markets_count = d1.data?.markets?.length ?? 'no data'
    results.q1_vaults_count  = d1.data?.vaults?.length ?? 'no data'
    results.q1_first_market  = d1.data?.markets?.[0] ?? null
    results.q1_first_vault   = d1.data?.vaults?.[0] ?? null
    results.q1_raw = d1
  } catch(e: any) { results.q1_error = e.message }

  // Test 2: try chainId 10143 (Monad testnet alt)
  const q2 = `{ markets(where:{chainId_in:[10143]}, first:3) { uniqueKey loanAsset{symbol} state{supplyApy} } }`
  try {
    const r2 = await fetch('https://api.morpho.org/graphql', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q2 }),
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    const d2 = await r2.json()
    results.q2_chainId_10143_markets = d2.data?.markets?.length ?? d2.errors?.[0]?.message ?? 'empty'
  } catch(e: any) { results.q2_error = e.message }

  // Test 3: no chain filter — what chains are available?
  const q3 = `{ markets(first:3, orderBy:SupplyAssetsUsd, orderDirection:Desc) { uniqueKey chain{id networkId} loanAsset{symbol} state{supplyApy} } }`
  try {
    const r3 = await fetch('https://api.morpho.org/graphql', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q3 }),
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    const d3 = await r3.json()
    results.q3_top_markets_any_chain = d3.data?.markets ?? d3.errors ?? null
  } catch(e: any) { results.q3_error = e.message }

  return NextResponse.json(results)
}
