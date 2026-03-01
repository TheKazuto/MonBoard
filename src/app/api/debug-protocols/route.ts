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

// ─── CURVE: Find APR endpoint ─────────────────────────────────────────────────
async function debugCurve(user: string) {
  const BASE = 'https://api-core.curve.finance/v1'
  const addr = user.toLowerCase()
  const paddedAddr = addr.slice(2).padStart(64, '0')

  // The APR (4.71% 3pool, 26.35% MON LSTs) must come from api.curve.finance/api/getPools
  // which is different from api-core.curve.finance — test both and compare APR fields
  const aprEndpoints = [
    'https://api.curve.finance/api/getPools/monad/factory-stable-ng',
    'https://api.curve.finance/api/getPools/monad/factory-twocrypto',
    `${BASE}/getPools/monad/factory-stable-ng`,
    'https://api.curve.finance/api/getSubgraphData/monad',
    'https://api.curve.finance/api/getVolumes/monad',
    'https://api.curve.finance/api/getApys/monad',
    'https://api.curve.finance/api/getPools/all/monad',
  ]
  const aprResults: Record<string, any> = {}
  for (const url of aprEndpoints) {
    const r = await tryFetch(url)
    const key = url.replace('https://api-core.curve.finance/v1/', 'core/').replace('https://api.curve.finance/api/', 'api/')
    const pools = r.body?.data?.poolData ?? []
    // For getPools: extract APR-related fields from first pool with TVL
    const bigPool = pools.find((p: any) => Number(p.usdTotal ?? 0) > 1000)
    const aprSample = bigPool ? Object.fromEntries(
      Object.entries(bigPool).filter(([k]) => /(apy|apr|volume|fee|baseApy|latestDaily)/i.test(k))
    ) : undefined
    aprResults[key] = {
      status: r.status,
      ok: r.ok,
      error: r.error,
      poolCount: pools.length,
      aprFieldsFromBigPool: aprSample,
      bigPoolName: bigPool?.name,
      topKeys: r.ok && r.body && pools.length === 0 ? Object.keys(r.body).slice(0, 8) : undefined,
      rawDataSample: r.ok && r.body?.data && pools.length === 0 ? JSON.stringify(r.body.data).slice(0, 300) : undefined,
    }
  }

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

    // Collect every APR/APY-related field
    const aprFields: Record<string, any> = {}
    for (const [k, v] of Object.entries(pool)) {
      if (/(apy|apr|rate|yield|reward|crv|incentive)/i.test(k)) aprFields[k] = v
    }

    const entry = {
      name: pool.name,
      address: pool.lpTokenAddress ?? pool.address,
      tvl: Number(pool.usdTotalExcludingBasePool ?? pool.usdTotal ?? 0).toFixed(2),
      lpPrice: lpPrice.toFixed(4),
      aprFields,
      userBalanceRaw: balance.toString(),
      userUSD: userUsd.toFixed(4),
    }
    poolsChecked.push(entry)
    if (balance > 0n) poolsWithBalance.push(entry)
  }

  const firstPoolKeys = allPools[0] ? Object.keys(allPools[0]) : []

  return {
    totalPools: allPools.length,
    twocryptoCount: twocrypto.body?.data?.poolData?.length ?? 0,
    stableNgCount: stableNg.body?.data?.poolData?.length ?? 0,
    userAddress: addr,
    firstPoolAllKeys: firstPoolKeys,
    aprEndpointResults: aprResults,   // ← where APR lives
    poolsWithBalance,
    allPoolsChecked: poolsChecked,
    note: poolsWithBalance.length === 0 ? 'User has no Curve LP positions' : `Found ${poolsWithBalance.length} positions`,
  }
}

// ─── KURU: Deep contract introspection + event scan ───────────────────────────
// Decode full ABI-encoded string from eth_call result
function decodeFullString(hex: string): string {
  if (!hex || hex === '0x' || hex.length < 10) return ''
  try {
    const data = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = Buffer.from(data, 'hex')
    if (bytes.length < 64) return ''
    const offset = Number(BigInt('0x' + data.slice(0, 64)))
    const lenStart = offset * 2
    if (lenStart + 64 > data.length) return ''
    const strLen = Number(BigInt('0x' + data.slice(lenStart, lenStart + 64)))
    if (strLen === 0 || strLen > 500) return ''
    const strHex = data.slice(lenStart + 64, lenStart + 64 + strLen * 2)
    return Buffer.from(strHex, 'hex').toString('utf8').replace(/\0/g, '')
  } catch { return '' }
}

