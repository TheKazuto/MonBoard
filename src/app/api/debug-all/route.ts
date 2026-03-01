import { NextResponse } from 'next/server'

export const revalidate = 0

interface ProtocolResult {
  protocol: string
  status: 'ok' | 'empty' | 'error'
  itemCount: number
  timeMs: number
  error?: string
  sample?: any
  note?: string
}

async function probe(protocol: string, fn: () => Promise<any[]>, note?: string): Promise<ProtocolResult> {
  const t0 = Date.now()
  try {
    const result = await fn()
    return { protocol, status: result.length > 0 ? 'ok' : 'empty', itemCount: result.length, timeMs: Date.now() - t0, sample: result[0] ?? null, note }
  } catch (e: any) {
    return { protocol, status: 'error', itemCount: 0, timeMs: Date.now() - t0, error: e.message, note }
  }
}

async function tryFetch(url: string, opts?: RequestInit) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: 'no-store', ...opts })
    let body: any = null
    try { body = await res.json() } catch { body = await res.text().catch(() => null) }
    return { ok: res.ok, status: res.status, body, error: undefined as any }
  } catch (e: any) {
    return { ok: false, status: 0, body: null, error: e.message }
  }
}

function ethCall(to: string, data: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }
}
async function rpcBatch(calls: any[]) {
  const res = await fetch('https://rpc.monad.xyz', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calls), signal: AbortSignal.timeout(10_000),
  })
  const d = await res.json()
  return Array.isArray(d) ? d : [d]
}
function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex) } catch { return 0n }
}

// ─── Probes ───────────────────────────────────────────────────────────────────

async function probeNeverland() {
  const POOL = '0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585'
  const ASSETS = [
    '0x3bd359c1119da7da1d913d1c4d2b7c461115433a',
    '0x754704bc059f8c67012fed69bc8a327a5aafb603',
    '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242',
  ]
  const calls = ASSETS.map((a, i) => ethCall(POOL, '0x35ea6a75' + a.slice(2).padStart(64, '0'), i))
  const results = await rpcBatch(calls)
  const valid = results.filter(r => r?.result && r.result !== '0x' && r.result.length > 10)
  if (valid.length === 0) throw new Error('All RPC calls returned empty')
  return valid
}

async function probeMorpho() {
  const query = `{ markets(where:{chainId_in:[143]},first:5) { uniqueKey loanAsset { symbol } state { supplyApy } } }`
  const r = await tryFetch('https://api.morpho.org/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const markets = r.body?.data?.markets ?? []
  if (!r.ok || markets.length === 0) throw new Error(`HTTP ${r.status} — markets=${markets.length}`)
  return markets
}

async function probeUniswapV3() {
  const NFT_PM = '0x3aeB6592D4F4F34f0f74fEE6dC13cF5f02b29A6f'
  const addr = '0000000000000000000000000000000000000000000000000000000000000001'
  const r = await rpcBatch([ethCall(NFT_PM, '0x70a08231' + addr, 1)])
  const count = Number(decodeUint(r[0]?.result ?? '0x'))
  // Just confirm the contract responds (even 0 positions is valid)
  if (r[0]?.result === undefined) throw new Error('Contract did not respond')
  return [{ nftCount: count, contractResponds: true }]
}

async function probePancakeV3() {
  const NFT_PM = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364'
  const addr = '0000000000000000000000000000000000000000000000000000000000000001'
  const r = await rpcBatch([ethCall(NFT_PM, '0x70a08231' + addr, 1)])
  if (r[0]?.result === undefined) throw new Error('Contract did not respond')
  return [{ nftCount: Number(decodeUint(r[0]?.result ?? '0x')), contractResponds: true }]
}

async function probeCurve() {
  const BASE = 'https://api-core.curve.finance/v1'
  const r = await tryFetch(`${BASE}/getPools/monad/factory-stable-ng`)
  const pools = r.body?.data?.poolData ?? []
  if (!r.ok || pools.length === 0) throw new Error(`HTTP ${r.status}`)
  return pools.slice(0, 3).map((p: any) => ({ name: p.name, tvl: p.usdTotal?.toFixed(2) }))
}

async function probeUpshift() {
  const r = await tryFetch('https://app.upshift.finance/api/vaults?chainId=143')
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.error ?? JSON.stringify(r.body).slice(0, 100)}`)
  const vaults = r.body?.vaults ?? r.body ?? []
  if (!Array.isArray(vaults) || vaults.length === 0) throw new Error('No vaults in response: ' + JSON.stringify(r.body).slice(0, 150))
  return vaults.slice(0, 2)
}

async function probeKintsu() {
  const SMON = '0xa3227c5969757783154c60bf0bc1944180ed81b9'
  const r = await rpcBatch([ethCall(SMON, '0x18160ddd', 1)]) // totalSupply()
  const supply = decodeUint(r[0]?.result ?? '0x')
  if (supply === 0n) throw new Error('sMON totalSupply = 0 — wrong contract?')
  return [{ totalSupply: (Number(supply) / 1e18).toFixed(2) + ' sMON' }]
}

async function probeMagma() {
  const GMON = '0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081'
  const r = await rpcBatch([ethCall(GMON, '0x18160ddd', 1)]) // totalSupply()
  const supply = decodeUint(r[0]?.result ?? '0x')
  if (supply === 0n) throw new Error('gMON totalSupply = 0 — wrong contract?')
  return [{ totalSupply: (Number(supply) / 1e18).toFixed(2) + ' gMON' }]
}

async function probeShMonad() {
  const SHMON = '0x1b68626dca36c7fe922fd2d55e4f631d962de19c'
  const r = await rpcBatch([ethCall(SHMON, '0x18160ddd', 1)]) // totalSupply()
  const supply = decodeUint(r[0]?.result ?? '0x')
  if (supply === 0n) throw new Error('shMON totalSupply = 0 — wrong contract?')
  return [{ totalSupply: (Number(supply) / 1e18).toFixed(2) + ' shMON' }]
}

async function probeLagoon() {
  const urls = [
    'https://api.lagoon.finance/api/v1/vaults',
    'https://api.lagoon.finance/v1/vaults?chainId=143',
    'https://app.lagoon.finance/api/vaults?chainId=143',
  ]
  const errors: string[] = []
  for (const url of urls) {
    const r = await tryFetch(url)
    if (r.ok) return [{ url, body: JSON.stringify(r.body).slice(0, 200) }]
    errors.push(`${url} → ${r.status}`)
  }
  throw new Error(errors.join(' | '))
}

async function probeGearbox() {
  const r = await tryFetch('https://api.gearbox.finance/api/v1/pools?chainId=143')
  if (!r.ok) throw new Error(`fetch failed — ${r.error ?? `HTTP ${r.status}`}`)
  return [{ body: JSON.stringify(r.body).slice(0, 200) }]
}

async function probeKuru() {
  const PROXY1 = '0x4869a4c7657cef5e5496c9ce56dde4cd593e4923'
  const r = await rpcBatch([
    ethCall(PROXY1, '0x06fdde03', 1), // name()
    ethCall(PROXY1, '0x18160ddd', 2), // totalSupply()
  ])
  if (!r[0]?.result || r[0].result === '0x') throw new Error('Proxy1 name() returned empty')
  return [{ nameHex: r[0].result.slice(0, 80), totalSupply: decodeUint(r[1]?.result ?? '0x').toString() }]
}

async function probeCurvance() {
  const r = await tryFetch(`https://api.curvance.com/api/v1/markets?chainId=143`)
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.error ?? JSON.stringify(r.body).slice(0, 100)}`)
  const markets = r.body?.markets ?? r.body?.data ?? r.body ?? []
  if (Array.isArray(markets) && markets.length === 0) throw new Error('Empty markets array')
  return Array.isArray(markets) ? markets.slice(0, 2) : [{ body: JSON.stringify(r.body).slice(0, 200) }]
}

async function probeEulerV2() {
  const query = `{ vaults(where:{chainId:143},first:5) { name asset { symbol } state { supplyApy } } }`
  const r = await tryFetch('https://api.euler.finance/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.error ?? JSON.stringify(r.body).slice(0, 100)}`)
  const vaults = r.body?.data?.vaults ?? []
  if (vaults.length === 0) throw new Error('No vaults returned for chainId 143')
  return vaults
}

