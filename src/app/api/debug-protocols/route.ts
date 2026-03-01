import { NextResponse } from 'next/server'
import { rpcBatch } from '@/lib/monad'

export const revalidate = 0

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ethCall(to: string, data: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }
}
function getLogs(address: string, topics: string[], fromBlock: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_getLogs', params: [{ address, topics, fromBlock, toBlock: 'latest' }] }
}
function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex.startsWith('0x') ? hex : '0x' + hex) } catch { return 0n }
}
function decodeAddress(hex: string): string {
  if (!hex || hex.length < 66) return '0x0'
  return '0x' + hex.slice(hex.length - 40)
}
function decodeString(hex: string): string {
  if (!hex || hex === '0x' || hex.length < 4) return ''
  try {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = Buffer.from(raw, 'hex')
    // Try ABI-encoded string: offset(32) + length(32) + data
    if (bytes.length >= 96) {
      const len = Number(bytes.readBigUInt64BE(56))
      if (len > 0 && len <= 200) {
        return bytes.slice(64, 64 + len).toString('utf8').replace(/\0/g, '')
      }
    }
    // Short packed string
    const trimmed = bytes.toString('utf8').replace(/\0/g, '').trim()
    return trimmed.length > 0 && trimmed.length < 50 ? trimmed : ''
  } catch { return '' }
}
function padUint(n: number): string { return n.toString(16).padStart(64, '0') }
function padAddr(addr: string): string { return addr.slice(2).toLowerCase().padStart(64, '0') }
async function tryFetch(url: string): Promise<{ status: number; ok: boolean; body: any; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
    let body: any = null
    try { body = await res.json() } catch { body = await res.text().catch(() => null) }
    return { status: res.status, ok: res.ok, body }
  } catch (e: any) {
    return { status: 0, ok: false, body: null, error: e.message }
  }
}

// ─── CURVE: Test final implementation ─────────────────────────────────────────
async function debugCurve(user: string) {
  const BASE = 'https://api-core.curve.finance/v1'
  const addr = user.toLowerCase()
  const paddedAddr = addr.slice(2).padStart(64, '0')

  // Fetch both active pool types
  const [twocrypto, stableNg] = await Promise.all([
    tryFetch(`${BASE}/getPools/monad/factory-twocrypto`),
    tryFetch(`${BASE}/getPools/monad/factory-stable-ng`),
  ])

  const allPools = [
    ...(twocrypto.body?.data?.poolData ?? []),
    ...(stableNg.body?.data?.poolData ?? []),
  ]

  // Batch balanceOf for all pools
  const balanceCalls = allPools.map((pool: any, i: number) => ({
    jsonrpc: '2.0', id: i, method: 'eth_call',
    params: [{ to: pool.lpTokenAddress ?? pool.address, data: '0x70a08231' + paddedAddr }, 'latest'],
  }))
  const rpcResults = balanceCalls.length > 0 ? await rpcBatch(balanceCalls, 10_000) : []

  const poolsWithBalance: any[] = []
  const poolsChecked: any[] = []

  for (let i = 0; i < allPools.length; i++) {
    const pool = allPools[i]
    const result = rpcResults.find((r: any) => r.id === i)?.result ?? '0x'
    const balance = (!result || result === '0x') ? 0n : BigInt(result)
    const lpPrice = Number(pool.lpTokenPrice ?? 0)
    const userUsd = balance > 0n ? (Number(balance) / 1e18) * lpPrice : 0

    const entry = {
      name: pool.name,
      address: pool.lpTokenAddress ?? pool.address,
      tvl: pool.usdTotalExcludingBasePool?.toFixed(2),
      lpPrice: lpPrice.toFixed(4),
      userBalanceRaw: balance.toString(),
      userUSD: userUsd.toFixed(4),
    }
    poolsChecked.push(entry)
    if (balance > 0n) poolsWithBalance.push(entry)
  }

  return {
    totalPools: allPools.length,
    twocryptoCount: twocrypto.body?.data?.poolData?.length ?? 0,
    stableNgCount: stableNg.body?.data?.poolData?.length ?? 0,
    userAddress: addr,
    poolsWithBalance,
    allPoolsChecked: poolsChecked,
    note: poolsWithBalance.length === 0 ? 'User has no Curve LP positions' : `Found ${poolsWithBalance.length} positions`,
  }
}