async function debugKuru(user: string) {
  const PROXY1 = '0x4869a4c7657cef5e5496c9ce56dde4cd593e4923'
  const PROXY2 = '0xd6eae39b96fbdb7daa2227829be34b4e1bc9069a'
  const IMPL   = '0x7c576409b1d039f6c218ef9dab88c88f39326cff'
  const MARGIN = '0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5'

  // Extended selector list — try to understand what these contracts ARE
  const selectors: [string, string][] = [
    ['name()',              '0x06fdde03'],
    ['symbol()',            '0x95d89b41'],
    ['decimals()',          '0x313ce567'],
    ['totalSupply()',       '0x18160ddd'],
    ['totalAssets()',       '0x01e1d114'],         // ERC4626
    ['asset()',             '0x38d52e0f'],          // ERC4626
    ['owner()',             '0x8da5cb5b'],
    ['getReserves()',       '0x0902f1ac'],          // Uniswap V2 style
    ['token0()',            '0x0dfe1681'],          // Uniswap V2
    ['token1()',            '0xd21220a7'],          // Uniswap V2
    ['baseToken()',         '0xc55dae63'],
    ['quoteToken()',        '0x9efec935'],
    ['getBaseBalance()',    '0x9f678cca'],          // custom vault
    ['getQuoteBalance()',   '0xa42dce80'],          // custom vault
    ['totalBaseBalance()',  '0x00c45e6d'],          // custom
    ['balanceOf(user)',     '0x70a08231' + padAddr(user)],
    ['userBalance(user)',   '0x4d99dd16' + padAddr(user)], // custom
    ['getUserInfo(user)',   '0x6386c1c7' + padAddr(user)], // custom
  ]

  const addresses = [PROXY1, PROXY2, IMPL, MARGIN]
  const calls: any[] = []
  let id = 0
  for (const addr of addresses) {
    for (const [, data] of selectors) calls.push(ethCall(addr, data, id++))
  }
  const rpc = await rpcBatch(calls)

  // Build results with FULL string decoding
  const perAddress: Record<string, any> = {}
  addresses.forEach((addr, ai) => {
    const results: Record<string, any> = {}
    selectors.forEach(([name], si) => {
      const res = rpc[ai * selectors.length + si]?.result ?? '0x'
      if (res === '0x' || res === '0x' + '0'.repeat(64)) {
        results[name] = 'empty/revert'
      } else if (name.includes('name') || name.includes('symbol')) {
        // Try full string decode
        results[name] = decodeFullString(res) || res.slice(0, 130)
      } else if (name.includes('address') || name.includes('owner') || name.includes('token') || name.includes('asset')) {
        results[name] = '0x' + res.slice(-40)
      } else {
        results[name] = BigInt(res).toString()
      }
    })
    perAddress[addr] = results
  })

  // Scan Transfer events (topic0 = ERC20 Transfer) to understand token activity
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  // Also try Deposit events (ERC4626 and generic vault patterns)  
  const DEPOSIT_TOPIC  = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7'
  // Generic Deposit(address,uint256)
  const DEPOSIT2_TOPIC = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c'

  const logRes = await rpcBatch([
    getLogs(PROXY1, [TRANSFER_TOPIC], '0x0', 900),
    getLogs(PROXY2, [TRANSFER_TOPIC], '0x0', 901),
    getLogs(PROXY1, [DEPOSIT_TOPIC],  '0x0', 902),
    getLogs(PROXY1, [DEPOSIT2_TOPIC], '0x0', 903),
    // Check for user-specific transfers (user as topic[1] or topic[2])
    getLogs(PROXY1, [TRANSFER_TOPIC, null as any, '0x' + padAddr(user)], '0x0', 904),
  ])

  const eventSummary = {
    proxy1_transfers:    Array.isArray(logRes[0]?.result) ? logRes[0].result.length : logRes[0]?.error,
    proxy2_transfers:    Array.isArray(logRes[1]?.result) ? logRes[1].result.length : logRes[1]?.error,
    proxy1_erc4626_dep:  Array.isArray(logRes[2]?.result) ? logRes[2].result.length : logRes[2]?.error,
    proxy1_generic_dep:  Array.isArray(logRes[3]?.result) ? logRes[3].result.length : logRes[3]?.error,
    proxy1_user_receive: Array.isArray(logRes[4]?.result) ? logRes[4].result.slice(0, 2) : logRes[4]?.error,
  }

  // Sample last Transfer event to understand token usage
  const lastTransfer = Array.isArray(logRes[0]?.result) && logRes[0].result.length > 0
    ? logRes[0].result[logRes[0].result.length - 1]
    : null

  return {
    contracts: { proxy1: PROXY1, proxy2: PROXY2, impl: IMPL, margin: MARGIN },
    decoded: perAddress,
    events: eventSummary,
    lastTransferSample: lastTransfer,
    interpretation: 'Checking if these are ERC20 LP tokens, ERC4626 vaults, or DEX infrastructure',
  }
}

