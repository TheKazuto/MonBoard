import { NextResponse } from 'next/server'
import { rpcBatch, getMonPrice } from '@/lib/monad'

export const revalidate = 0

// ─── Helpers (copied from defi/route.ts) ──────────────────────────────────────
function ethCall(to: string, data: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }
}
function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex.startsWith('0x') ? hex : '0x' + hex) } catch { return 0n }
}
function balanceOfData(addr: string): string {
  return '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0')
}

// ─── Test runner helper ────────────────────────────────────────────────────────
async function test(
  name: string,
  fn: () => Promise<unknown>,
): Promise<ProtocolStatus> {
  const start = Date.now()
  try {
    const result = await fn()
    const duration = Date.now() - start
    const isArray  = Array.isArray(result)
    const count    = isArray ? result.length : (result ? 1 : 0)
    return {
      protocol: name,
      status:   'ok',
      duration,
      count,
      sample:   isArray ? result.slice(0, 2) : result,
      error:    null,
    }
  } catch (err: unknown) {
    return {
      protocol: name,
      status:   'error',
      duration: Date.now() - start,
      count:    0,
      sample:   null,
      error:    err instanceof Error ? err.message : String(err),
    }
  }
}

export interface ProtocolStatus {
  protocol: string
  status:   'ok' | 'error' | 'empty'
  duration: number   // ms
  count:    number   // entries returned
  sample:   unknown  // first 1-2 entries for inspection
  error:    string | null
}

// ─── Protocol-specific test functions ─────────────────────────────────────────

// 1. Morpho GraphQL
async function testMorpho(user: string) {
  const query = `query($addr:String!,$cid:Int!){userByAddress(address:$addr,chainId:$cid){marketPositions{market{uniqueKey loanAsset{symbol}collateralAsset{symbol}state{supplyApy borrowApy}}supplyAssetsUsd borrowAssetsUsd collateralUsd healthFactor}vaultPositions{vault{name symbol state{netApy}}assetsUsd}}}`
  const res = await fetch('https://api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { addr: user.toLowerCase(), cid: 143 } }),
    signal: AbortSignal.timeout(12_000), cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.errors?.length) throw new Error(data.errors[0].message)
  const u = data?.data?.userByAddress
  return {
    marketPositions: u?.marketPositions?.length ?? 0,
    vaultPositions:  u?.vaultPositions?.length  ?? 0,
    raw: u,
  }
}

// 2. Neverland (Aave V3 fork) — getUserAccountData + token balances
const NEVERLAND_POOL = '0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585'
const NEVERLAND_SUPPLY_TOKENS = [
  '0xD0fd2Cf7F6CEff4F96B1161F5E995D5843326154',
  '0x34c43684293963c546b0aB6841008A4d3393B9ab',
  '0x31f63Ae5a96566b93477191778606BeBDC4CA66f',
  '0x784999fc2Dd132a41D1Cc0F1aE9805854BaD1f2D',
  '0x38648958836eA88b368b4ac23b86Ad44B0fe7508',
  '0x39F901c32b2E0d25AE8DEaa1ee115C748f8f6bDf',
  '0xdFC14d336aea9E49113b1356333FD374e646Bf85',
  '0x7f81779736968836582D31D36274Ed82053aD1AE',
  '0xC64d73Bb8748C6fA7487ace2D0d945B6fBb2EcDe',
]
async function testNeverland(user: string) {
  const calls = [
    ethCall(NEVERLAND_POOL, '0xbf92857c' + user.slice(2).toLowerCase().padStart(64, '0'), 0),
    ...NEVERLAND_SUPPLY_TOKENS.map((a, i) => ethCall(a, balanceOfData(user), i + 1)),
  ]
  const results = await rpcBatch(calls)
  const acctData = results[0]?.result
  const hasAcct  = acctData && acctData !== '0x' && acctData.length > 10
  const nonZeroBalances = NEVERLAND_SUPPLY_TOKENS.filter((_, i) => {
    const r = results[i + 1]?.result
    return r && r !== '0x' && decodeUint(r) > 0n
  }).length
  return { rpcCallsSuccess: results.length, hasAccountData: hasAcct, nonZeroSupplyTokens: nonZeroBalances }
}

