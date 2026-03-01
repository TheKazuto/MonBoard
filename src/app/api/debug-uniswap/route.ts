import { NextResponse } from 'next/server'
export const revalidate = 0

const RPC = 'https://rpc.monad.xyz'

async function rpcCall(id: number, method: string, params: any[]) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(8_000),
  })
  return (await r.json()).result
}

function parseAddress(hex: string): string {
  // address is last 20 bytes of 32-byte result
  return '0x' + hex.slice(-40)
}

function parseUint(hex: string): number {
  try { return Number(BigInt(hex)) } catch { return 0 }
}

export async function GET() {
  const results: any = {}

  const UNI_NFT_PM  = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'
  const CAKE_NFT_PM = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364'

  // Step 1: get code to confirm contracts exist
  for (const [name, addr] of [['uni_nft_pm', UNI_NFT_PM], ['cake_nft_pm', CAKE_NFT_PM]]) {
    const code = await rpcCall(1, 'eth_getCode', [addr, 'latest'])
    results[`${name}_has_code`] = code && code !== '0x' ? `YES (${code.length} chars)` : 'NO — not deployed'
  }

  // Step 2: parse factory() address from NFT PMs  
  const uniFactoryRaw  = await rpcCall(2, 'eth_call', [{ to: UNI_NFT_PM,  data: '0xc45a0155' }, 'latest'])
  const cakeFactoryRaw = await rpcCall(3, 'eth_call', [{ to: CAKE_NFT_PM, data: '0xc45a0155' }, 'latest'])
  
  const uniFactory  = uniFactoryRaw  && uniFactoryRaw !== '0x'  ? parseAddress(uniFactoryRaw)  : null
  const cakeFactory = cakeFactoryRaw && cakeFactoryRaw !== '0x' ? parseAddress(cakeFactoryRaw) : null
  
  results.uni_factory_from_pm  = uniFactory
  results.cake_factory_from_pm = cakeFactory

  // Step 3: verify factories — call owner() and numPools() on them
  for (const [name, addr] of [['uni_factory', uniFactory], ['cake_factory', cakeFactory]] as [string, string | null][]) {
    if (!addr) continue
    const code     = await rpcCall(10, 'eth_getCode', [addr, 'latest'])
    const owner    = await rpcCall(11, 'eth_call', [{ to: addr, data: '0x8da5b701' }, 'latest'])
    const numPools = await rpcCall(12, 'eth_call', [{ to: addr, data: '0xf30dba93' }, 'latest'])
    results[name] = {
      address: addr,
      has_code: code && code !== '0x' ? `YES (${code.length} chars)` : 'NO',
      owner: owner && owner !== '0x' ? parseAddress(owner) : owner,
      numPools: numPools && numPools !== '0x' ? parseUint(numPools) : numPools,
    }
  }

  // Step 4: totalSupply() on NFT PM = number of LP positions minted
  for (const [name, addr] of [['uni_nft_pm', UNI_NFT_PM], ['cake_nft_pm', CAKE_NFT_PM]]) {
    const supply = await rpcCall(20, 'eth_call', [{ to: addr, data: '0x18160ddd' }, 'latest'])
    results[`${name}_totalSupply`] = supply && supply !== '0x' ? parseUint(supply) : supply
  }

  return NextResponse.json(results)
}
