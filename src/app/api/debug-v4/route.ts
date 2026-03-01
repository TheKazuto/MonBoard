import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const H = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

export async function GET() {
  const results: any = {}

  // 1. Raw V4 pools with all useful fields
  try {
    const r = await fetch(GQL, {
      method: 'POST', headers: H,
      body: JSON.stringify({ query: `{
        topV4Pools(chain: MONAD, first: 10) {
          poolId feeTier isDynamicFee tickSpacing txCount
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value currency }
          cumulativeVolume(duration: DAY) { value currency }
          hook { address }
        }
      }` }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    const d = await r.json()
    results.v4_raw = d.errors ?? d.data
  } catch(e: any) { results.v4_raw_err = e.message }

  // 2. V4 without cumulativeVolume duration arg
  try {
    const r = await fetch(GQL, {
      method: 'POST', headers: H,
      body: JSON.stringify({ query: `{
        topV4Pools(chain: MONAD, first: 5) {
          poolId feeTier
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume { value }
        }
      }` }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    const d = await r.json()
    results.v4_no_duration = d.errors ?? d.data
  } catch(e: any) { results.v4_no_duration_err = e.message }

  // 3. Absolute minimum
  try {
    const r = await fetch(GQL, {
      method: 'POST', headers: H,
      body: JSON.stringify({ query: `{
        topV4Pools(chain: MONAD, first: 5) {
          poolId
          token0 { symbol }
          token1 { symbol }
        }
      }` }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    const d = await r.json()
    results.v4_minimal = d.errors ?? d.data
  } catch(e: any) { results.v4_minimal_err = e.message }

  return NextResponse.json(results, { status: 200 })
}
