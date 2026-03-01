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

  // Introspect the Chain enum to see ALL valid values
  try {
    const d = await gql(`{ __type(name: "Chain") { enumValues { name } } }`)
    results.valid_chains = d.data?.__type?.enumValues?.map((v: any) => v.name) ?? d.errors ?? d
  } catch(e: any) { results.chain_enum_err = e.message }

  // Test topV3Pools with promising chain names from enum
  const chainsToTest = ['MONAD', 'MONAD_MAINNET', 'MONAD_TESTNET', 'MONAD_DEVNET']
  for (const chain of chainsToTest) {
    try {
      const d = await gql(`{
        topV3Pools(chain: ${chain}, first: 5) {
          id address feeTier
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume(duration: DAY) { value }
        }
      }`)
      if (d.errors) {
        results[`topV3Pools_${chain}`] = `INVALID: ${d.errors[0]?.message}`
      } else {
        results[`topV3Pools_${chain}`] = d.data?.topV3Pools?.length > 0
          ? d.data.topV3Pools
          : `VALID chain but 0 pools`
      }
    } catch(e: any) { results[`topV3Pools_${chain}_err`] = e.message }
  }

  return NextResponse.json(results)
}