async function probeMidas() {
  // Use official Midas contract addresses for Monad
  const TOKENS = [
    { address: '0x8a0e8e76A5c7Cd21deb5A0975eCb8C7C0bC1d7e5', symbol: 'mTBILL' },
    { address: '0x2e3421dEB8B0D640a2E3A9f4e2591B01A43e96F7', symbol: 'mBASIS' },
  ]
  const calls = TOKENS.map((t, i) => ethCall(t.address, '0x18160ddd', i)) // totalSupply
  const results = await rpcBatch(calls)
  const valid = results.filter(r => r?.result && r.result !== '0x' && decodeUint(r.result) > 0n)
  if (valid.length === 0) throw new Error('mTBILL/mBASIS totalSupply = 0 — contracts may be wrong or empty')
  return TOKENS.map((t, i) => ({ symbol: t.symbol, totalSupply: decodeUint(results[i]?.result ?? '0x').toString() }))
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET() {
  const results = await Promise.all([
    probe('Neverland',     probeNeverland,    'on-chain Aave V3 fork'),
    probe('Morpho',        probeMorpho,       'GraphQL API'),
    probe('Uniswap V3',    probeUniswapV3,    'on-chain NFT position manager'),
    probe('PancakeSwap V3',probePancakeV3,    'on-chain NFT position manager'),
    probe('Curve',         probeCurve,        'api-core.curve.finance'),
    probe('Upshift',       probeUpshift,      'REST API'),
    probe('Kintsu',        probeKintsu,       'on-chain sMON token'),
    probe('Magma',         probeMagma,        'on-chain gMON token'),
    probe('shMonad',       probeShMonad,      'on-chain shMON token'),
    probe('Lagoon',        probeLagoon,       'REST API'),
    probe('Gearbox',       probeGearbox,      'REST API'),
    probe('Kuru',          probeKuru,         'on-chain proxy contracts'),
    probe('Curvance',      probeCurvance,     'REST API'),
    probe('Euler V2',      probeEulerV2,      'GraphQL API'),
    probe('Midas',         probeMidas,        'on-chain mTBILL/mBASIS'),
  ])

  const ok     = results.filter(r => r.status === 'ok')
  const empty  = results.filter(r => r.status === 'empty')
  const errors = results.filter(r => r.status === 'error')

  return NextResponse.json({
    summary: { total: results.length, ok: ok.length, empty: empty.length, errors: errors.length },
    ok:     ok.map(r => ({ protocol: r.protocol, itemCount: r.itemCount, timeMs: r.timeMs, note: r.note })),
    empty:  empty.map(r => ({ protocol: r.protocol, timeMs: r.timeMs, note: r.note })),
    errors: errors.map(r => ({ protocol: r.protocol, error: r.error, timeMs: r.timeMs, note: r.note })),
    details: results,
  })
}
