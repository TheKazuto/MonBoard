import { NextResponse } from 'next/server'
export const revalidate = 0

const GQL = 'https://interface.gateway.uniswap.org/v1/graphql'
const H = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

async function gql(query: string) {
  const r = await fetch(GQL, { method: 'POST', headers: H, body: JSON.stringify({ query }), signal: AbortSignal.timeout(12_000), cache: 'no-store' })
  return r.json()
}

export async function GET() {
  const results: any = {}

  // Test 1: correct fields from schema — totalLiquidity + cumulativeVolume + historicalVolume
  try {
    const d = await gql(`{
      topV3Pools(chain: MONAD_TESTNET, first: 5) {
        id
        address
        feeTier
        token0 { symbol }
        token1 { symbol }
        totalLiquidity { value currency }
        cumulativeVolume(duration: DAY) { value currency }
        historicalVolume(duration: DAY) { value timestamp }
      }
    }`)
    results.monad_testnet_pools = d.data?.topV3Pools ?? d.errors ?? d
  } catch(e: any) { results.monad_err = e.message }

  // Test 2: introspect Amount type  
  try {
    const d = await gql(`{ __type(name: "Amount") { fields { name type { name kind } } } }`)
    results.Amount_fields = d.data?.__type?.fields?.map((f: any) => f.name) ?? d.errors
  } catch(e: any) { results.Amount_err = e.message }

  // Test 3: introspect TimestampedAmount (historicalVolume return type)
  try {
    const d = await gql(`{ __type(name: "TimestampedAmount") { fields { name type { name kind } } } }`)
    results.TimestampedAmount_fields = d.data?.__type?.fields?.map((f: any) => f.name) ?? d.errors
  } catch(e: any) { results.TimestampedAmount_err = e.message }

  return NextResponse.json(results)
}
