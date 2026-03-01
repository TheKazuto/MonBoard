import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const H = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

async function gql(query: string) {
  const r = await fetch(GQL, { method: 'POST', headers: H, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  return r.json()
}

export async function GET() {
  const results: any = {}

  // 1. Search V4 pools with tokenFilter for GMONAD/gMON
  for (const filter of ['GMONAD', 'gMON', 'GMON', 'gmonad']) {
    try {
      const d = await gql(`{
        topV4Pools(chain: MONAD, first: 10, tokenFilter: "${filter}") {
          poolId feeTier txCount
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume(duration: DAY) { value }
        }
      }`)
      const pools = d.data?.topV4Pools ?? []
      if (pools.length > 0) results[`v4_filter_${filter}`] = pools
      else results[`v4_filter_${filter}`] = d.errors ? d.errors[0]?.message : '0 pools'
    } catch(e: any) { results[`v4_filter_${filter}_err`] = e.message }
  }

  // 2. Same for V3
  for (const filter of ['GMONAD', 'gMON', 'GMON']) {
    try {
      const d = await gql(`{
        topV3Pools(chain: MONAD, first: 10, tokenFilter: "${filter}") {
          address feeTier txCount
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume(duration: DAY) { value }
        }
      }`)
      const pools = d.data?.topV3Pools ?? []
      if (pools.length > 0) results[`v3_filter_${filter}`] = pools
      else results[`v3_filter_${filter}`] = '0 pools'
    } catch(e: any) { results[`v3_filter_${filter}_err`] = e.message }
  }

  // 3. Fetch more V4 pools (100 instead of 30) to see if it's just beyond our limit
  try {
    const d = await gql(`{
      topV4Pools(chain: MONAD, first: 100) {
        poolId feeTier
        token0 { symbol }
        token1 { symbol }
        totalLiquidity { value }
        cumulativeVolume(duration: DAY) { value }
      }
    }`)
    const pools = d.data?.topV4Pools ?? []
    results.v4_100_total = pools.length
    // Find any pool with GMONAD/gMON/GMON in token symbols
    const gmonad = pools.filter((p: any) => 
      /gmon|gmonad/i.test(p.token0?.symbol ?? '') || /gmon|gmonad/i.test(p.token1?.symbol ?? '')
    )
    results.v4_100_gmonad_matches = gmonad.length > 0 ? gmonad : 'none found'
    // Also show all unique token symbols
    const symbols = new Set<string>()
    pools.forEach((p: any) => { symbols.add(p.token0?.symbol ?? '?'); symbols.add(p.token1?.symbol ?? '?') })
    results.v4_100_all_symbols = [...symbols].sort()
  } catch(e: any) { results.v4_100_err = e.message }

  return NextResponse.json(results, { status: 200 })
}
