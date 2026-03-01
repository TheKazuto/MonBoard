import { NextResponse } from 'next/server'
export const revalidate = 0

const RPC = 'https://rpc.monad.xyz'

async function call(to: string, data: string) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(6_000),
  })
  const d = await r.json()
  return d.result ?? d.error
}

export async function GET() {
  const results: any = {}

  const contracts: Record<string, string> = {
    uni_factory:  '0x204faca1764b154221e35c0d20abb3c525710498',
    uni_nft_pm:   '0x7197e214c0b767cfb76fb734ab638e2c192f4e53',
    cake_factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
    cake_nft_pm:  '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364',
  }

  // Test each contract: owner() = 0x8da5b701, allPoolsLength()/numPools() = 0xf30dba93, factory() = 0xc45a0155
  const selectors: Record<string, string> = {
    'owner()':          '0x8da5b701',
    'numPools()':       '0xf30dba93',
    'allPairsLength()': '0x574f2ba3',
    'factory()':        '0xc45a0155',
  }

  for (const [name, addr] of Object.entries(contracts)) {
    results[name] = {}
    for (const [fn, sel] of Object.entries(selectors)) {
      try {
        const res = await call(addr, sel)
        // try to parse as number if 32 bytes
        let parsed: any = res
        if (typeof res === 'string' && res.length === 66) {
          try { parsed = Number(BigInt(res)).toString() } catch {}
        }
        results[name][fn] = parsed
      } catch(e: any) { results[name][fn] = e.message }
    }
  }

  return NextResponse.json(results)
}
