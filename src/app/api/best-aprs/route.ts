import { NextRequest, NextResponse } from 'next/server'
// Fix #4: MONAD_RPC imported from shared lib — removes local duplicate declaration
// Fix #7: getMonPrice imported as getSharedMonPrice — removes local fetchMonPrice function
import { rpcBatch, MONAD_RPC, getMonPrice as getSharedMonPrice } from '@/lib/monad'
import { setAprCache } from '@/lib/aprCache'

export const revalidate = 0

// Fix #13: AprEntry moved to src/types/apr.ts — eliminates duplication with page.tsx
export type { AprEntry } from '@/types/apr'
import type { AprEntry } from '@/types/apr'

// ─── Stablecoin classification ────────────────────────────────────────────────
const STABLECOINS = new Set([
  'USDC', 'USDT', 'USDT0', 'AUSD', 'DAI', 'FRAX', 'BUSD',
  'USDC.e', 'mTBILL', 'crvUSD', 'TUSD', 'LUSD', 'MIM', 'USD1', 'LVUSD',
  'AUSDCT0', // Curve AUSD Compound Token on Monad
])

function isStable(sym: string): boolean { return STABLECOINS.has(sym) }
function allStable(tokens: string[]): boolean { return tokens.length > 0 && tokens.every(isStable) }

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Fix #4: MONAD_RPC no longer declared here — imported from @/lib/monad above

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
        state { supplyApy borrowApy supplyAssetsUsd }
      }
    }
    vaults(where:{chainId_in:[143]}, first:50) {
      items {
        address
        name
        symbol
        asset { symbol }
        state { netApy totalAssetsUsd }
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
      const supplyUsd = Number(m.state?.supplyAssetsUsd ?? 0)
      const loanSym   = m.loanAsset?.symbol ?? '?'
      const collSym   = m.collateralAsset?.symbol
      if (supplyApr < 0.01) continue
      if (supplyUsd < 500) continue
      if (supplyApr > 200) continue
      const tokens = collSym ? [collSym, loanSym] : [loanSym]
      const url = m.uniqueKey
        ? `https://app.morpho.org/monad/market?id=${m.uniqueKey}`
        : 'https://app.morpho.org/monad'
      out.push({
        protocol: 'Morpho', logo: '🦋', url,
        tokens, label: collSym ? `${collSym} / ${loanSym}` : loanSym,
        apr: supplyApr, tvl: supplyUsd, type: 'lend', isStable: allStable(tokens),
      })
    }
    for (const v of data?.data?.vaults?.items ?? []) {
      const netApy   = Number(v.state?.netApy ?? 0)
      const netApr   = apyToApr(netApy) * 100
      const totalUsd = Number(v.state?.totalAssetsUsd ?? 0)
      const sym      = v.asset?.symbol ?? '?'
      if (netApr < 0.01) continue
      if (totalUsd < 500) continue
      const url = v.address
        ? `https://app.morpho.org/monad/vault?address=${v.address}`
        : 'https://app.morpho.org/monad'
      out.push({
        protocol: 'Morpho', logo: '🦋', url,
        tokens: [sym], label: v.name ?? v.symbol ?? sym,
        apr: netApr, tvl: totalUsd, type: 'vault', isStable: isStable(sym),
      })
    }
    return out
  } catch { return [] }
}