// 3. Uniswap V3
const UNI_NFT_PM = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'
async function testUniswapV3(user: string) {
  const res = await rpcBatch([ethCall(UNI_NFT_PM, balanceOfData(user), 1)])
  const count = Number(decodeUint(res[0]?.result ?? '0x'))
  return { nftPositionCount: count, nftPM: UNI_NFT_PM }
}

// 4. PancakeSwap V3
const PCAKE_NFT_PM = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364'
async function testPancakeSwap(user: string) {
  const res = await rpcBatch([ethCall(PCAKE_NFT_PM, balanceOfData(user), 1)])
  const count = Number(decodeUint(res[0]?.result ?? '0x'))
  return { nftPositionCount: count, nftPM: PCAKE_NFT_PM }
}

// 5. Curve
async function testCurve(user: string) {
  const res = await fetch(`https://api.curve.fi/v1/getLiquidityProviderData/${user.toLowerCase()}/monad-mainnet`,
    { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const lp = data?.data?.lpData ?? []
  return { positionCount: lp.length, active: lp.filter((p: any) => Number(p.liquidityUsd ?? 0) > 0).length, endpoint: `curve.fi/v1/getLiquidityProviderData/${user}/monad` }
}

// 6. Gearbox
async function testGearbox(user: string) {
  // Gearbox uses chain-specific API subdomains: {chain}.gearbox-api.com
  const url = `https://monad.gearbox-api.com/api/v1/user/creditAccounts?userAddress=${user.toLowerCase()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  const status = res.status
  if (!res.ok) throw new Error(`HTTP ${status} — tried monad.gearbox-api.com`)
  const data = await res.json()
  const accounts = data?.creditAccounts ?? data?.accounts ?? data ?? []
  return { httpStatus: status, endpoint: url, accountCount: Array.isArray(accounts) ? accounts.length : 0 }
}

// 7. Upshift
const UPSHIFT_VAULT = '0x103222f020e98Bba0AD9809A011FDF8e6F067496'
async function testUpshift(user: string) {
  const res = await rpcBatch([ethCall(UPSHIFT_VAULT, balanceOfData(user), 1)])
  const shares = decodeUint(res[0]?.result ?? '0x')
  return { vaultAddress: UPSHIFT_VAULT, sharesBalance: shares.toString(), hasBalance: shares > 0n }
}

// 8. Kintsu
const KINTSU_SMON = '0xA3227C5969757783154C60bF0bC1944180ed81B9'
async function testKintsu(user: string) {
  const res = await rpcBatch([ethCall(KINTSU_SMON, balanceOfData(user), 1)])
  const shares = decodeUint(res[0]?.result ?? '0x')
  return { sMONAddress: KINTSU_SMON, sharesBalance: (Number(shares) / 1e18).toFixed(6), hasBalance: shares > 0n }
}

// 9. Magma
const MAGMA_GMON = '0x8498312a6b3CBD158Bf0c93ABdcF29E6e4f55081'
async function testMagma(user: string) {
  const res = await rpcBatch([ethCall(MAGMA_GMON, balanceOfData(user), 1)])
  const shares = decodeUint(res[0]?.result ?? '0x')
  return { gMONAddress: MAGMA_GMON, sharesBalance: (Number(shares) / 1e18).toFixed(6), hasBalance: shares > 0n }
}

// 10. shMonad
const SHMONAD_ADDR = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
async function testShMonad(user: string) {
  const res = await rpcBatch([ethCall(SHMONAD_ADDR, balanceOfData(user), 1)])
  const shares = decodeUint(res[0]?.result ?? '0x')
  return { shMONAddress: SHMONAD_ADDR, sharesBalance: (Number(shares) / 1e18).toFixed(6), hasBalance: shares > 0n }
}

// 11. Lagoon
// Lagoon is purely on-chain (ERC7540 standard) — no REST API exists
// Vaults are queried by calling balanceOf/maxMint/pendingRedeemRequest on each vault contract
// Known Lagoon vaults on Monad mainnet (from app.lagoon.finance/vault/143/*)
const LAGOON_VAULTS_MONAD = [
  { address: '0x87Ff7Bbb38E59B77B8F6F9B21DCaB77B7B700d4F', name: 'Lagoon USDC Vault' },
  { address: '0xd2E85F0B33AaD7f43Ab6B5e35aaFc5B0C44E5c7A', name: 'Lagoon MON Vault' },
]
async function testLagoon(user: string) {
  const ABI_BAL = balanceOfData(user)
  const calls = LAGOON_VAULTS_MONAD.flatMap((v, i) => [
    ethCall(v.address, ABI_BAL, i * 2),
    // maxMint(user) selector: 0xd905777e
    ethCall(v.address, '0xd905777e' + user.slice(2).toLowerCase().padStart(64, '0'), i * 2 + 1),
  ])
  const results = await rpcBatch(calls)
  const vaultData = LAGOON_VAULTS_MONAD.map((v, i) => ({
    vault: v.name,
    address: v.address,
    shares: (Number(decodeUint(results[i * 2]?.result ?? '0x')) / 1e18).toFixed(6),
    claimable: (Number(decodeUint(results[i * 2 + 1]?.result ?? '0x')) / 1e18).toFixed(6),
    note: results[i * 2]?.result === '0x' ? 'contract may not exist' : 'ok',
  }))
  return { protocol: 'Lagoon (on-chain ERC7540)', vaults: vaultData, note: 'No REST API — queried directly from vault contracts' }
}

// 12. Renzo
// Renzo on Monad may be a different product than ETH restaking
// Try their API with Monad chain ID, and also check if they have a staking token on-chain
const RENZO_ENDPOINTS_TO_TRY = [
  'https://app.renzoprotocol.com/api/portfolio?chainId=143',
  'https://api.renzoprotocol.com/v1/portfolio?chainId=143',
  'https://api.renzoprotocol.com/portfolio/monad',
]
async function testRenzo(user: string) {
  const results: Record<string, unknown> = {}
  for (const url of RENZO_ENDPOINTS_TO_TRY) {
    try {
      const res = await fetch(url.includes('portfolio') ? `${url}&address=${user}` : url,
        { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
      results[url] = { status: res.status, ok: res.ok }
      if (res.ok) {
        const data = await res.json()
        return { found: true, endpoint: url, data }
      }
    } catch (e: unknown) {
      results[url] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { found: false, note: 'All known Renzo endpoints failed for Monad chainId=143', tried: results }
}

// 13. Kuru
// Kuru uses a private API (KURU_API env var in their SDK)
// Trying multiple known URL patterns for their order book DEX
const KURU_ENDPOINTS_TO_TRY = [
  `https://api.kuru.io/v1/user/positions?address={user}&chain=monad`,
  `https://api.kuru.io/user/{user}/positions`,
  `https://api.kuru.io/markets`,  // List markets without user — just to test connectivity
  `https://backend.kuru.io/v1/markets`,
]
async function testKuru(user: string) {
  const results: Record<string, unknown> = {}
  for (const template of KURU_ENDPOINTS_TO_TRY) {
    const url = template.replace('{user}', user.toLowerCase())
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
      results[url] = { status: res.status, ok: res.ok }
      if (res.ok) {
        const data = await res.json()
        return { found: true, endpoint: url, data }
      }
    } catch (e: unknown) {
      results[url] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { found: false, note: 'Kuru API URL is not publicly documented (uses KURU_API env var)', tried: results }
}

// 14. Curvance
const CURVANCE_CTOKENS = [
  { address: '0xD9E2025b907E95EcC963A5018f56B87575B4aB26', underlying: 'aprMON' },
  { address: '0x926C101Cf0a3dE8725Eb24a93E980f9FE34d6230', underlying: 'shMON'  },
  { address: '0x494876051B0E85dCe5ecd5822B1aD39b9660c928', underlying: 'sMON'   },
  { address: '0x5ca6966543c0786f547446234492d2f11c82f11f', underlying: 'gMON'   },
]
async function testCurvance(user: string) {
  const calls = CURVANCE_CTOKENS.map((t, i) => ethCall(t.address, balanceOfData(user), i))
  const results = await rpcBatch(calls)
  const balances = CURVANCE_CTOKENS.map((t, i) => ({
    token: t.underlying,
    address: t.address,
    balance: (Number(decodeUint(results[i]?.result ?? '0x')) / 1e18).toFixed(6),
  }))
  return { rpcCallsSuccess: results.length, collateralTokens: balances }
}

// 15. Euler V2
// Euler V2 uses Goldsky subgraphs, one per chain
// Monad is not in their official list yet, trying the pattern euler-v2-monad
const EULER_ENDPOINTS_TO_TRY = [
  'https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-v2-monad/latest/gn',
  'https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-v2-monad-mainnet/latest/gn',
  'https://api.euler.finance/graphql',  // try their centralized API too
]
const EULER_QUERY = `query($account:String!){
  trackingActiveAccount(id:$account){mainAddress deposits borrows}
}`
async function testEulerV2(user: string) {
  const results: Record<string, unknown> = {}
  for (const url of EULER_ENDPOINTS_TO_TRY) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: EULER_QUERY, variables: { account: user.toLowerCase() } }),
        signal: AbortSignal.timeout(10_000), cache: 'no-store',
      })
      const status = res.status
      results[url] = { status, ok: res.ok }
      if (res.ok) {
        const data = await res.json()
        if (!data.errors?.length) {
          return { found: true, endpoint: url, data: data?.data, note: 'Goldsky subgraph found' }
        }
        results[url] = { status, graphqlError: data.errors?.[0]?.message }
      }
    } catch (e: unknown) {
      results[url] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { found: false, note: 'No Euler V2 Monad subgraph found yet (not in official Goldsky list)', tried: results }
}

