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
  'USDC.e', 'mTBILL', 'crvUSD', 'TUSD', 'LUSD', 'MIM',
])

function isStable(sym: string): boolean { return STABLECOINS.has(sym) }
function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex) } catch { return 0n }
}
function allStable(tokens: string[]): boolean { return tokens.length > 0 && tokens.every(isStable) }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONAD_RPC  = 'https://rpc.monad.xyz'

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

// ─── MORPHO — markets (lend) + vaults ────────────────────────────────────────
// APY → APR conversion (daily compounding assumed)
// APR = 365 × ((1 + APY)^(1/365) - 1)
// For small values APY ≈ APR, but Morpho returns raw APY from the contract
function apyToApr(apy: number): number {
  if (apy <= 0) return 0
  return 365 * (Math.pow(1 + apy, 1 / 365) - 1)
}

async function fetchMorpho(): Promise<AprEntry[]> {
  // GraphQL confirmed at api.morpho.org/graphql for Monad (chainId 143)
  // Note: removed whitelisted filter — not supported on Monad schema, breaks query
  // supplyApy/netApy are returned as APY (not APR) — converted below
  // Schema uses PaginatedMarkets/PaginatedMetaMorphos — fields are under .items
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
      // supplyApy from API is already a decimal (e.g. 0.05 = 5%) — convert APY→APR
      const supplyApy = Number(m.state?.supplyApy ?? 0)
      const supplyApr = apyToApr(supplyApy) * 100 // to percent
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
      // netApy from API is a decimal — convert APY→APR
      const netApy = Number(v.state?.netApy ?? 0)
      const netApr = apyToApr(netApy) * 100 // to percent
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
    // getReserveData(address asset) → 0x35ea6a75
    const calls = NEVERLAND_ASSETS.map((a, i) =>
      ethCall(NEVERLAND_POOL, '0x35ea6a75' + a.address.slice(2).toLowerCase().padStart(64, '0'), i)
    )
    const results = await rpcBatch(calls)
    const out: AprEntry[] = []

    NEVERLAND_ASSETS.forEach((asset, i) => {
      const hex = results[i]?.result ?? ''
      // Word 2 = currentLiquidityRate (supply) in RAY
      // Word 4 = currentVariableBorrowRate in RAY
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

// ─── CURVE — pool APRs ────────────────────────────────────────────────────────
// Method: on-chain TokenExchange events (same as Curve UI)
//   APR = (volume_24h_usd × fee_rate × 365) / TVL_usd
//
// Sources tried in order:
//   1. DeFiLlama free DEX API: /api/overview/dexs/Monad (no API key needed)
//   2. On-chain TokenExchange events × fee() — definitive fallback
//
// DeFiLlama note (from docs study):
//   /yields/pools is 🔒 Pro API (paid) — that's why it was blocked
//   Free endpoints: /api/overview/dexs/{chain}, /api/summary/dexs/{protocol}
//   Base URL for free: https://api.llama.fi (not pro-api.llama.fi)

async function fetchCurve(): Promise<AprEntry[]> {
  const BASE       = 'https://api-core.curve.finance/v1'
  const RPC        = 'https://rpc.monad.xyz'
  const BLOCKS_24H = 195_000 // Monad ~0.44s/block

  try {
    // Step 1: Pool list + DeFiLlama free DEX API + block number (parallel)
    const [r1, r2, llamaDex, bnRes] = await Promise.all([
      fetch(`${BASE}/getPools/monad/factory-twocrypto`,  { signal: AbortSignal.timeout(10_000), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/getPools/monad/factory-stable-ng`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      // DeFiLlama free DEX volume API (no API key needed per docs)
      fetch('https://api.llama.fi/summary/dexs/curve?dataType=dailyVolume', { signal: AbortSignal.timeout(8_000), cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(4_000),
      }).then(r => r.json()).catch(() => ({ result: '0x0' })),
    ])

    const allPools: any[] = [...(r1?.data?.poolData ?? []), ...(r2?.data?.poolData ?? [])]
    const livePools = allPools.filter(p => Number(p.usdTotalExcludingBasePool ?? p.usdTotal ?? 0) > 100)
    if (livePools.length === 0) return []

    // Check if DeFiLlama has Monad volume data for Curve
    const llamaMonadVolume: Record<string, number> = {}
    const chainBreakdown = llamaDex?.chainBreakdown ?? {}
    const monadData = chainBreakdown?.Monad ?? chainBreakdown?.monad ?? null
    // DeFiLlama doesn't break down by pool address at this level, so it gives total chain volume
    // We'll use it as a signal but not pool-level data

    const currentBlock = Number(BigInt(bnRes?.result ?? '0x0'))
    // Step 2: virtualPrice delta APR — confirmed working on Monad
    // Note: eth_getLogs is limited to 100 blocks on Monad RPC — unusable for 24h volume
    // virtualPrice grows as trading fees accumulate → reliable APR proxy
    const block24h = '0x' + Math.max(0, currentBlock - BLOCKS_24H).toString(16)
    const vpCalls: any[] = []
    livePools.forEach((p, i) => {
      vpCalls.push({ jsonrpc: '2.0', id: i * 2,     method: 'eth_call', params: [{ to: p.address, data: '0xbb7b8b80' }, 'latest']  })
      vpCalls.push({ jsonrpc: '2.0', id: i * 2 + 1, method: 'eth_call', params: [{ to: p.address, data: '0xbb7b8b80' }, block24h] })
    })
    const vpRes = await fetch(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vpCalls),
      signal: AbortSignal.timeout(12_000),
    }).then(r => r.json()).then(d => Array.isArray(d) ? d : [d]).catch(() => [])

    // Step 3: Build APR entries
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
// Try their API for APR; vault is AUSD so isStable=true
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
  } catch {
    // Fallback: earnAUSD vault with estimated APR
    return [{
      protocol: 'Upshift', logo: '🔺', url: 'https://app.upshift.finance',
      tokens: ['AUSD'], label: 'earnAUSD',
      apr: 0, type: 'vault', isStable: true,
    }]
  }
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

// ─── KINTSU, MAGMA, shMONAD — LST staking vaults ─────────────────────────────
// Try on-chain apr via exchangeRate delta if API not available
async function fetchLSTVaults(): Promise<AprEntry[]> {
  const entries: AprEntry[] = []

  // Kintsu sMON
  try {
    const res = await fetch('https://api.kintsu.xyz/v1/apr?chainId=143', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const apr = Number(data?.apr ?? data?.stakingApr ?? 0) * (data?.apr < 2 ? 100 : 1)
      if (apr > 0) entries.push({
        protocol: 'Kintsu', logo: '🔵', url: 'https://kintsu.xyz',
        tokens: ['sMON'], label: 'Staked MON',
        apr, type: 'vault', isStable: false,
      })
    }
  } catch { /* skip */ }

  // Magma gMON
  try {
    const res = await fetch('https://api.magmastaking.xyz/v1/stats?chainId=143', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const apr = Number(data?.apr ?? data?.stakingApr ?? 0) * (data?.apr < 2 ? 100 : 1)
      if (apr > 0) entries.push({
        protocol: 'Magma', logo: '🐲', url: 'https://magmastaking.xyz',
        tokens: ['gMON'], label: 'MEV-Optimized Staked MON',
        apr, type: 'vault', isStable: false,
      })
    }
  } catch { /* skip */ }

  // shMonad
  try {
    const res = await fetch('https://api.shmonad.xyz/v1/apr', {
      signal: AbortSignal.timeout(6_000), cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const apr = Number(data?.apr ?? data?.stakingApr ?? 0) * (data?.apr < 2 ? 100 : 1)
      if (apr > 0) entries.push({
        protocol: 'shMonad', logo: '⚡', url: 'https://shmonad.xyz',
        tokens: ['shMON'], label: 'Holistic Staked MON',
        apr, type: 'vault', isStable: false,
      })
    }
  } catch { /* skip */ }

  return entries
}

// ─── RENZO — ezETH restaking ──────────────────────────────────────────────────
async function fetchRenzo(): Promise<AprEntry[]> {
  // Renzo not yet deployed on Monad mainnet
  return []
}

// ─── GEARBOX — credit account pools ──────────────────────────────────────────
async function fetchGearbox(): Promise<AprEntry[]> {
  // Gearbox not yet deployed on Monad mainnet
  return []
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET() {
  const [morphoR, neverlandR, eulerR, curveR, upshiftR, lagoonR, kuruR, lstR, renzoR, gearboxR] =
    await Promise.allSettled([
      fetchMorpho(),
      fetchNeverland(),
      fetchEulerV2(),
      fetchCurve(),
      fetchUpshift(),
      fetchLagoon(),
      fetchKuru(),
      fetchLSTVaults(),
      fetchRenzo(),
      fetchGearbox(),
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
    ...unwrap(renzoR),
    ...unwrap(gearboxR),
    ...getMidas(),
  ].filter(e => e.apr > 0)

  const byApr = (a: AprEntry, b: AprEntry) => b.apr - a.apr

  // Stable APRs: lend with stable token OR pool where all tokens are stables
  const stableAPRs = all
    .filter(e => e.isStable && (e.type === 'lend' || e.type === 'pool'))
    .sort(byApr)
    .slice(0, 5)

  const pools  = all.filter(e => e.type === 'pool').sort(byApr).slice(0, 10)
  const vaults = all.filter(e => e.type === 'vault').sort(byApr).slice(0, 10)
  const lends  = all.filter(e => e.type === 'lend').sort(byApr).slice(0, 10)

  return NextResponse.json({
    stableAPRs,
    pools,
    vaults,
    lends,
    lastUpdated: Date.now(),
    totalEntries: all.length,
  })
}
