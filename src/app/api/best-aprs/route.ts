import { NextResponse } from 'next/server'
import { rpcBatch } from '@/lib/monad'

export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AprEntry {
  protocol:   string
  logo:       string
  url:        string
  tokens:     string[]      // symbols involved
  label:      string        // human-readable name
  apr:        number        // annual percentage rate (e.g. 8.5 = 8.5%)
  type:       'pool' | 'vault' | 'lend'
  isStable:   boolean       // true when ALL tokens are stablecoins
}

// ─── Stablecoin classification ────────────────────────────────────────────────
const STABLECOINS = new Set([
  'USDC', 'USDT', 'USDT0', 'AUSD', 'DAI', 'FRAX', 'BUSD',
  'USDC.e', 'mTBILL', 'crvUSD', 'TUSD', 'LUSD', 'MIM', 'USD1', 'LVUSD',
])

function isStable(sym: string): boolean { return STABLECOINS.has(sym) }
function allStable(tokens: string[]): boolean { return tokens.length > 0 && tokens.every(isStable) }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONAD_RPC = 'https://rpc.monad.xyz'

function ethCall(to: string, data: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }
}

// Convert RAY (1e27) to percentage APR
function rayToApr(hex: string, wordIndex: number): number {
  if (!hex || hex === '0x' || hex.length < 2 + (wordIndex + 1) * 64) return 0
  try {
    const words = hex.slice(2).match(/.{64}/g) ?? []
    if (!words[wordIndex]) return 0
    const rate = BigInt('0x' + words[wordIndex])
    return Number(rate) / 1e27 * 100
  } catch { return 0 }
}

// ─── Server-side cache ────────────────────────────────────────────────────────
// Caches the full API response for CACHE_TTL ms. Deduplicates in-flight requests
// so concurrent visitors share one set of external API calls.
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes

interface CacheEntry {
  data:      any
  fetchedAt: number
  promise:   Promise<any> | null
}

let serverCache: CacheEntry | null = null

// ─── MORPHO — markets (lend) + vaults ────────────────────────────────────────
// APY → APR conversion (daily compounding assumed)
function apyToApr(apy: number): number {
  if (apy <= 0) return 0
  return 365 * (Math.pow(1 + apy, 1 / 365) - 1)
}

async function fetchMorpho(): Promise<AprEntry[]> {
  const query = `{
    markets(where:{chainId_in:[143]}, first:100) {
      items {
        uniqueKey
        loanAsset { symbol }
        collateralAsset { symbol }
        state { supplyApy borrowApy }
      }
    }
    vaults(where:{chainId_in:[143]}, first:50) {
      items {
        address
        name
        symbol
        asset { symbol }
        state { netApy }
      }
    }
  }`
  try {
    const res = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    const data = await res.json()
    const out: AprEntry[] = []

    for (const m of data?.data?.markets?.items ?? []) {
      const supplyApy = Number(m.state?.supplyApy ?? 0)
      const supplyApr = apyToApr(supplyApy) * 100
      const loanSym   = m.loanAsset?.symbol ?? '?'
      const collSym   = m.collateralAsset?.symbol
      if (supplyApr < 0.01) continue
      const tokens = collSym ? [collSym, loanSym] : [loanSym]
      const url = m.uniqueKey
        ? `https://app.morpho.org/monad/market?id=${m.uniqueKey}`
        : 'https://app.morpho.org/monad'
      out.push({
        protocol: 'Morpho', logo: '🦋', url,
        tokens, label: collSym ? `${collSym} / ${loanSym}` : loanSym,
        apr: supplyApr, type: 'lend', isStable: allStable(tokens),
      })
    }
    for (const v of data?.data?.vaults?.items ?? []) {
      const netApy = Number(v.state?.netApy ?? 0)
      const netApr = apyToApr(netApy) * 100
      const sym    = v.asset?.symbol ?? '?'
      if (netApr < 0.01) continue
      const url = v.address
        ? `https://app.morpho.org/monad/vault?address=${v.address}`
        : 'https://app.morpho.org/monad'
      out.push({
        protocol: 'Morpho', logo: '🦋', url,
        tokens: [sym], label: v.name ?? v.symbol ?? sym,
        apr: netApr, type: 'vault', isStable: isStable(sym),
      })
    }
    return out
  } catch { return [] }
}