// 16. Midas
const MIDAS_TOKENS = [
  { address: '0x8a0e8e76A5c7Cd21deb5A0975eCb8C7C0bC1d7e5', symbol: 'mTBILL' },
  { address: '0x2e3421dEB8B0D640a2E3A9f4e2591B01A43e96F7', symbol: 'mBASIS' },
]
async function testMidas(user: string) {
  const calls = MIDAS_TOKENS.map((t, i) => ethCall(t.address, balanceOfData(user), i))
  const results = await rpcBatch(calls)
  const balances = MIDAS_TOKENS.map((t, i) => ({
    token: t.symbol, address: t.address,
    balance: (Number(decodeUint(results[i]?.result ?? '0x')) / 1e18).toFixed(6),
    note: results[i]?.result === '0x' ? 'contract may not exist on Monad mainnet' : 'ok',
  }))
  return { rpcCallsSuccess: results.length, tokens: balances }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url     = new URL(req.url)
  const address = url.searchParams.get('address') ?? '0x0000000000000000000000000000000000000001'

  // Run MON price check first (shared dependency)
  let monPrice = 0
  try { monPrice = await getMonPrice() } catch { /* skip */ }

  // Run all 16 protocol tests in parallel
  const results = await Promise.all([
    test('1. Morpho',       () => testMorpho(address)),
    test('2. Neverland',    () => testNeverland(address)),
    test('3. Uniswap V3',   () => testUniswapV3(address)),
    test('4. PancakeSwap V3', () => testPancakeSwap(address)),
    test('5. Curve',        () => testCurve(address)),
    test('6. Gearbox',      () => testGearbox(address)),
    test('7. Upshift',      () => testUpshift(address)),
    test('8. Kintsu',       () => testKintsu(address)),
    test('9. Magma',        () => testMagma(address)),
    test('10. shMonad',     () => testShMonad(address)),
    test('11. Lagoon',      () => testLagoon(address)),
    test('12. Renzo',       () => testRenzo(address)),
    test('13. Kuru',        () => testKuru(address)),
    test('14. Curvance',    () => testCurvance(address)),
    test('15. Euler V2',    () => testEulerV2(address)),
    test('16. Midas',       () => testMidas(address)),
  ])

  // Mark entries with 0 results as 'empty' (different from 'error')
  const final = results.map(r =>
    r.status === 'ok' && r.count === 0 ? { ...r, status: 'empty' as const } : r
  )

  const summary = {
    total:   final.length,
    ok:      final.filter(r => r.status === 'ok').length,
    empty:   final.filter(r => r.status === 'empty').length,
    errors:  final.filter(r => r.status === 'error').length,
    monPrice,
    testedAddress: address,
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json({ summary, results: final })
}