// ─── NEVERLAND (Aave V3 fork) — supply & borrow rates ────────────────────────
const NEVERLAND_POOL = '0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585'
type NeverlandAsset = { address: string; symbol: string; decimals: number; priceType: 'stable' | 'mon' | 'skip' }
const NEVERLAND_ASSETS: NeverlandAsset[] = [
  { address: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', symbol: 'WMON',  decimals: 18, priceType: 'mon'    },
  { address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', symbol: 'WBTC',  decimals: 8,  priceType: 'skip'   },
  { address: '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242', symbol: 'WETH',  decimals: 18, priceType: 'skip'   },
  { address: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', symbol: 'AUSD',  decimals: 6,  priceType: 'stable' },
  { address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', symbol: 'USDC',  decimals: 6,  priceType: 'stable' },
  { address: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', symbol: 'USDT0', decimals: 6,  priceType: 'stable' },
  { address: '0xa3227c5969757783154c60bf0bc1944180ed81b9', symbol: 'sMON',  decimals: 18, priceType: 'mon'    },
  { address: '0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081', symbol: 'gMON',  decimals: 18, priceType: 'mon'    },
  { address: '0x1b68626dca36c7fe922fd2d55e4f631d962de19c', symbol: 'shMON', decimals: 18, priceType: 'mon'    },
]

async function fetchNeverland(monPrice: number): Promise<AprEntry[]> {
  try {
    const calls = NEVERLAND_ASSETS.map((a, i) =>
      ethCall(NEVERLAND_POOL, '0x35ea6a75' + a.address.slice(2).toLowerCase().padStart(64, '0'), i)
    )
    const results = await rpcBatch(calls)

    const aTokenCalls = results.map((r: any, i: number) => {
      const hex = (r?.result ?? '').slice(2)
      const slots: string[] = []
      for (let j = 0; j < hex.length; j += 64) slots.push(hex.slice(j, j + 64))
      const aToken = slots.length > 8
        ? '0x' + slots[8].slice(-40)
        : '0x0000000000000000000000000000000000000000'
      return ethCall(aToken, '0x18160ddd', i + 200) // totalSupply()
    })
    const tsResults = await rpcBatch(aTokenCalls)

    const out: AprEntry[] = []
    NEVERLAND_ASSETS.forEach((asset, i) => {
      const hex = results[i]?.result ?? ''
      const supplyApr = rayToApr(hex, 2)
      if (supplyApr < 0.01) return

      let tvl = 0
      if (asset.priceType !== 'skip') {
        const tsRaw = tsResults[i]?.result ?? '0x'
        const supply = tsRaw && tsRaw !== '0x'
          ? Number(BigInt(tsRaw)) / Math.pow(10, asset.decimals)
          : 0
        tvl = supply * (asset.priceType === 'stable' ? 1 : monPrice)
      }

      out.push({
        protocol: 'Neverland', logo: '🌙', url: 'https://app.neverland.money',
        tokens: [asset.symbol], label: asset.symbol,
        apr: supplyApr, tvl, type: 'lend', isStable: isStable(asset.symbol),
      })
    })
    return out
  } catch { return [] }
}

// ─── EULER V2 — vaults (supply APR) ──────────────────────────────────────────
async function fetchEulerV2(): Promise<AprEntry[]> {
  try {
    const res = await fetch(
      'https://indexer-prod.euler.finance/v2/vault/list?chainId=143&take=100',
      { signal: AbortSignal.timeout(10_000), cache: 'no-store' }
    )
    if (!res.ok) return []
    const data = await res.json()
    const vaults: any[] = data?.vaults ?? data?.items ?? data ?? []
    if (!Array.isArray(vaults)) return []

    const seen = new Map<string, { tvl: number; entry: AprEntry }>()

    for (const v of vaults) {
      const totalApy = Number(v.supplyApy?.totalApy ?? 0)
      const totalUsd = Number(v.totalAssetsUSD ?? v.totalAssetsUsd ?? 0)
      const sym      = v.assetSymbol ?? '?'
      const address  = v.vault ?? ''

      if (totalApy <= 0)  continue
      if (totalUsd < 100) continue

      const supApr = apyToApr(totalApy / 100) * 100

      const dedupeKey = `${sym}:${totalApy.toFixed(4)}`
      const existing  = seen.get(dedupeKey)
      const url       = address
        ? `https://app.euler.finance/vault/${address}?network=monad`
        : 'https://app.euler.finance/?network=monad'

      const entry: AprEntry = {
        protocol: 'Euler V2', logo: '📐', url,
        tokens: [sym], label: v.vaultName ?? sym,
        apr: supApr, tvl: totalUsd, type: 'lend', isStable: isStable(sym),
      }

      if (!existing || totalUsd > existing.tvl) {
        seen.set(dedupeKey, { tvl: totalUsd, entry })
      }
    }

    return Array.from(seen.values()).map(x => x.entry)
  } catch { return [] }
}

// ─── CURVE — pool APRs via Merkl (dados compartilhados via merklData) ────────
function parseCurve(merklData: any[]): AprEntry[] {
  const byAddress = new Map<string, any>()
  for (const item of merklData) {
    if ((item.mainProtocol ?? item.protocol) !== 'curve') continue
    if (item.action !== 'POOL') continue
    const addr = (item.identifier ?? '').toLowerCase()
    if (!addr) continue
    const existing = byAddress.get(addr)
    if (!existing || Number(item.apr ?? 0) > Number(existing.apr ?? 0)) {
      byAddress.set(addr, item)
    }
  }

  const entries: AprEntry[] = []
  for (const item of byAddress.values()) {
    const apr = Number(item.apr ?? 0)
    if (apr < 0.001) continue
    const tvl = Number(item.tvl ?? 0)
    if (tvl < 1_000) continue

    const url = item.depositUrl ?? `https://curve.finance/dex/monad/pools/${item.identifier}/deposit`

    const tokens: string[] = (item.tokens ?? [])
      .filter((t: any) => t.type === 'TOKEN' && !String(t.symbol ?? '').endsWith('-gauge'))
      .map((t: any) => String(t.symbol ?? ''))
      .filter(Boolean)
    if (tokens.length === 0) continue
    if (tokens.length === 1 && !url.includes('/deposit')) continue

    entries.push({
      protocol: 'Curve', logo: '🌊',
      url,
      tokens, label: tokens.join(' / '),
      apr: Math.min(apr, 500),
      tvl,
      type: 'pool' as const,
      isStable: allStable(tokens),
    })
  }
  return entries
}

// ─── UPSHIFT — vaults via api.upshift.finance/metrics/vaults_summary ─────────
const UPSHIFT_API_URL = 'https://api.upshift.finance/metrics/vaults_summary'
const UPSHIFT_IGNORE  = new Set(['0x792c7c5fb5c996e588b9f4a5fb201c79974e267c']) // superMON = Kintsu

function upshiftTokenFromName(name: string): string {
  if (/AUSD/i.test(name))       return 'AUSD'
  if (/USDC/i.test(name))       return 'USDC'
  if (/USDT/i.test(name))       return 'USDT'
  if (/BTC|wBTC/i.test(name))  return 'WBTC'
  if (/MON/i.test(name))        return 'MON'
  return '?'
}

async function fetchUpshiftRaw(): Promise<any[]> {
  try {
    const res = await fetch(UPSHIFT_API_URL, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

function parseUpshift(vaults: any[]): AprEntry[] {
  if (!Array.isArray(vaults) || vaults.length === 0) return []

  const out: AprEntry[] = []
  for (const v of vaults) {
    if (v.chain !== 143) continue
    if (UPSHIFT_IGNORE.has((v.address ?? '').toLowerCase())) continue

    const name: string = v.vault_name ?? ''
    if (/test|bugbash/i.test(name)) continue

    const tvl = Number(v.total_assets ?? 0) * Number(v.underlying_price ?? 0)
    if (tvl < 1_000) continue

    const apy7d  = v['7d_apy']  != null ? Number(v['7d_apy'])  : null
    const apy30d = v['30d_apy'] != null ? Number(v['30d_apy']) : null
    const target = v.target_apy != null ? Number(v.target_apy) : null

    const MIN_HIST = 0.005
    const bestHist = Math.max(apy7d ?? 0, apy30d ?? 0)
    const apyDecimal = (bestHist >= MIN_HIST) ? bestHist
      : (target != null && target > 0) ? target
      : null

    if (!apyDecimal || apyDecimal <= 0) continue

    const apr = Math.min(apyToApr(apyDecimal) * 100, 500)
    if (apr < 0.01) continue

    const token  = upshiftTokenFromName(name)
    const stable = STABLECOINS.has(token)

    out.push({
      protocol: 'Upshift',
      logo:     '🔺',
      url:      `https://app.upshift.finance/vaults/${v.address ?? ''}`,
      tokens:   [token],
      label:    name,
      apr,
      tvl,
      type:     'vault',
      isStable: stable,
    })
  }
  return out
}

// ─── LAGOON — vaults ──────────────────────────────────────────────────────────
async function fetchLagoon(): Promise<AprEntry[]> {
  try {
    const res = await fetch(
      'https://app.lagoon.finance/api/vaults?chainId=143&underlyingassetSymbol=0&curatorId=0&pageIndex=0&pageSize=50&includeApr=true',
      { signal: AbortSignal.timeout(8_000), cache: 'no-store' }
    )
    if (!res.ok) return []
    const data = await res.json()
    const vaults: any[] = data?.vaults ?? []
    if (!vaults.length) return []

    const entries: AprEntry[] = []
    for (const vault of vaults) {
      const s = vault.state ?? {}
      const apr =
        s.weeklyApr?.linearNetApr ??
        s.monthlyApr?.linearNetApr ??
        s.inceptionApr?.linearNetApr ?? null

      if (!apr || apr <= 0) continue

      const token    = vault.asset?.symbol ?? 'USDC'
      const curator  = vault.curators?.[0]?.name ?? 'Lagoon'

      entries.push({
        protocol: 'Lagoon',
        logo: '🏝️',
        url: `https://app.lagoon.finance/vault/${vault.address}`,
        tokens: [token],
        label: `${vault.name} (${curator})`,
        apr,
        tvl: Number(s.totalAssetsUsd ?? 0),
        type: 'vault',
        isStable: ['USDC', 'USDT', 'AUSD', 'DAI', 'USDT0'].includes(token),
      })
    }
    return entries
  } catch { return [] }
}

// ─── KINTSU — superMON vault ─────────────────────────────────────────────────
const KINTSU_VAULT_ADDRESS = '0x792C7c5fB5C996E588b9F4A5FB201C79974e267C'

function fetchKintsuVault(upshiftVaults: any[], kintsuTvl = 0): AprEntry[] {
  const vault = upshiftVaults.find(
    (v: any) => (v.address ?? '').toLowerCase() === KINTSU_VAULT_ADDRESS.toLowerCase()
  )
  if (!vault) return []

  const apy7d  = vault['7d_apy']  != null ? Number(vault['7d_apy'])  : null
  const apy30d = vault['30d_apy'] != null ? Number(vault['30d_apy']) : null
  const apyDecimal = (apy7d != null && apy7d > 0) ? apy7d
    : (apy30d != null && apy30d > 0) ? apy30d
    : null

  if (!apyDecimal || apyDecimal <= 0) return []

  const apr = Math.min(apyToApr(apyDecimal) * 100, 200)
  return [buildKintsuEntry(apr, kintsuTvl)]
}

function buildKintsuEntry(apr: number, tvl = 0): AprEntry {
  return {
    protocol: 'Kintsu',
    logo: '🔵',
    url: 'https://kintsu.xyz/vaults',
    tokens: ['WMON'],
    label: 'superMON Vault',
    apr,
    tvl,
    type: 'vault',
    isStable: false,
  }
}

// ─── GEARBOX V3 — lending pools ──────────────────────────────────────────────
const GEARBOX_STATIC_URL = 'https://state-cache.gearbox.foundation/Monad.json'
const GEARBOX_APY_URL    = 'https://state-cache.gearbox.foundation/apy-server/latest.json'

const GEARBOX_POOL_LIST = [
  { addr: '0x09cA6b76276eC0682adb896418b99CB7E44a58A0', token: 'WMON', isStable: false },
  { addr: '0x6B343F7B797f1488AA48C49d540690F2b2c89751', token: 'USDC', isStable: true  },
  { addr: '0xc4173359087CE643235420b7bC610d9B0CF2B82D', token: 'AUSD', isStable: true  },
  { addr: '0x164A35F31e4E0F6c45D500962a6978D2cbD5a16b', token: 'USDT', isStable: true  },
  { addr: '0x34752948B0dc28969485Df2066fFE86D5dc36689', token: 'WMON', isStable: false },
]

async function fetchGearboxExtraApy(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const res = await fetch(GEARBOX_APY_URL, { signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (!res.ok) return map
    const data = await res.json()
    const pools: any[] = data?.chains?.['143']?.pools?.data ?? []
    const now = Math.floor(Date.now() / 1000)

    for (const entry of pools) {
      const addr = (entry?.pool ?? '').toLowerCase()
      const extraAPY: any[] = entry?.rewards?.extraAPY ?? []
      const total = extraAPY
        .filter((e: any) => !e.endTimestamp || e.endTimestamp > now)
        .reduce((sum: number, e: any) => sum + (Number(e.apy) || 0), 0)
      if (total > 0) map.set(addr, total)
    }
  } catch { /* ignore */ }
  return map
}

async function fetchGearbox(): Promise<AprEntry[]> {
  try {
    const [poolsRes, extraApyMap] = await Promise.all([
      fetch(GEARBOX_STATIC_URL, { signal: AbortSignal.timeout(8_000), cache: 'no-store' }),
      fetchGearboxExtraApy(),
    ])
    if (!poolsRes.ok) return []
    const data = await poolsRes.json()
    const markets: any[] = data?.markets ?? []

    const out: AprEntry[] = []
    for (const m of markets) {
      const pool = m?.pool
      if (!pool || pool.isPaused) continue

      const addr: string = pool?.baseParams?.addr ?? ''
      const meta = GEARBOX_POOL_LIST.find(p => p.addr.toLowerCase() === addr.toLowerCase())
      if (!meta) continue

      const supplyRayStr: string = pool?.supplyRate?.__value ?? '0'
      const supplyRay = BigInt(supplyRayStr)
      if (supplyRay === 0n) continue

      const baseApr = Number(supplyRay) / 1e27 * 100
      if (baseApr < 0.01 || baseApr > 500) continue

      const extraApr = extraApyMap.get(addr.toLowerCase()) ?? 0
      const apr = baseApr + extraApr

      out.push({
        protocol: 'GearBox V3',
        logo: '⚙️',
        url: 'https://app.gearbox.fi/pools?chainId=143',
        tokens: [meta.token],
        label: pool.name ?? meta.token,
        apr,
        tvl: Number(pool.expectedLiquidity?.__value ?? 0) / Math.pow(10, pool.decimals ?? 18),
        type: 'lend',
        isStable: meta.isStable,
      })
    }
    return out
  } catch { return [] }
}

// ─── ON-CHAIN ERC4626 APR HELPER ─────────────────────────────────────────────
const BLOCKS_PER_DAY = 172_800
const CONVERT_TO_ASSETS = '0x07a2d13a' + '0000000000000000000000000000000000000000000000000de0b6b3a7640000'

async function getBlockNumber(): Promise<number> {
  const res = await fetch(MONAD_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(5_000),
  }).then(r => r.json())
  return parseInt(res?.result ?? '0x0', 16)
}

async function getPricePerShare(vault: string, block: string): Promise<bigint> {
  const res = await fetch(MONAD_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: vault, data: CONVERT_TO_ASSETS }, block] }),
    signal: AbortSignal.timeout(6_000),
  }).then(r => r.json())
  const hex = res?.result ?? '0x0'
  try { return hex && hex !== '0x' && hex !== '0x0' ? BigInt(hex) : 0n } catch { return 0n }
}

function ppsGrowthToApr(ppsNow: bigint, ppsPast: bigint, days: number): number {
  if (ppsPast === 0n || ppsNow <= ppsPast) return 0
  const growthPerDay = Number(ppsNow - ppsPast) / Number(ppsPast) / days
  const apr = growthPerDay * 365 * 100
  return apr > 0 && apr < 500 ? apr : 0
}

async function getVaultApr(vault: string, currentBlock: number): Promise<number> {
  const windows = [
    { days: 7, blocks: BLOCKS_PER_DAY * 7 },
    { days: 3, blocks: BLOCKS_PER_DAY * 3 },
    { days: 1, blocks: BLOCKS_PER_DAY * 1 },
  ]
  const pastBlocks = windows.map(w => '0x' + Math.max(1, currentBlock - w.blocks).toString(16))
  const [ppsNow, ...ppsPasts] = await Promise.all([
    getPricePerShare(vault, 'latest'),
    ...pastBlocks.map(b => getPricePerShare(vault, b)),
  ])
  if (ppsNow === 0n) return 0

  for (let i = 0; i < windows.length; i++) {
    const apr = ppsGrowthToApr(ppsNow, ppsPasts[i], windows[i].days)
    if (apr > 0) return apr
  }
  return 0
}

// ─── MAGMA — gMON APR via GraphQL ────────────────────────────────────────────
async function fetchMagmaOnchain(): Promise<{ apr: number; tvlInMON: number } | null> {
  try {
    const res = await fetch('https://magma-http-app.fly.dev/graphql', {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://magmastaking.xyz',
        'Referer': 'https://magmastaking.xyz/',
      },
      body: JSON.stringify({ query: '{ tvlMats { sum } }' }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw = data?.data?.tvlMats?.[0]?.sum
    if (!raw) return null

    const tvlInMON = Number(BigInt(raw)) / 1e18
    if (tvlInMON <= 0) return null

    const apy = 13 + (19_200_000 / tvlInMON * 100)
    const apr = Math.min(365 * (Math.pow(1 + apy / 100, 1 / 365) - 1) * 100, 500)
    return apr > 0 ? { apr, tvlInMON } : null
  } catch { return null }
}

// ─── DeFiLlama protocol TVLs ──────────────────────────────────────────────────
async function fetchDeFiLlamaTvls(): Promise<Map<string, number>> {
  const slugs = ['shmonad', 'kintsu', 'magma-staking', 'curvance'] as const
  const results = await Promise.allSettled(
    slugs.map(slug =>
      fetch(`https://api.llama.fi/tvl/${slug}`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' })
        .then(r => r.text())
    )
  )
  const map = new Map<string, number>()
  slugs.forEach((slug, i) => {
    const r = results[i]
    if (r.status === 'fulfilled') map.set(slug, Number(r.value) || 0)
  })
  return map
}

// ─── MERKL — busca unificada de todas as oportunidades Monad ─────────────────
async function fetchMerklAll(): Promise<any[]> {
  try {
    // Merkl limits to 100 items/page — fetch pages 1-3 in parallel
    const pages = await Promise.all([1, 2, 3].map(page =>
      fetch(
        `https://api.merkl.xyz/v4/opportunities?chainId=143&status=LIVE&items=100&page=${page}`,
        { signal: AbortSignal.timeout(12_000), cache: 'no-store', headers: { 'Accept': 'application/json' } }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
    ))
    return pages.flatMap(raw => {
      if (!raw) return []
      return Array.isArray(raw) ? raw : (raw?.data ?? raw?.opportunities ?? [])
    })
  } catch { return [] }
}

// ─── FLOPPY BACKUP — native APY for Monad LST/vault tokens ───────────────────
async function fetchFloppyNativeApy(): Promise<Map<string, number>> {
  try {
    const res = await fetch('https://api.floppy-backup.com/v1/monad/native_apy', {
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Origin': 'https://app.floppy.fi',
        'Referer': 'https://app.floppy.fi/',
      },
    })
    if (!res.ok) return new Map()
    const data = await res.json()
    const map = new Map<string, number>()
    for (const entry of (data.native_apy ?? [])) {
      const sym = String(entry.symbol ?? '').toUpperCase()
      const apy = Number(entry.apy ?? 0)
      if (sym && apy >= 0) map.set(sym, apy)
    }
    return map
  } catch { return new Map() }
}

// ─── KINTSU sMON — APR via Floppy native APY ─────────────────────────────────
async function fetchKintsusMON(nativeApyMap: Map<string, number>, kintsuTvl = 0): Promise<AprEntry | null> {
  const smonApy = nativeApyMap.get('SMON') ?? 0
  if (smonApy <= 0) return null
  const apr = Math.min(apyToApr(smonApy / 100) * 100, 100)
  if (apr < 0.01) return null
  return {
    protocol: 'Kintsu', logo: '🔵', url: 'https://kintsu.xyz',
    tokens: ['sMON'], label: 'Staked MON',
    apr, tvl: kintsuTvl, type: 'vault', isStable: false,
  }
}

// ─── shMONAD — on-chain ERC4626 pricePerShare delta ─────────────────────────
const SHMON_ADDRESS = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'

async function fetchShMonad(monPrice = 0): Promise<AprEntry | null> {
  try {
    const currentBlock = await getBlockNumber()
    const [apr, tsRes] = await Promise.all([
      getVaultApr(SHMON_ADDRESS, currentBlock),
      rpcBatch([ethCall(SHMON_ADDRESS, '0x18160ddd', 999)]),
    ])
    if (apr <= 0) return null
    const tsRaw = (tsRes as any[])[0]?.result ?? '0x'
    const supply = tsRaw && tsRaw !== '0x' ? Number(BigInt(tsRaw)) / 1e18 : 0
    const tvl = supply * monPrice
    return {
      protocol: 'shMonad', logo: '⚡', url: 'https://shmonad.xyz',
      tokens: ['shMON'], label: 'Holistic Staked MON',
      apr, tvl, type: 'vault', isStable: false,
    }
  } catch { return null }
}

// ─── KINTSU, MAGMA, shMONAD — LST staking vaults (parallel) ─────────────────
async function fetchLSTVaults(
  nativeApyMap: Map<string, number>,
  monPrice: number,
  llamaTvls: Map<string, number>
): Promise<AprEntry[]> {
  const kintsuTvl = llamaTvls.get('kintsu') ?? 0
  const [kintsuR, magmaR, shmonadR] = await Promise.allSettled([
    fetchKintsusMON(nativeApyMap, kintsuTvl),
    fetchMagmaOnchain(),
    fetchShMonad(monPrice),
  ])

  const entries: AprEntry[] = []

  const kEntry = kintsuR.status === 'fulfilled' ? kintsuR.value : null
  if (kEntry) entries.push(kEntry)

  const mData = magmaR.status === 'fulfilled' ? magmaR.value : null
  if (mData) {
    const apr = Number(mData?.apr ?? 0)
    const tvl = (mData?.tvlInMON ?? 0) * monPrice
    if (apr > 0) entries.push({
      protocol: 'Magma', logo: '🐲', url: 'https://magmastaking.xyz',
      tokens: ['gMON'], label: 'MEV-Optimized Staked MON',
      apr, tvl, type: 'vault', isStable: false,
    })
  }

  const sEntry = shmonadR.status === 'fulfilled' ? shmonadR.value : null
  if (sEntry) entries.push(sEntry)

  return entries
}

// ─── UNISWAP V3 + V4 ─────────────────────────────────────────────────────────
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
      apr, tvl, type: 'pool', isStable: allStable(tokens),
    })
  }
  return out
}

async function fetchUniswap(): Promise<AprEntry[]> {
  const GW = 'https://interface.gateway.uniswap.org/v1/graphql'
  const headers = { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' }

  const query = `{
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
  }`

  try {
    const res = await fetch(GW, {
      method: 'POST', headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json()
    const v3 = json?.data?.topV3Pools ?? []
    const v4 = json?.data?.topV4Pools ?? []
    return [
      ...parseUniPools(v3, 'V3'),
      ...parseUniPools(v4, 'V4'),
    ]
  } catch { return [] }
}

// ─── CURVANCE — lending markets via Merkl API + Floppy native APY ────────────
const CURVANCE_NATIVE_MARKETS: Array<{ symbol: string; label: string; isStable: boolean }> = [
  { symbol: 'sMON',   label: 'Curvance sMON/WMON',   isStable: false },
  { symbol: 'shMON',  label: 'Curvance shMON/WMON',  isStable: false },
  { symbol: 'gMON',   label: 'Curvance gMON/WMON',   isStable: false },
  { symbol: 'syzUSD', label: 'Curvance syzUSD/AUSD',  isStable: true  },
]

async function fetchCurvance(nativeApyMap: Map<string, number>, llamaTvls: Map<string, number>, merklData: any[]): Promise<AprEntry[]> {
  try {
    const data = merklData.filter((o: any) =>
      (o.mainProtocol ?? o.protocol) === 'curvance' && o.action === 'LEND'
    )
    const entries: AprEntry[] = []
    const merklSymbols = new Set<string>()

    for (const opp of data) {
      const apr = Number(opp.apr ?? 0)
      if (apr <= 0) continue

      const tokens: any[] = opp.tokens ?? []
      const underlying =
        tokens.find((t: any) => !/^c[A-Za-z]/.test(t.symbol ?? '')) ??
        tokens.find((t: any) => t.verified === true) ??
        tokens[0]
      const tokenSymbol = underlying?.symbol ?? 'TOKEN'
      merklSymbols.add(tokenSymbol)

      const isStableToken = STABLECOINS.has(tokenSymbol)
      const marketMatch = (opp.name as string)?.match(/Curvance (.+?) market/)
      const label = marketMatch ? `Curvance ${marketMatch[1]}` : (opp.name ?? `Curvance ${tokenSymbol}`)

      const nativeApy = nativeApyMap.get(tokenSymbol.toUpperCase()) ?? 0
      const nativeApr = nativeApy > 0 ? apyToApr(nativeApy / 100) * 100 : 0

      entries.push({
        protocol: 'Curvance',
        logo: '💎',
        url: opp.depositUrl ?? 'https://app.curvance.com',
        tokens: [tokenSymbol],
        label,
        apr: apr + nativeApr,
        tvl: Number(opp.tvl ?? 0),
        type: 'lend',
        isStable: isStableToken,
      })
    }

    const curvanceTvl = llamaTvls.get('curvance') ?? 0
    for (const market of CURVANCE_NATIVE_MARKETS) {
      if (merklSymbols.has(market.symbol)) continue
      const nativeApy = nativeApyMap.get(market.symbol.toUpperCase()) ?? 0
      if (nativeApy <= 0) continue
      const nativeApr = apyToApr(nativeApy / 100) * 100
      entries.push({
        protocol: 'Curvance',
        logo: '💎',
        url: 'https://app.curvance.com',
        tokens: [market.symbol],
        label: market.label,
        apr: nativeApr,
        tvl: curvanceTvl,
        type: 'lend',
        isStable: market.isStable,
      })
    }

    return entries
  } catch { return [] }
}

// ─── MIDAS — tokenized RWAs ───────────────────────────────────────────────────
async function fetchMidas(): Promise<AprEntry[]> {
  try {
    const res = await fetch('https://api-prod.midas.app/api/marketplace/products', {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://app.midas.app',
        'Referer': 'https://app.midas.app/',
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    const products: any[] = data?.products ?? []
    if (!Array.isArray(products) || products.length === 0) return []

    const out: AprEntry[] = []
    for (const p of products) {
      const tvlUsd = Number(p.tvl?.usd ?? 0)
      const apy7d  = Number(p.apy?.value7d  ?? 0)
      const apy30d = Number(p.apy?.value30d ?? 0)
      const apy    = apy7d > 0 ? apy7d : apy30d

      if (tvlUsd < 100_000) continue
      if (apy <= 0) continue
      const networks: string[] = Array.isArray(p.networks) ? p.networks : []
      if (!networks.includes('evm:monad')) continue

      const apr = Math.min(apyToApr(apy) * 100, 200)
      if (apr < 0.01) continue

      const symbol = String(p.symbol ?? '')
      const name   = String(p.name   ?? symbol)

      out.push({
        protocol: 'Midas',
        logo: '🏛️',
        url: 'https://app.midas.app',
        tokens: [symbol],
        label: name,
        apr,
        tvl: tvlUsd,
        type: 'vault',
        isStable: isStable(symbol),
      })
    }
    return out
  } catch { return [] }
}

// ─── KURU — vault APRs ───────────────────────────────────────────────────────
const KURU_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Origin': 'https://www.kuru.io',
  'Referer': 'https://www.kuru.io/',
}

async function fetchKuruVaultApr(vaultAddress: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.kuru.io/api/v3/vaults/${vaultAddress}/performance`,
      { signal: AbortSignal.timeout(8_000), cache: 'no-store', headers: KURU_HEADERS }
    )
    if (!res.ok) return 0
    const data = await res.json()
    const snaps: any[] = data?.data ?? []
    if (snaps.length < 2) return 0

    const first = snaps[0]
    const last  = snaps[snaps.length - 1]
    const msPerDay = 86_400_000
    const days = (new Date(last.snapshotTimestamp).getTime() - new Date(first.snapshotTimestamp).getTime()) / msPerDay
    if (days < 0.5) return 0

    const pnlLatest = parseFloat(String(last.totalPnl ?? '0'))
    const tvlAvg    = snaps.reduce((s, v) => s + parseFloat(String(v.tvl ?? '0')), 0) / snaps.length
    if (tvlAvg <= 0 || pnlLatest <= 0) return 0

    return Math.min(pnlLatest / tvlAvg / days * 365 * 100, 500)
  } catch { return 0 }
}

async function fetchKuru(): Promise<AprEntry[]> {
  try {
    const res = await fetch(
      'https://api.kuru.io/api/v3/vaults',
      { signal: AbortSignal.timeout(8_000), cache: 'no-store', headers: KURU_HEADERS }
    )
    if (!res.ok) return []
    const raw = await res.json()
    const vaults: any[] = raw?.data?.data ?? []
    if (!vaults.length) return []

    const aprs = await Promise.all(vaults.map(v => fetchKuruVaultApr(v.vaultAddress ?? '')))

    const entries: AprEntry[] = []
    for (let i = 0; i < vaults.length; i++) {
      const vault = vaults[i]
      const apr   = aprs[i]
      if (apr < 0.01) continue

      const tvl         = Number(vault.tvl ?? 0)
      const baseSymbol  = String(vault.baseToken?.ticker  ?? vault.baseToken?.name  ?? 'MON')
      const quoteSymbol = String(vault.quoteToken?.ticker ?? vault.quoteToken?.name ?? '')
      const tokens      = [baseSymbol, quoteSymbol].filter(Boolean)
      const pairLabel   = tokens.join(' / ')

      entries.push({
        protocol: 'Kuru',
        logo: '🌀',
        url: `https://www.kuru.io/vaults/${vault.vaultAddress ?? ''}`,
        tokens,
        label: `Kuru ${pairLabel}`,
        apr,
        tvl,
        type: 'vault',
        isStable: allStable(tokens),
      })
    }
    return entries
  } catch { return [] }
}

// ─── KURU — AMM pool APRs via /api/v2/vaults ─────────────────────────────────
async function fetchKuruPools(): Promise<AprEntry[]> {
  try {
    const res = await fetch(
      'https://api.kuru.io/api/v2/vaults',
      {
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Origin': 'https://www.kuru.io',
          'Referer': 'https://www.kuru.io/',
        },
      }
    )
    if (!res.ok) return []
    const raw = await res.json()
    const vaults: any[] = raw?.data?.data ?? []
    if (!vaults.length) return []

    const entries: AprEntry[] = []
    for (const vault of vaults) {
      const fees24h = parseFloat(String(vault.fees24h ?? '0'))
      const tvl24h  = parseFloat(String(vault.tvl24h  ?? '0'))
      if (!isFinite(fees24h) || !isFinite(tvl24h) || tvl24h <= 0 || fees24h <= 0) continue

      const apr = Math.min(365 * fees24h / tvl24h * 100, 500)
      if (apr < 0.01) continue

      const baseSymbol  = String(vault.basetoken?.ticker  ?? vault.basetoken?.name  ?? 'MON')
      const quoteSymbol = String(vault.quotetoken?.ticker ?? vault.quotetoken?.name ?? '')
      const tokens      = [baseSymbol, quoteSymbol].filter(Boolean)
      const pairLabel   = tokens.join(' / ')
      const vaultUrl    = `https://www.kuru.io/markets/${vault.marketaddress ?? ''}`

      entries.push({
        protocol: 'Kuru',
        logo: '🌀',
        url: vaultUrl,
        tokens,
        label: `Kuru ${pairLabel}`,
        apr,
        tvl: tvl24h,
        type: 'pool',
        isStable: allStable(tokens),
      })
    }
    return entries
  } catch { return [] }
}

// ─── PANCAKESWAP V3 — pools via explorer API + Merkl rewards ─────────────────
async function fetchPancakeswap(merklData: any[]): Promise<AprEntry[]> {
  const merklMap = new Map<string, number>()
  for (const o of merklData) {
    if (o.action !== 'POOL') continue
    const addr = (o.identifier ?? '').toLowerCase()
    const apr  = Number(o.apr ?? 0)
    if (addr && apr > 0) merklMap.set(addr, (merklMap.get(addr) ?? 0) + apr)
  }

  try {
    const poolsRes = await fetch(
      'https://explorer.pancakeswap.com/api/cached/pools/list?protocols=v3&chains=monad&orderBy=tvlUSD',
      { signal: AbortSignal.timeout(15_000), cache: 'no-store' },
    )
    if (!poolsRes.ok) return []
    const data = await poolsRes.json()
    const rows: any[] = data?.rows ?? data?.data?.rows ?? (Array.isArray(data) ? data : [])
    const out: AprEntry[] = []
    for (const p of rows) {
      const tvl    = Number(p.tvlUSD ?? 0)
      const feeApr = Number(p.apr24h ?? 0) * 100
      if (tvl < 100) continue
      const poolAddr  = (p.id ?? '').toLowerCase()
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
        apr, tvl, type: 'pool', isStable: allStable(tokens),
      })
    }
    return out
  } catch { return [] }
}