// ─── NEVERLAND (Aave V3 fork) — supply & borrow rates ────────────────────────
const NEVERLAND_POOL   = '0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585'
const NEVERLAND_ASSETS = [
  { address: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', symbol: 'WMON'  },
  { address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', symbol: 'WBTC'  },
  { address: '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242', symbol: 'WETH'  },
  { address: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', symbol: 'AUSD'  },
  { address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', symbol: 'USDC'  },
  { address: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', symbol: 'USDT0' },
  { address: '0xa3227c5969757783154c60bf0bc1944180ed81b9', symbol: 'sMON'  },
  { address: '0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081', symbol: 'gMON'  },
  { address: '0x1b68626dca36c7fe922fd2d55e4f631d962de19c', symbol: 'shMON' },
]

async function fetchNeverland(): Promise<AprEntry[]> {
  try {
    const calls = NEVERLAND_ASSETS.map((a, i) =>
      ethCall(NEVERLAND_POOL, '0x35ea6a75' + a.address.slice(2).toLowerCase().padStart(64, '0'), i)
    )
    const results = await rpcBatch(calls)
    const out: AprEntry[] = []

    NEVERLAND_ASSETS.forEach((asset, i) => {
      const hex = results[i]?.result ?? ''
      const supplyApr = rayToApr(hex, 2)
      if (supplyApr < 0.01) return
      out.push({
        protocol: 'Neverland', logo: '🌙', url: 'https://app.neverland.money',
        tokens: [asset.symbol], label: asset.symbol,
        apr: supplyApr, type: 'lend', isStable: isStable(asset.symbol),
      })
    })
    return out
  } catch { return [] }
}

// ─── EULER V2 — vaults (supply APR) ──────────────────────────────────────────
async function fetchEulerV2(): Promise<AprEntry[]> {
  const query = `{
    vaults(where:{chainId:143},first:100) {
      name
      asset { symbol }
      state { supplyApy borrowApy }
    }
  }`
  try {
    const res = await fetch('https://api.euler.finance/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data?.data?.vaults ?? [])
      .filter((v: any) => Number(v.state?.supplyApy ?? 0) > 0)
      .map((v: any) => {
        const sym    = v.asset?.symbol ?? '?'
        const supApr = Number(v.state?.supplyApy ?? 0) * 100
        return {
          protocol: 'Euler V2', logo: '📐', url: 'https://app.euler.finance',
          tokens: [sym], label: v.name ?? sym,
          apr: supApr, type: 'lend' as const, isStable: isStable(sym),
        }
      })
  } catch { return [] }
}

// ─── CURVE — pool APRs via virtualPrice delta ────────────────────────────────
async function fetchCurve(): Promise<AprEntry[]> {
  const BASE       = 'https://api-core.curve.finance/v1'
  const BLOCKS_24H = 195_000 // Monad ~0.44s/block

  try {
    // Pool list + block number (parallel) — removed unused DeFiLlama fetch
    const [r1, r2, bnRes] = await Promise.all([
      fetch(`${BASE}/getPools/monad/factory-twocrypto`,  { signal: AbortSignal.timeout(10_000), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/getPools/monad/factory-stable-ng`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(MONAD_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(4_000),
      }).then(r => r.json()).catch(() => ({ result: '0x0' })),
    ])

    const allPools: any[] = [...(r1?.data?.poolData ?? []), ...(r2?.data?.poolData ?? [])]
    const livePools = allPools.filter(p => Number(p.usdTotalExcludingBasePool ?? p.usdTotal ?? 0) > 100)
    if (livePools.length === 0) return []

    const currentBlock = Number(BigInt(bnRes?.result ?? '0x0'))
    // virtualPrice grows as trading fees accumulate → reliable APR proxy
    const block24h = '0x' + Math.max(0, currentBlock - BLOCKS_24H).toString(16)
    const vpCalls: any[] = []
    livePools.forEach((p, i) => {
      vpCalls.push({ jsonrpc: '2.0', id: i * 2,     method: 'eth_call', params: [{ to: p.address, data: '0xbb7b8b80' }, 'latest']  })
      vpCalls.push({ jsonrpc: '2.0', id: i * 2 + 1, method: 'eth_call', params: [{ to: p.address, data: '0xbb7b8b80' }, block24h] })
    })
    const vpRes = await fetch(MONAD_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vpCalls),
      signal: AbortSignal.timeout(12_000),
    }).then(r => r.json()).then(d => Array.isArray(d) ? d : [d]).catch(() => [])

    const entries: AprEntry[] = []
    livePools.forEach((p, i) => {
      const tvl = Number(p.usdTotalExcludingBasePool ?? p.usdTotal ?? 0)
      if (tvl <= 0) return

      const vpNow = vpRes.find((r: any) => r.id === i * 2)?.result ?? '0x'
      const vpOld = vpRes.find((r: any) => r.id === i * 2 + 1)?.result ?? '0x'
      let apr = 0
      if (vpNow && vpNow !== '0x' && vpOld && vpOld !== '0x') {
        try {
          const now = Number(BigInt(vpNow)) / 1e18
          const old = Number(BigInt(vpOld)) / 1e18
          if (old > 0 && now > old) apr = (Math.pow(now / old, 365) - 1) * 100
        } catch { /* skip */ }
      }

      if (apr < 0.001) return
      const tokens = (p.coins ?? []).map((c: any) => c.symbol).filter(Boolean)
      const poolId = p.id ?? p.address
      entries.push({
        protocol: 'Curve', logo: '🌊',
        url: `https://curve.finance/dex/monad/pools/${poolId}/deposit`,
        tokens, label: p.name ?? tokens.join(' / '),
        apr, type: 'pool' as const, isStable: allStable(tokens),
      })
    })
    return entries
  } catch { return [] }
}

// ─── UPSHIFT — AUSD vault ─────────────────────────────────────────────────────
async function fetchUpshift(): Promise<AprEntry[]> {
  try {
    const res = await fetch('https://app.upshift.finance/api/vaults?chainId=143', {
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const vaults: any[] = data?.vaults ?? data ?? []
    return vaults
      .filter((v: any) => Number(v.apy ?? v.apr ?? 0) > 0)
      .map((v: any) => {
        const sym = v.asset ?? v.underlyingSymbol ?? 'AUSD'
        const apr = Number(v.apy ?? v.apr ?? 0) * (v.apy < 2 ? 100 : 1)
        return {
          protocol: 'Upshift', logo: '🔺', url: 'https://app.upshift.finance',
          tokens: [sym], label: v.name ?? `${sym} Vault`,
          apr, type: 'vault' as const, isStable: isStable(sym),
        }
      })
  } catch { return [] }
}

// ─── LAGOON — vaults ──────────────────────────────────────────────────────────
async function fetchLagoon(): Promise<AprEntry[]> {
  try {
    const res = await fetch('https://api.lagoon.finance/v1/vaults?chainId=143', {
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const vaults: any[] = data?.vaults ?? data ?? []
    return vaults
      .filter((v: any) => Number(v.apy ?? v.apr ?? 0) > 0)
      .map((v: any) => {
        const sym = v.asset ?? v.underlyingSymbol ?? '?'
        const apr = Number(v.apy ?? v.apr ?? 0) * (v.apy < 2 ? 100 : 1)
        return {
          protocol: 'Lagoon', logo: '🏝️', url: 'https://app.lagoon.finance',
          tokens: [sym], label: v.name ?? v.vaultName ?? `${sym} Vault`,
          apr, type: 'vault' as const, isStable: isStable(sym),
        }
      })
  } catch { return [] }
}

// ─── KURU — pool APRs ─────────────────────────────────────────────────────────
async function fetchKuru(): Promise<AprEntry[]> {
  try {
    const res = await fetch('https://api.kuru.io/v1/pools?chain=monad', {
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const pools: any[] = data?.pools ?? data ?? []
    return pools
      .filter((p: any) => Number(p.apy ?? p.apr ?? 0) > 0)
      .map((p: any) => {
        const tokens = [p.base, p.quote].filter(Boolean)
        const apr    = Number(p.apy ?? p.apr ?? 0) * (p.apy < 2 ? 100 : 1)
        return {
          protocol: 'Kuru', logo: '🌀', url: 'https://app.kuru.io',
          tokens, label: tokens.join(' / ') || p.market,
          apr, type: 'pool' as const, isStable: allStable(tokens),
        }
      })
  } catch { return [] }
}

// ─── MIDAS — tokenized RWAs (known fixed APRs) ────────────────────────────────
// Last verified: 2025-05 — update if rates change on midas.app
function getMidas(): AprEntry[] {
  return [
    {
      protocol: 'Midas', logo: '🏛️', url: 'https://midas.app',
      tokens: ['mTBILL'], label: 'Tokenized US T-Bills',
      apr: 4.8, type: 'vault', isStable: true,
    },
    {
      protocol: 'Midas', logo: '🏛️', url: 'https://midas.app',
      tokens: ['mBASIS'], label: 'Basis Trading Strategy',
      apr: 7.2, type: 'vault', isStable: false,
    },
  ]
}

// ─── KINTSU, MAGMA, shMONAD — LST staking vaults (parallel) ─────────────────
async function fetchLSTVaults(): Promise<AprEntry[]> {
  const [kintsuR, magmaR, shmonadR] = await Promise.allSettled([
    fetch('https://api.kintsu.xyz/v1/apr?chainId=143', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    }).then(r => r.ok ? r.json() : null),
    fetch('https://api.magmastaking.xyz/v1/stats?chainId=143', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    }).then(r => r.ok ? r.json() : null),
    fetch('https://api.shmonad.xyz/v1/apr', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    }).then(r => r.ok ? r.json() : null),
  ])

  const entries: AprEntry[] = []

  const kData = kintsuR.status === 'fulfilled' ? kintsuR.value : null
  if (kData) {
    const apr = Number(kData?.apr ?? kData?.stakingApr ?? 0) * (kData?.apr < 2 ? 100 : 1)
    if (apr > 0) entries.push({
      protocol: 'Kintsu', logo: '🔵', url: 'https://kintsu.xyz',
      tokens: ['sMON'], label: 'Staked MON',
      apr, type: 'vault', isStable: false,
    })
  }

  const mData = magmaR.status === 'fulfilled' ? magmaR.value : null
  if (mData) {
    const apr = Number(mData?.apr ?? mData?.stakingApr ?? 0) * (mData?.apr < 2 ? 100 : 1)
    if (apr > 0) entries.push({
      protocol: 'Magma', logo: '🐲', url: 'https://magmastaking.xyz',
      tokens: ['gMON'], label: 'MEV-Optimized Staked MON',
      apr, type: 'vault', isStable: false,
    })
  }

  const sData = shmonadR.status === 'fulfilled' ? shmonadR.value : null
  if (sData) {
    const apr = Number(sData?.apr ?? sData?.stakingApr ?? 0) * (sData?.apr < 2 ? 100 : 1)
    if (apr > 0) entries.push({
      protocol: 'shMonad', logo: '⚡', url: 'https://shmonad.xyz',
      tokens: ['shMON'], label: 'Holistic Staked MON',
      apr, type: 'vault', isStable: false,
    })
  }

  return entries
}

// ─── UNISWAP V3 + V4 — single GraphQL request for both ──────────────────────
function parseUniPools(pools: any[], version: string): AprEntry[] {
  const out: AprEntry[] = []
  for (const p of pools) {
    const tvl    = Number(p.totalLiquidity?.value ?? 0)
    const vol24h = Number(p.cumulativeVolume?.value ?? 0)
    const fee    = Number(p.feeTier ?? 0)
    if (tvl < 100 || vol24h < 1) continue
    const apr = (vol24h * (fee / 1_000_000)) / tvl * 365 * 100
    if (apr < 0.01) continue
    const t0 = p.token0?.symbol ?? '?'
    const t1 = p.token1?.symbol ?? '?'
    const tokens = [t0, t1]
    const feePct = fee / 10000
    const feeLabel = feePct >= 0.01 ? `${feePct}%` : `${fee / 100}bp`
    const poolRef = p.address ?? p.poolId ?? ''
    out.push({
      protocol: `Uniswap ${version}`, logo: '🦄',
      url: `https://app.uniswap.org/explore/pools/monad/${poolRef}`,
      tokens, label: `${t0}/${t1} ${feeLabel}`,
      apr, type: 'pool', isStable: allStable(tokens),
    })
  }
  return out
}

async function fetchUniswap(): Promise<AprEntry[]> {
  try {
    const res = await fetch('https://interface.gateway.uniswap.org/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' },
      body: JSON.stringify({ query: `{
        topV3Pools(chain: MONAD, first: 100) {
          address feeTier
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume(duration: DAY) { value }
        }
        topV4Pools(chain: MONAD, first: 100) {
          poolId feeTier
          token0 { symbol }
          token1 { symbol }
          totalLiquidity { value }
          cumulativeVolume(duration: DAY) { value }
        }
      }` }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    const data = await res.json()
    return [
      ...parseUniPools(data?.data?.topV3Pools ?? [], 'V3'),
      ...parseUniPools(data?.data?.topV4Pools ?? [], 'V4'),
    ]
  } catch { return [] }
}

// ─── MERKL — fetch reward APRs for Monad pools ──────────────────────────────
async function fetchMerklRewardMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const res = await fetch(
      'https://api.merkl.xyz/v4/opportunities?chainId=143&action=POOL&status=LIVE&items=100',
      { signal: AbortSignal.timeout(12_000), cache: 'no-store' },
    )
    if (!res.ok) return map
    const opps: any[] = await res.json()
    for (const o of opps) {
      const addr = (o.identifier ?? '').toLowerCase()
      const apr  = Number(o.apr ?? 0)
      if (addr && apr > 0) {
        map.set(addr, (map.get(addr) ?? 0) + apr)
      }
    }
  } catch { /* ignore */ }
  return map
}

// ─── PANCAKESWAP V3 — pools via explorer API + Merkl rewards ─────────────────
async function fetchPancakeswap(): Promise<AprEntry[]> {
  try {
    const [poolsRes, merklMap] = await Promise.all([
      fetch(
        'https://explorer.pancakeswap.com/api/cached/pools/list?protocols=v3&chains=monad&orderBy=tvlUSD',
        { signal: AbortSignal.timeout(15_000), cache: 'no-store' },
      ),
      fetchMerklRewardMap(),
    ])
    if (!poolsRes.ok) return []
    const data = await poolsRes.json()
    const rows: any[] = data?.rows ?? []
    const out: AprEntry[] = []
    for (const p of rows) {
      const tvl    = Number(p.tvlUSD ?? 0)
      const feeApr = Number(p.apr24h ?? 0) * 100
      if (tvl < 100) continue
      const poolAddr = (p.id ?? '').toLowerCase()
      const rewardApr = merklMap.get(poolAddr) ?? 0
      const apr = feeApr + rewardApr
      if (apr < 0.01) continue
      const t0 = p.token0?.symbol ?? '?'
      const t1 = p.token1?.symbol ?? '?'
      const tokens = [t0, t1]
      const fee = Number(p.feeTier ?? 0)
      const feePct = fee / 10000
      const feeLabel = feePct >= 0.01 ? `${feePct}%` : `${fee / 100}bp`
      out.push({
        protocol: 'PancakeSwap V3', logo: '🥞',
        url: `https://pancakeswap.finance/liquidity/pool/monad/${p.id ?? ''}`,
        tokens, label: `${t0}/${t1} ${feeLabel}`,
        apr, type: 'pool', isStable: allStable(tokens),
      })
    }
    return out
  } catch { return [] }
}

// ─── Fetch all data (used by cache) ──────────────────────────────────────────
async function fetchAllData() {
  const [morphoR, neverlandR, eulerR, curveR, upshiftR, lagoonR, kuruR, lstR, uniR, pancakeR] =
    await Promise.allSettled([
      fetchMorpho(),
      fetchNeverland(),
      fetchEulerV2(),
      fetchCurve(),
      fetchUpshift(),
      fetchLagoon(),
      fetchKuru(),
      fetchLSTVaults(),
      fetchUniswap(),
      fetchPancakeswap(),
    ])

  function unwrap(r: PromiseSettledResult<AprEntry[]>): AprEntry[] {
    return r.status === 'fulfilled' ? r.value : []
  }

  const all: AprEntry[] = [
    ...unwrap(morphoR),
    ...unwrap(neverlandR),
    ...unwrap(eulerR),
    ...unwrap(curveR),
    ...unwrap(upshiftR),
    ...unwrap(lagoonR),
    ...unwrap(kuruR),
    ...unwrap(lstR),
    ...unwrap(uniR),
    ...unwrap(pancakeR),
    ...getMidas(),
  ].filter(e => e.apr > 0)

  const byApr = (a: AprEntry, b: AprEntry) => b.apr - a.apr

  const stableAPRs = all.filter(e => e.isStable).sort(byApr).slice(0, 5)
  const pools  = all.filter(e => e.type === 'pool').sort(byApr).slice(0, 10)
  const vaults = all.filter(e => e.type === 'vault').sort(byApr).slice(0, 10)
  const lends  = all.filter(e => e.type === 'lend').sort(byApr).slice(0, 10)

  return {
    stableAPRs,
    pools,
    vaults,
    lends,
    lastUpdated: Date.now(),
    totalEntries: all.length,
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET() {
  const now = Date.now()

  // Return cached data if fresh
  if (serverCache && !serverCache.promise && now - serverCache.fetchedAt < CACHE_TTL) {
    return NextResponse.json(serverCache.data)
  }

  // Deduplicate in-flight requests — reuse if another request is already fetching
  if (serverCache?.promise) {
    try {
      const data = await serverCache.promise
      return NextResponse.json(data)
    } catch { /* fall through to retry */ }
  }

  // Fire new fetch, store promise for dedup
  const promise = fetchAllData()

  serverCache = {
    data:      serverCache?.data ?? null,
    fetchedAt: serverCache?.fetchedAt ?? 0,
    promise,
  }

  try {
    const data = await promise
    serverCache = { data, fetchedAt: Date.now(), promise: null }
    return NextResponse.json(data)
  } catch {
    // Clear promise so next request retries
    if (serverCache) serverCache.promise = null
    // Return stale data if available
    if (serverCache?.data) {
      return NextResponse.json(serverCache.data)
    }
    return NextResponse.json({ error: 'Failed to fetch APR data' }, { status: 500 })
  }
}