// ─── KURU: Deep contract introspection + event scan ───────────────────────────
async function debugKuru(user: string) {
  const PROXY1  = '0x4869a4c7657cef5e5496c9ce56dde4cd593e4923'
  const PROXY2  = '0xd6eae39b96fbdb7daa2227829be34b4e1bc9069a'
  const IMPL    = '0x7c576409b1d039f6c218ef9dab88c88f39326cff'
  const MARGIN  = '0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5'

  const selectors: [string, string][] = [
    ['name()',             '0x06fdde03'],
    ['symbol()',           '0x95d89b41'],
    ['decimals()',         '0x313ce567'],
    ['totalSupply()',      '0x18160ddd'],
    ['totalAssets()',      '0x01e1d114'],
    ['asset()',            '0x38d52e0f'],
    ['owner()',            '0x8da5cb5b'],
    ['getReserves()',      '0x0902f1ac'],
    ['baseToken()',        '0xc55dae63'],
    ['quoteToken()',       '0x9efec935'],
    ['balanceOf(user)',    '0x70a08231' + padAddr(user)],
  ]

  const addresses = [PROXY1, PROXY2, IMPL, MARGIN]
  const calls: any[] = []
  let id = 0
  for (const addr of addresses) {
    for (const [, data] of selectors) calls.push(ethCall(addr, data, id++))
  }
  const rpc = await rpcBatch(calls)

  const perAddress: Record<string, any> = {}
  addresses.forEach((addr, ai) => {
    const results: Record<string, string> = {}
    selectors.forEach(([name], si) => {
      const res = rpc[ai * selectors.length + si]?.result ?? '0x'
      results[name] = res === '0x' ? 'empty/revert' : res.slice(0, 66)
    })
    perAddress[addr] = results
  })

  // Check ERC4626 Deposit events
  const DEPOSIT_TOPIC = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7'
  const logRes = await rpcBatch([
    getLogs(PROXY1, [DEPOSIT_TOPIC], '0x0', 800),
    getLogs(PROXY2, [DEPOSIT_TOPIC], '0x0', 801),
  ])

  return {
    contracts: { proxy1: PROXY1, proxy2: PROXY2, impl: IMPL, margin: MARGIN },
    selectorResults: perAddress,
    depositEvents: {
      proxy1: Array.isArray(logRes[0]?.result) ? logRes[0].result.length + ' events found' : logRes[0]?.error ?? 'no events',
      proxy2: Array.isArray(logRes[1]?.result) ? logRes[1].result.length + ' events found' : logRes[1]?.error ?? 'no events',
    },
    note: 'If all selectors return empty/revert, these are NOT LP vaults — just DEX infrastructure',
  }
}

// ─── LAGOON: REST API + factory search ────────────────────────────────────────
async function debugLagoon(user: string) {
  const apiResults: Record<string, any> = {}
  const urls = [
    'https://api.lagoon.finance/api/v1/vaults',
    'https://api.lagoon.finance/api/v1/health',
    `https://api.lagoon.finance/api/v1/positions?address=${user}&chainId=143`,
  ]
  for (const url of urls) {
    const r = await tryFetch(url)
    apiResults[url] = { status: r.status, error: r.error, bodySnippet: JSON.stringify(r.body)?.slice(0, 200) }
  }

  // Check bytecode on candidate factory addresses
  const candidates = [
    '0x186986f1C5Ff2E21B18E4e29B1B7E3FC3aF1d61',
    '0x3e5FEB6a59c7dc4b8dedfee63f63de39b5e18F5',
  ]
  const codeCalls = candidates.map((addr, i) => ({
    jsonrpc: '2.0', id: i + 1, method: 'eth_getCode', params: [addr, 'latest']
  }))
  const codeRes = await rpcBatch(codeCalls)
  const codeInfo = candidates.map((addr, i) => ({
    address: addr,
    hasCode: codeRes[i]?.result !== '0x',
    codeLength: (codeRes[i]?.result?.length ?? 2) - 2,
  }))

  return {
    apiResults,
    factoryCandidates: codeInfo,
    conclusion: 'Lagoon vault addresses needed — find via MonadScan deployer wallet or Lagoon docs',
  }
}

// ─── GEARBOX ──────────────────────────────────────────────────────────────────
async function debugGearbox(user: string) {
  const urls = [
    'https://api.gearbox.finance/api/v1/pools?chainId=143',
    'https://api.gearbox.fi/api/v1/pools?chainId=143',
  ]
  const results: Record<string, any> = {}
  for (const url of urls) {
    const r = await tryFetch(url)
    results[url] = { status: r.status, error: r.error }
  }
  return { networkBlocked: true, probes: results }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url      = new URL(req.url)
  const address  = url.searchParams.get('address') ?? '0x0000000000000000000000000000000000000001'
  const protocol = url.searchParams.get('protocol')

  if (protocol === 'curve')   return NextResponse.json(await debugCurve(address))
  if (protocol === 'kuru')    return NextResponse.json(await debugKuru(address))
  if (protocol === 'lagoon')  return NextResponse.json(await debugLagoon(address))
  if (protocol === 'gearbox') return NextResponse.json(await debugGearbox(address))

  const [curve, kuru, lagoon, gearbox] = await Promise.all([
    debugCurve(address),
    debugKuru(address),
    debugLagoon(address),
    debugGearbox(address),
  ])
  return NextResponse.json({ curve, kuru, lagoon, gearbox })
}
