import { NextResponse } from 'next/server'
export const revalidate = 0

const RPC = 'https://rpc.monad.xyz'
const UNI_FACTORY   = '0x204faca1764b154221e35c0d20abb3c525710498'
const CAKE_FACTORY  = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
const UNI_NFT_PM    = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'

// Known pools to test (WMON/USDC most likely)
const TEST_POOLS = [
  { name: 'WMON/USDC 0.3%', address: '0x0000000000000000000000000000000000000000' }, // placeholder
]

async function rpc(calls: any[]) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calls), signal: AbortSignal.timeout(10_000),
  })
  const d = await r.json()
  return Array.isArray(d) ? d : [d]
}

export async function GET() {
  const results: any = {}

  // Test 1: Check if there's a Uniswap subgraph on The Graph for Monad
  const subgraphs = [
    'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-monad',
    'https://gateway.thegraph.com/api/subgraphs/id/BqAhCMNfxMwrTe24GF2NWRe9TJsGXvEuFY6KeoPHgas2', // possible Monad V3
  ]
  for (const url of subgraphs) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ pools(first:3, orderBy:totalValueLockedUSD, orderDirection:desc) { id token0{symbol} token1{symbol} feeTier totalValueLockedUSD volumeUSD } }' }),
        signal: AbortSignal.timeout(8_000), cache: 'no-store',
      })
      const d = await r.json()
      results[`subgraph_${url.split('/').pop()}`] = d.data?.pools ?? d.errors?.[0]?.message ?? d
    } catch(e: any) { results[`subgraph_err`] = e.message }
  }

  // Test 2: Get total number of pools from Uniswap V3 Factory
  // numPools() selector: 0xf30dba93
  const factoryCalls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: UNI_FACTORY,  data: '0xf30dba93' }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: CAKE_FACTORY, data: '0xf30dba93' }, 'latest'] },
  ]
  try {
    const res = await rpc(factoryCalls)
    const uniCount  = Number(BigInt(res.find((r:any) => r.id===1)?.result ?? '0x0'))
    const cakeCount = Number(BigInt(res.find((r:any) => r.id===2)?.result ?? '0x0'))
    results.uniswap_pool_count  = uniCount
    results.pancakeswap_pool_count = cakeCount
  } catch(e: any) { results.factory_err = e.message }

  // Test 3: Find pools via PoolCreated events (last 1000 blocks = ~7 min on Monad)
  const bnRes = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(4_000),
  }).then(r => r.json()).catch(() => ({ result: '0x0' }))
  const currentBlock = Number(BigInt(bnRes?.result ?? '0x0'))
  const fromBlock = '0x' + Math.max(0, currentBlock - 100).toString(16) // 100 blocks max

  try {
    const POOL_CREATED = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'
    const logRes = await fetch(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'eth_getLogs', params: [{ fromBlock, toBlock: 'latest', address: [UNI_FACTORY, CAKE_FACTORY], topics: [POOL_CREATED] }] }),
      signal: AbortSignal.timeout(8_000),
    }).then(r => r.json())
    results.recent_pool_events = logRes?.result?.length ?? logRes?.error ?? 0
    results.currentBlock = currentBlock
  } catch(e: any) { results.events_err = e.message }

  return NextResponse.json(results)
}
