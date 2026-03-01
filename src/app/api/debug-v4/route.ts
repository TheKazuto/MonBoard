import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const H = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

async function gql(query: string) {
  const r = await fetch(GQL, { method: 'POST', headers: H, body: JSON.stringify({ query }), signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  return r.json()
}

export async function GET() {
  const results: any = {}

  // 1. Check if topV4Pools exists and what it returns
  try {
    const d = await gql(`{
      topV4Pools(chain: MONAD, first: 5) {
        address feeTier
        token0 { symbol }
        token1 { symbol }
        totalLiquidity { value }
        cumulativeVolume(duration: DAY) { value }
      }
    }`)
    results.v4_same_as_v3 = d.errors ? { error: d.errors[0]?.message } : d.data
  } catch(e: any) { results.v4_same_as_v3_err = e.message }

  // 2. Try V4 with minimal fields to see what works
  try {
    const d = await gql(`{
      topV4Pools(chain: MONAD, first: 5) {
        address
      }
    }`)
    results.v4_minimal = d.errors ? { error: d.errors[0]?.message } : d.data
  } catch(e: any) { results.v4_minimal_err = e.message }

  // 3. Introspect topV4Pools return type
  try {
    const d = await gql(`{
      __schema {
        queryType {
          fields {
            name
            args { name type { name kind ofType { name } } }
            type { name kind ofType { name kind ofType { name fields { name type { name kind ofType { name } } } } } }
          }
        }
      }
    }`)
    const fields = d.data?.__schema?.queryType?.fields ?? []
    const v4Field = fields.find((f: any) => f.name === 'topV4Pools')
    const v3Field = fields.find((f: any) => f.name === 'topV3Pools')
    results.v4_schema = v4Field ?? 'NOT FOUND in schema'
    results.v3_schema = v3Field ?? 'NOT FOUND'
    // Also list all query names that contain "pool" or "v4"
    results.pool_queries = fields
      .filter((f: any) => /pool|v4/i.test(f.name))
      .map((f: any) => f.name)
  } catch(e: any) { results.introspect_err = e.message }

  // 4. Try alternative query names
  const alternatives = [
    `{ topV4Pools(chain: MONAD, first: 3) { id address poolId hook token0 { symbol } token1 { symbol } } }`,
    `{ v4Pools(chain: MONAD, first: 3) { address token0 { symbol } token1 { symbol } } }`,
    `{ topPools(chain: MONAD, first: 3, protocolVersions: [V4]) { address token0 { symbol } token1 { symbol } totalLiquidity { value } } }`,
  ]
  for (const q of alternatives) {
    const label = q.match(/\{\s*(\w+)/)?.[1] ?? 'unknown'
    try {
      const d = await gql(q)
      results[`alt_${label}`] = d.errors ? { error: d.errors[0]?.message } : d.data
    } catch(e: any) { results[`alt_${label}_err`] = e.message }
  }

  return NextResponse.json(results, { status: 200 })
}