// ─── Fetch all data (used by cache) ──────────────────────────────────────────
async function fetchAllData() {
  // Fase 1 — dados compartilhados em paralelo (sem dependências entre si)
  const [nativeApyMap, monPrice, llamaTvls, merklData, upshiftVaults] = await Promise.all([
    fetchFloppyNativeApy(),
    getSharedMonPrice(), // Fix #7: was fetchMonPrice() — now uses shared cached getMonPrice from @/lib/monad
    fetchDeFiLlamaTvls(),
    fetchMerklAll(),
    fetchUpshiftRaw(),
  ])

  // Fase 2 — todos os fetchers em paralelo
  const [morphoR, neverlandR, eulerR, lagoonR, kuruR, kuruPoolsR, lstR, uniR, pancakeR, gearboxR, curvanceR, midasR] =
    await Promise.allSettled([
      fetchMorpho(),
      fetchNeverland(monPrice),
      fetchEulerV2(),
      fetchLagoon(),
      fetchKuru(),
      fetchKuruPools(),
      fetchLSTVaults(nativeApyMap, monPrice, llamaTvls),
      fetchUniswap(),
      fetchPancakeswap(merklData),
      fetchGearbox(),
      fetchCurvance(nativeApyMap, llamaTvls, merklData),
      fetchMidas(),
    ])

  function unwrap(r: PromiseSettledResult<AprEntry[]>): AprEntry[] {
    return r.status === 'fulfilled' ? r.value : []
  }

  const all: AprEntry[] = [
    ...unwrap(morphoR),
    ...unwrap(neverlandR),
    ...unwrap(eulerR),
    ...parseCurve(merklData),
    ...unwrap(lagoonR),
    ...unwrap(kuruR),
    ...unwrap(kuruPoolsR),
    ...unwrap(lstR),
    ...unwrap(uniR),
    ...unwrap(pancakeR),
    ...fetchKintsuVault(upshiftVaults, llamaTvls.get('kintsu') ?? 0),
    ...parseUpshift(upshiftVaults),
    ...unwrap(gearboxR),
    ...unwrap(curvanceR),
    ...unwrap(midasR),
  ].filter(e => e.apr > 0)

  const byApr = (a: AprEntry, b: AprEntry) => b.apr - a.apr

  const stableAPRs = all.filter(e => e.isStable).sort(byApr).slice(0, 5)
  const pools  = all.filter(e => e.type === 'pool').sort(byApr).slice(0, 10)
  const vaults = all.filter(e => e.type === 'vault').sort(byApr).slice(0, 10)
  const lends  = all.filter(e => e.type === 'lend').sort(byApr).slice(0, 10)

  // Populate shared aprCache so defi/route.ts can inject APRs without HTTP self-calls
  const aprEntries = all.map(e => ({ protocol: e.protocol, tokens: e.tokens, label: e.label, apr: e.apr }))
  setAprCache(aprEntries)

  return {
    stableAPRs,
    pools,
    vaults,
    lends,
    lastUpdated: Date.now(),
    totalEntries: all.length,
    // Internal field — used by /api/defi for APR injection via ?format=entries
    __entries: aprEntries,
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const now    = Date.now()
  const format = req.nextUrl.searchParams.get('format')

  if (serverCache && !serverCache.promise && now - serverCache.fetchedAt < CACHE_TTL) {
    if (format === 'entries') {
      // Return flat entries array for /api/defi APR injection
      return NextResponse.json(serverCache.data?.__entries ?? [])
    }
    return NextResponse.json(serverCache.data)
  }

  if (serverCache?.promise) {
    try {
      const data = await serverCache.promise
      if (format === 'entries') return NextResponse.json(data?.__entries ?? [])
      return NextResponse.json(data)
    } catch { /* fall through to retry */ }
  }

  // Fix #9 (MÉDIO): Global 25s timeout — prevents a slow external API (Merkl,
  // Upshift, etc.) from hanging a Cloudflare Worker slot indefinitely.
  // Individual fetchers already have AbortSignal timeouts, but Promise.allSettled
  // can still block longer than expected if several are near their limits.
  const fetchWithTimeout = () => Promise.race([
    fetchAllData(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('fetchAllData timeout')), 25_000)
    ),
  ])

  const promise = fetchWithTimeout()

  serverCache = {
    data:      serverCache?.data ?? null,
    fetchedAt: serverCache?.fetchedAt ?? 0,
    promise,
  }

  try {
    const data = await promise
    serverCache = { data, fetchedAt: Date.now(), promise: null }
    if (format === 'entries') return NextResponse.json(data?.__entries ?? [])
    return NextResponse.json(data)
  } catch {
    if (serverCache) serverCache.promise = null
    if (serverCache?.data) {
      if (format === 'entries') return NextResponse.json(serverCache.data?.__entries ?? [])
      return NextResponse.json(serverCache.data)
    }
    return NextResponse.json({ error: 'Failed to fetch APR data' }, { status: 500 })
  }
}