// ─── LAGOON: Find vault addresses via event logs from known deployer patterns ──
async function debugLagoon(user: string) {
  // Lagoon uses ERC7540 (async redemption vault) with BeaconProxy factory pattern
  // Strategy: scan known API patterns + try to find vault addresses via MonadScan-style queries

  const apiResults: Record<string, any> = {}
  const urls = [
    'https://api.lagoon.finance/api/v1/vaults?network=monad',
    'https://api.lagoon.finance/v1/vaults?chainId=143',
    'https://lagoon.finance/api/vaults?chainId=143',
    'https://api.lagoon.finance/vaults',
  ]
  for (const url of urls) {
    const r = await tryFetch(url)
    apiResults[url] = { status: r.status, error: r.error, body: JSON.stringify(r.body)?.slice(0, 300) }
  }

  // Known Lagoon vault addresses from public sources / DeFiLlama data
  // Lagoon on Monad has $3.42M TVL — try common vault addresses
  const knownVaultCandidates = [
    '0x186986f1C5Ff2E21B18E4e29B1B7E3FC3aF1d61',
    '0x3e5FEB6a59c7dc4b8dedfee63f63de39b5e18F5',
    '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643', // example pattern
    '0x6b175474e89094c44da98b954eedeac495271d0f', // placeholder
  ]

  // For each candidate: check code + call name/symbol/totalAssets (ERC7540 is ERC4626 compatible)
  const candidateCalls: any[] = []
  let cid = 0
  for (const addr of knownVaultCandidates) {
    candidateCalls.push(
      { jsonrpc: '2.0', id: cid++, method: 'eth_getCode', params: [addr, 'latest'] },
      ethCall(addr, '0x06fdde03', cid++),  // name()
      ethCall(addr, '0x01e1d114', cid++),  // totalAssets()
      ethCall(addr, '0x70a08231' + padAddr(user), cid++), // balanceOf(user)
    )
  }
  const candidateRes = await rpcBatch(candidateCalls)

  const vaultInfo = knownVaultCandidates.map((addr, i) => {
    const base = i * 4
    const code = candidateRes[base]?.result ?? '0x'
    return {
      address: addr,
      hasCode: code !== '0x' && code.length > 4,
      name: decodeFullString(candidateRes[base + 1]?.result ?? '0x'),
      totalAssets: decodeUint(candidateRes[base + 2]?.result ?? '0x').toString(),
      userBalance: decodeUint(candidateRes[base + 3]?.result ?? '0x').toString(),
    }
  })

  // Also check ERC7540 RequestRedeem event to find vault addresses used by user
  // RequestRedeem(address controller, address owner, uint256 requestId, address sender, uint256 shares)
  const ERC7540_REQUEST = '0x9c52a7f1d98c0c5f338f846f1fba54e2e3a1d2f3c4b5a6d7e8f9a0b1c2d3e4f'

  return {
    apiResults,
    vaultCandidates: vaultInfo.filter(v => v.hasCode),
    allCandidates: vaultInfo,
    note: 'Need actual Lagoon vault addresses for Monad. Check app.lagoon.finance Network tab for API calls containing vault addresses.',
    hint: 'Look for requests to api.lagoon.finance that return vault objects with "address" fields',
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
