import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const H = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

async function gql(query: string, variables = {}) {
  const r = await fetch(GQL, { method: 'POST', headers: H, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  return r.json()
}

export async function GET() {
  const results: any = {}

  // Test topV3Pools — introspect its fields first
  try {
    const d = await gql(`{ __type(name: "V3Pool") { fields { name type { name kind ofType { name } } } } }`)
    results.V3Pool_fields = d.data?.__type?.fields?.map((f: any) => `${f.name}: ${f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind}`) ?? d.errors ?? d
  } catch(e: any) { results.V3Pool_fields_err = e.message }

  // Test topV3Pools args
  try {
    const d = await gql(`{ __schema { queryType { fields(includeDeprecated: true) { name args { name type { name kind ofType { name } } } } } } }`)
    const field = d.data?.__schema?.queryType?.fields?.find((f: any) => f.name === 'topV3Pools')
    results.topV3Pools_args = field?.args?.map((a: any) => `${a.name}: ${a.type?.name ?? a.type?.ofType?.name ?? a.type?.kind}`) ?? 'not found'
  } catch(e: any) { results.topV3Pools_args_err = e.message }

  // Test topV3Pools with chain MONAD_TESTNET
  for (const chain of ['MONAD_TESTNET', 'MONAD', 'ETHEREUM', 'BASE']) {
    try {
      const d = await gql(`{ topV3Pools(chain: ${chain}, first: 3) { id token0 { symbol } token1 { symbol } feeTier tvl volumeUSD } }`)
      results[`topV3Pools_${chain}`] = d.data ?? d.errors ?? d
    } catch(e: any) { results[`topV3Pools_${chain}_err`] = e.message }
  }

  return NextResponse.json(results)
}
