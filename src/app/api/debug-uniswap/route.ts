import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
}

async function gql(query: string, variables = {}) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  return r.json()
}

export async function GET() {
  const results: any = {}

  // Test 1: Monad chainId 10143
  try {
    const d = await gql(`{
      v3Pools(chainId: 10143, orderBy: totalValueLockedUSD, orderDirection: desc, first: 3) {
        id token0 { symbol } token1 { symbol } feeTier totalValueLockedUSD volumeUSD
      }
    }`)
    results.chainId_10143 = d.data ?? d.errors ?? d
  } catch(e: any) { results.chainId_10143_err = e.message }

  // Test 2: Monad chainId 143
  try {
    const d = await gql(`{
      v3Pools(chainId: 143, orderBy: totalValueLockedUSD, orderDirection: desc, first: 3) {
        id token0 { symbol } token1 { symbol } feeTier totalValueLockedUSD volumeUSD
      }
    }`)
    results.chainId_143 = d.data ?? d.errors ?? d
  } catch(e: any) { results.chainId_143_err = e.message }

  // Test 3: introspect — what queries exist?
  try {
    const d = await gql(`{ __schema { queryType { fields { name } } } }`)
    const fields = d.data?.__schema?.queryType?.fields?.map((f: any) => f.name) ?? d.errors ?? d
    results.schema_queries = fields
  } catch(e: any) { results.schema_err = e.message }

  // Test 4: try pools query (not v3Pools)
  try {
    const d = await gql(`{
      pools(chainId: 10143, first: 3) {
        id token0 { symbol } token1 { symbol }
      }
    }`)
    results.pools_query = d.data ?? d.errors ?? d
  } catch(e: any) { results.pools_query_err = e.message }

  return NextResponse.json(results)
}
