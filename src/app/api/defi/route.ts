import { NextRequest, NextResponse } from 'next/server'
import { rpcBatch, getMonPrice } from '@/lib/monad'
import { getAprEntries } from '@/lib/aprCache'

export const revalidate = 0

// ─── RPC helpers ─────────────────────────────────────────────────────────────
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

// ─── Subrequest semaphores ───────────────────────────────────────────────────
// Cloudflare Workers: max 6 concurrent subrequests per request.
// httpSem(4) + rpcSem(2) = 6 total.
function makeSemaphore(max: number) {
  let active = 0
  const queue: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (active < max) { active++; return Promise.resolve() }
    return new Promise(resolve => queue.push(() => { active++; resolve() }))
  }
  const release = (): void => { active--; const next = queue.shift(); if (next) next() }
  return { acquire, release }
}
const rpcSem  = makeSemaphore(2)
const httpSem = makeSemaphore(4)

async function rpcBatchThrottled(calls: object[], timeoutMs = 15_000): Promise<any[]> {
  await rpcSem.acquire()
  try { return await rpcBatch(calls, timeoutMs) }
  finally { rpcSem.release() }
}
async function fetchThrottled(url: string, init?: RequestInit): Promise<Response> {
  await httpSem.acquire()
  try { return await fetch(url, init) }
  finally { httpSem.release() }
}

// ─── ZERION — primary DeFi source for Monad ──────────────────────────────────
// Covers: Curvance, Curve, Kuru, Lagoon, Morpho, Neverland + any new protocols
// automatically indexed. Single API call → replaces 6+ on-chain fetchers.
//
// Schema mapping:
//   position_type "deposit" → supply (lending) or vault/liquidity amount
//   position_type "loan"    → borrow
//   position_type "staked"  → vault (staking)
//   position_type "reward"  → skip (accrued but unclaimed)
//   group_id groups related rows (deposit+loan in same market, or multi-token LP)

const ZERION_API  = 'https://api.zerion.io/v1/wallets'
const ZERION_AUTH = () => {
  const key = process.env.ZERION_API_KEY ?? ''
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

// Protocol display config — logo + type override
const ZERION_PROTO_CONFIG: Record<string, { logo: string; type: string }> = {
  'Curvance':      { logo: '💎', type: 'lending'   },
  'Curve':         { logo: '🌊', type: 'liquidity'  },
  'Euler Yield':   { logo: '📐', type: 'vault'      },
  'Kuru':          { logo: '🌀', type: 'liquidity'  },
  'LAGOON':        { logo: '🏝️', type: 'vault'      },
  'MIDAS':         { logo: '🏦', type: 'vault'      },
  'Morpho':        { logo: '🦋', type: 'vault'      },
  'Neverland':     { logo: '🧚', type: 'lending'    },
  'Monad Staking': { logo: '🟣', type: 'vault'      },
  'Kintsu':        { logo: '🔵', type: 'vault'      },
}

function zerionProtoUrl(proto: string, appUrl: string): string {
  const defaults: Record<string, string> = {
    'Curvance':      'https://monad.curvance.com',
    'Curve':         'https://curve.finance/dex/monad',
    'Euler Yield':   'https://app.euler.finance/?network=monad',
    'Kuru':          'https://www.kuru.io/vaults',
    'LAGOON':        'https://app.lagoon.finance',
    'MIDAS':         'https://app.midas.app',
    'Morpho':        'https://app.morpho.org/monad',
    'Neverland':     'https://app.neverland.money',
    'Monad Staking': 'https://monad.xyz',
    'Kintsu':        'https://kintsu.xyz',
  }
  return appUrl || defaults[proto] || 'https://monad.xyz'
}

async function fetchZerion(user: string): Promise<any[]> {
  const MAX_RETRIES = 3
  const RETRY_DELAY = 1_000  // 1 second between retries

  let res: Response | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      res = await fetchThrottled(
        `${ZERION_API}/${user}/positions/?filter[positions]=only_complex&filter[chain_ids]=monad&sort=value`,
        {
          headers: { 'Accept': 'application/json', 'Authorization': ZERION_AUTH() },
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
        }
      )
      // 429 = rate limit → retry; any other non-ok → fail immediately
      if (res.status === 429) {
        console.warn(`[defi][Zerion] rate limited (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms`)
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY))
        continue
      }
      if (!res.ok) { console.error('[defi][Zerion] HTTP', res.status); return [] }
      break  // success
    } catch (err: any) {
      console.warn(`[defi][Zerion] attempt ${attempt}/${MAX_RETRIES} failed: ${err?.message}`)
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY))
      else return []
    }
  }
  if (!res || !res.ok) { console.error('[defi][Zerion] all retries exhausted'); return [] }
  try {
    const data = await res.json()
    const raw: any[] = data?.data ?? []
    if (!raw.length) return []

    // Group positions by group_id so we can assemble lending positions
    const groups = new Map<string, any[]>()
    for (const p of raw) {
      const attrs    = p.attributes ?? {}
      const ptype    = attrs.position_type
      // Skip reward positions (unclaimed yield) and near-zero positions
      if (ptype === 'reward') continue
      const value = Number(attrs.value ?? 0)
      if (value < 0.005 && ptype !== 'loan') continue  // keep loans even if tiny
      const gid = attrs.group_id ?? p.id
      if (!groups.has(gid)) groups.set(gid, [])
      groups.get(gid)!.push(attrs)
    }

    const positions: any[] = []

    for (const [, items] of groups) {
      if (!items.length) continue
      const first   = items[0]
      const proto   = first.protocol ?? '?'
      const cfg     = ZERION_PROTO_CONFIG[proto] ?? { logo: '🔷', type: 'vault' }
      const appMeta = first.application_metadata ?? {}
      const url     = zerionProtoUrl(proto, appMeta.url ?? '')
      const name    = first.name ?? proto

      const deposits = items.filter(i => i.position_type === 'deposit' || i.position_type === 'staked')
      const loans    = items.filter(i => i.position_type === 'loan')

      const totalDepositUSD = deposits.reduce((s, i) => s + Number(i.value ?? 0), 0)
      const totalLoanUSD    = loans.reduce((s, i) => s + Number(i.value ?? 0), 0)

      if (totalDepositUSD < 0.01 && totalLoanUSD < 0.01) continue

      if (cfg.type === 'lending' || loans.length > 0) {
        // Lending position: supply + borrow + health factor
        const supply = deposits.map(i => ({
          symbol:    i.fungible_info?.symbol ?? '?',
          amount:    Number(i.quantity?.float ?? 0),
          amountUSD: Number(i.value ?? 0),
        }))
        const borrow = loans.map(i => ({
          symbol:    i.fungible_info?.symbol ?? '?',
          amount:    Number(i.quantity?.float ?? 0),
          amountUSD: Number(i.value ?? 0),
        }))
        const netValueUSD  = totalDepositUSD - totalLoanUSD
        const healthFactor = totalLoanUSD > 0 && totalDepositUSD > 0
          ? totalDepositUSD / totalLoanUSD
          : null
        positions.push({
          protocol: proto, type: 'lending', logo: cfg.logo, url, chain: 'Monad', label: name,
          supply, collateral: [], borrow,
          totalCollateralUSD: totalDepositUSD, totalDebtUSD: totalLoanUSD,
          netValueUSD, healthFactor, apy: 0,
        })
      } else if (cfg.type === 'liquidity' && deposits.length > 1) {
        // LP position: multiple tokens in same pool
        const tokens  = deposits.map(i => i.fungible_info?.symbol ?? '?')
        const amounts: Record<string, number> = {}
        for (const i of deposits) {
          const sym = i.fungible_info?.symbol ?? '?'
          amounts[sym] = (amounts[sym] ?? 0) + Number(i.quantity?.float ?? 0)
        }
        positions.push({
          protocol: proto, type: 'liquidity', logo: cfg.logo, url, chain: 'Monad', label: name,
          tokens, amounts, amountUSD: totalDepositUSD, apy: 0, netValueUSD: totalDepositUSD, inRange: null,
        })
      } else {
        // Simple vault / single-token deposit
        const item   = deposits[0] ?? items[0]
        const sym    = item.fungible_info?.symbol ?? '?'
        const amount = Number(item.quantity?.float ?? 0)
        positions.push({
          protocol: proto, type: cfg.type, logo: cfg.logo, url, chain: 'Monad', label: name,
          asset: sym, tokens: [sym], amount, amountUSD: totalDepositUSD, apy: 0, netValueUSD: totalDepositUSD,
        })
      }
    }
    return positions
  } catch (e: any) { console.error('[defi][Zerion] parse error', e?.message ?? e); return [] }
}

// ─── MON LSTs: Magma + shMonad (not indexed by Zerion) ───────────────────────
const MON_LSTS = [
  { addr: '0xA3227C5969757783154C60bF0bC1944180ed81B9', protocol: 'Kintsu',  logo: '🔵', url: 'https://kintsu.xyz',      label: 'Staked MON',              asset: 'sMON',  redeemSel: '0x4cdad506' },
  { addr: '0x8498312a6b3CBD158Bf0c93ABdcF29E6e4f55081', protocol: 'Magma',   logo: '🐲', url: 'https://magmastaking.xyz', label: 'MEV-Optimized Staked MON', asset: 'gMON',  redeemSel: '0x07a2d13a' },
  { addr: '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c', protocol: 'shMonad', logo: '⚡', url: 'https://shmonad.xyz',     label: 'Holistic Staked MON',      asset: 'shMON', redeemSel: '0x4cdad506' },
]

async function fetchMonLSTs(user: string, monPrice: number): Promise<any[]> {
  try {
    const balResults = await rpcBatchThrottled(MON_LSTS.map((lst, i) => ethCall(lst.addr, balanceOfData(user), i)))
    const withBalance = MON_LSTS.map((lst, i) => ({
      ...lst, shares: decodeUint(balResults.find((r: any) => Number(r.id) === i)?.result ?? '0x'),
    })).filter(lst => lst.shares > 0n && Number(lst.shares) / 1e18 >= 0.001)
    if (!withBalance.length) return []
    const redeemResults = await rpcBatchThrottled(withBalance.map((lst, i) =>
      ethCall(lst.addr, lst.redeemSel + lst.shares.toString(16).padStart(64, '0'), i + 10)
    ))
    return withBalance.map((lst, i) => {
      const sharesFloat = Number(lst.shares) / 1e18
      const monAmt      = Number(decodeUint(redeemResults.find((r: any) => Number(r.id) === i + 10)?.result ?? '0x')) / 1e18 || sharesFloat
      const amountUSD   = monAmt * monPrice
      return {
        protocol: lst.protocol, type: 'vault', logo: lst.logo, url: lst.url, chain: 'Monad',
        label: lst.label, asset: lst.asset, amount: sharesFloat, amountUSD, apy: 0, netValueUSD: amountUSD,
      }
    })
  } catch (e: any) { console.error('[defi][MonLSTs]', e?.message ?? e); return [] }
}

// ─── GEARBOX ──────────────────────────────────────────────────────────────────
const GEARBOX_STATIC_URL = 'https://state-cache.gearbox.foundation/Monad.json'
const GEARBOX_TOKEN_MAP: Record<string, { token: string; isStable: boolean }> = {
  '0x34752948b0dc28969485df2066ffe86d5dc36689': { token: 'WMON', isStable: false },
  '0x09ca6b76276ec0682adb896418b99cb7e44a58a0': { token: 'WMON', isStable: false },
  '0x6b343f7b797f1488aa48c49d540690f2b2c89751': { token: 'USDC', isStable: true  },
  '0xc4173359087ce643235420b7bc610d9b0cf2b82d': { token: 'AUSD', isStable: true  },
  '0x164a35f31e4e0f6c45d500962a6978d2cbd5a16b': { token: 'USDT', isStable: true  },
}

async function fetchGearbox(user: string, monPrice: number): Promise<any[]> {
  try {
    const res = await fetchThrottled(GEARBOX_STATIC_URL, { signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    const pools = (data?.markets ?? [])
      .map((m: any) => m?.pool)
      .filter((p: any) => p && !!GEARBOX_TOKEN_MAP[(p?.baseParams?.addr ?? '').toLowerCase()])
    if (!pools.length) return []
    const calls   = pools.map((p: any, i: number) => ethCall(p.baseParams.addr, balanceOfData(user), i + 200))
    const results = await rpcBatchThrottled(calls)
    const positions: any[] = []
    for (let i = 0; i < pools.length; i++) {
      const pool  = pools[i]
      const addr  = (pool?.baseParams?.addr ?? '').toLowerCase()
      const meta  = GEARBOX_TOKEN_MAP[addr]
      if (!meta) continue
      const shares = decodeUint(results.find((r: any) => Number(r.id) === i + 200)?.result ?? '0x')
      if (shares === 0n) continue
      const decimals    = Number(pool.decimals ?? 18)
      const sharesFloat = Number(shares) / Math.pow(10, decimals)
      const expectedLiq = BigInt(pool.expectedLiquidity?.__value ?? '0')
      const totalSupply = BigInt(pool.totalSupply?.__value ?? pool.totalSupply ?? '0')
      if (totalSupply === 0n) continue
      const exchangeRate = Number(expectedLiq) / Number(totalSupply)
      const amountUSD    = meta.isStable ? sharesFloat * exchangeRate : sharesFloat * exchangeRate * monPrice
      if (amountUSD < 0.01) continue
      positions.push({
        protocol: 'GearBox V3', type: 'vault', logo: '⚙️',
        url: 'https://app.gearbox.fi/pools?chainId=143', chain: 'Monad',
        label: pool.name ?? meta.token, asset: meta.token,
        amount: sharesFloat, amountUSD, apy: 0, netValueUSD: amountUSD,
      })
    }
    return positions
  } catch (e: any) { console.error('[defi][Gearbox]', e?.message ?? e); return [] }
}

// ─── UPSHIFT ──────────────────────────────────────────────────────────────────
const UPSHIFT_API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}
const UPSHIFT_IGNORE       = new Set(['0x792c7c5fb5c996e588b9f4a5fb201c79974e267c'])
const UPSHIFT_SHARE_TOKEN_SEL = '0xf5ae497a'

function upshiftTokenFromName(name: string): string {
  if (/AUSD/i.test(name))      return 'AUSD'
  if (/USDC/i.test(name))      return 'USDC'
  if (/USDT/i.test(name))      return 'USDT'
  if (/BTC|wBTC/i.test(name)) return 'WBTC'
  if (/MON/i.test(name))       return 'MON'
  return '?'
}

function decodeAddress(hex: string): string {
  if (!hex || hex === '0x') return '0x0000000000000000000000000000000000000000'
  return '0x' + hex.slice(2).slice(-40)
}

async function fetchUpshift(user: string): Promise<any[]> {
  try {
    const res = await fetchThrottled('https://api.upshift.finance/metrics/vaults_summary', {
      headers: UPSHIFT_API_HEADERS, signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const raw: any[] = await res.json()
    const vaults = (Array.isArray(raw) ? raw : []).filter((v: any) => {
      if (v.chain !== 143) return false
      if (/test|bugbash/i.test(v.vault_name ?? '')) return false
      if (UPSHIFT_IGNORE.has((v.address ?? '').toLowerCase())) return false
      return Number(v.total_assets ?? 0) * Number(v.underlying_price ?? 0) >= 1
    })
    if (!vaults.length) return []
    const shareTokenResults = await rpcBatchThrottled(vaults.map((v: any, i: number) => ethCall(v.address, UPSHIFT_SHARE_TOKEN_SEL, i)))
    const shareTokenAddrs = vaults.map((v: any, i: number) => {
      const addr = decodeAddress(shareTokenResults.find((x: any) => Number(x.id) === i)?.result ?? '')
      return (addr && addr !== '0x0000000000000000000000000000000000000000') ? addr : v.address.toLowerCase()
    })
    const results = await rpcBatchThrottled(shareTokenAddrs.map((addr: string, i: number) => ethCall(addr, balanceOfData(user), i + 700)))
    const positions: any[] = []
    for (let i = 0; i < vaults.length; i++) {
      const v      = vaults[i]
      const shares = decodeUint(results.find((r: any) => Number(r.id) === i + 700)?.result ?? '0x')
      if (shares === 0n) continue
      const sharesFloat = Number(shares) / 1e18
      const amountUSD   = sharesFloat * Number(v.asset_share_ratio ?? 1) * Number(v.underlying_price ?? 0)
      if (amountUSD < 0.01) continue
      positions.push({
        protocol: 'Upshift', type: 'vault', logo: '🔺',
        url: `https://app.upshift.finance/vaults/${v.address}`, chain: 'Monad',
        label: v.vault_name ?? '', asset: upshiftTokenFromName(v.vault_name ?? ''),
        amount: sharesFloat, amountUSD, apy: 0, netValueUSD: amountUSD,
      })
    }
    return positions
  } catch (e: any) { console.error('[defi][Upshift]', e?.message ?? e); return [] }
}

// ─── UNISWAP V3 / PANCAKESWAP V3 ─────────────────────────────────────────────
const UNI_NFT_PM  = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'
const UNI_FACTORY = '0x204faca1764b154221e35c0d20abb3c525710498'

interface TokenInfo { symbol: string; decimals: number }
const TOKEN_CACHE: Record<string, TokenInfo> = {
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a': { symbol: 'WMON',  decimals: 18 },
  '0x0555e30da8f98308edb960aa94c0db47230d2b9c': { symbol: 'WBTC',  decimals: 8  },
  '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242': { symbol: 'WETH',  decimals: 18 },
  '0x00000000efe302beaa2b3e6e1b18d08d69a9012a': { symbol: 'AUSD',  decimals: 18 },
  '0x754704bc059f8c67012fed69bc8a327a5aafb603': { symbol: 'USDC',  decimals: 6  },
  '0xe7cd86e13ac4309349f30b3435a9d337750fc82d': { symbol: 'USDT0', decimals: 6  },
  '0xa3227c5969757783154c60bf0bc1944180ed81b9': { symbol: 'sMON',  decimals: 18 },
  '0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081': { symbol: 'gMON',  decimals: 18 },
  '0x1b68626dca36c7fe922fd2d55e4f631d962de19c': { symbol: 'shMON', decimals: 18 },
}

function decodeAbiString(hex: string): string {
  try {
    const d = hex.startsWith('0x') ? hex.slice(2) : hex
    if (d.length < 128) return ''
    const len = parseInt(d.slice(64, 128), 16)
    if (len === 0 || len > 100) return ''
    // Fix #5 (ALTO): Strip all ASCII control characters (not just null bytes).
    // Prevents token symbols with embedded control chars from polluting UI or logs.
    return Buffer.from(d.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/[\x00-\x1f\x7f]/g, '').trim()
  } catch { return '' }
}

async function resolveTokens(addresses: string[]): Promise<Record<string, TokenInfo>> {
  const unique  = [...new Set(addresses.map(a => a.toLowerCase()))]
  const unknown = unique.filter(a => !TOKEN_CACHE[a])
  if (unknown.length > 0) {
    const calls: object[] = []
    unknown.forEach((addr, i) => {
      calls.push(ethCall(addr, '0x95d89b41', i * 2))
      calls.push(ethCall(addr, '0x313ce567', i * 2 + 1))
    })
    const results = await rpcBatch(calls).catch(() => [] as any[])
    unknown.forEach((addr, i) => {
      const symRaw   = results.find((r: any) => r.id === i * 2)?.result     ?? ''
      const decRaw   = results.find((r: any) => r.id === i * 2 + 1)?.result ?? ''
      const symbol   = decodeAbiString(symRaw) || addr.slice(2, 8).toUpperCase()
      const decimals = decRaw && decRaw !== '0x' ? Number(BigInt(decRaw)) : 18
      TOKEN_CACHE[addr] = { symbol, decimals }
    })
  }
  const out: Record<string, TokenInfo> = {}
  for (const addr of addresses) out[addr.toLowerCase()] = TOKEN_CACHE[addr.toLowerCase()] ?? { symbol: addr.slice(2, 8).toUpperCase(), decimals: 18 }
  return out
}

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  WMON: 'monad', MON: 'monad', sMON: 'monad', gMON: 'monad', shMON: 'monad', aprMON: 'monad',
  WETH: 'ethereum', WBTC: 'wrapped-bitcoin', USDC: 'usd-coin', USDT0: 'tether', AUSD: 'agora-dollar',
}

async function getTokenPricesUSD(symbols: string[]): Promise<Record<string, number>> {
  const stables: Record<string, number> = { USDC: 1, USDT0: 1, AUSD: 1 }
  const needed = symbols.filter(s => !stables[s])
  if (!needed.length) return stables
  try {
    const { getAllPrices } = await import('@/lib/priceCache')
    const { prices } = await getAllPrices()
    const out: Record<string, number> = { ...stables }
    for (const sym of needed) { const id = SYMBOL_TO_COINGECKO[sym]; if (id && prices[id]) out[sym] = prices[id] }
    return out
  } catch { return stables }
}

function tokenOfOwnerByIndex(owner: string, idx: bigint): string {
  return '0x2f745c59' + owner.slice(2).toLowerCase().padStart(64, '0') + idx.toString(16).padStart(64, '0')
}
function positionsData(tokenId: bigint): string {
  return '0x99fbab88' + tokenId.toString(16).padStart(64, '0')
}
function getPoolData(t0: string, t1: string, fee: number): string {
  return '0x1698ee82' + t0.slice(2).toLowerCase().padStart(64, '0') + t1.slice(2).toLowerCase().padStart(64, '0') + fee.toString(16).padStart(64, '0')
}
function calcV3Amounts(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number, currentTick: number, decimals0: number, decimals1: number): { amount0: number; amount1: number } {
  const L = Number(liquidity), sqrtP = Number(sqrtPriceX96) / (2 ** 96)
  const sqrtA = Math.sqrt(Math.pow(1.0001, tickLower)), sqrtB = Math.sqrt(Math.pow(1.0001, tickUpper))
  let amount0 = 0, amount1 = 0
  if (currentTick < tickLower)       { amount0 = L * (1 / sqrtA - 1 / sqrtB) }
  else if (currentTick >= tickUpper) { amount1 = L * (sqrtB - sqrtA) }
  else                               { amount0 = L * (1 / sqrtP - 1 / sqrtB); amount1 = L * (sqrtP - sqrtA) }
  return { amount0: amount0 / Math.pow(10, decimals0), amount1: amount1 / Math.pow(10, decimals1) }
}

async function fetchUniswapV3(user: string, protocol: string, nftPM: string, factory: string): Promise<any[]> {
  try {
    const balRes   = await rpcBatchThrottled([ethCall(nftPM, balanceOfData(user), 1)])
    const nftCount = Number(decodeUint(balRes[0]?.result ?? '0x'))
    if (nftCount === 0) return []
    const limit     = Math.min(nftCount, 20)
    const idResults = await rpcBatchThrottled(Array.from({ length: limit }, (_, i) => ethCall(nftPM, tokenOfOwnerByIndex(user, BigInt(i)), i + 10)))
    const tokenIds  = idResults.map((r: any) => decodeUint(r?.result ?? '0x')).filter((id: bigint) => id > 0n)
    if (!tokenIds.length) return []
    const posResults = await rpcBatchThrottled(tokenIds.map((id: bigint, i: number) => ethCall(nftPM, positionsData(id), i + 200)))
    const tokenAddresses = new Set<string>()
    const parsedPositions: Array<{ token0: string; token1: string; fee: number; tickLower: number; tickUpper: number; liquidity: bigint }> = []
    for (let i = 0; i < tokenIds.length; i++) {
      const hex = posResults[i]?.result
      if (!hex || hex === '0x' || hex.length < 10) continue
      const d = hex.slice(2)
      if (d.length < 64 * 8) continue
      const w = Array.from({ length: 12 }, (_, j) => d.slice(j * 64, (j + 1) * 64))
      const token0 = '0x' + w[2].slice(24), token1 = '0x' + w[3].slice(24)
      const fee = parseInt(w[4], 16)
      const tL = parseInt(w[5], 16), tU = parseInt(w[6], 16)
      const tickLower = tL > 0x7fffffff ? tL - 0x100000000 : tL
      const tickUpper = tU > 0x7fffffff ? tU - 0x100000000 : tU
      const liquidity = BigInt('0x' + w[7])
      if (liquidity === 0n) continue
      tokenAddresses.add(token0.toLowerCase()); tokenAddresses.add(token1.toLowerCase())
      parsedPositions.push({ token0, token1, fee, tickLower, tickUpper, liquidity })
    }
    if (!parsedPositions.length) return []
    const tokenInfoMap = await resolveTokens([...tokenAddresses]).catch(() => ({} as Record<string, TokenInfo>))
    const poolCalls: object[] = []
    const poolMeta: Record<number, any> = {}
    let pcIdx = 500
    for (const pos of parsedPositions) {
      const t0 = tokenInfoMap[pos.token0.toLowerCase()] ?? { symbol: pos.token0.slice(2, 8).toUpperCase(), decimals: 18 }
      const t1 = tokenInfoMap[pos.token1.toLowerCase()] ?? { symbol: pos.token1.slice(2, 8).toUpperCase(), decimals: 18 }
      poolCalls.push(ethCall(factory, getPoolData(pos.token0, pos.token1, pos.fee), pcIdx))
      poolMeta[pcIdx] = { ...pos, t0sym: t0.symbol, t1sym: t1.symbol, t0dec: t0.decimals, t1dec: t1.decimals }
      pcIdx++
    }
    const poolAddrResults = await rpcBatchThrottled(poolCalls)
    const slot0Calls: object[] = []
    const slot0Meta: Record<number, any> = {}
    let s0Idx = 600
    for (const res of poolAddrResults) {
      const meta = poolMeta[Number(res.id)]
      if (!meta || !res.result || res.result === '0x') continue
      const poolAddr = '0x' + res.result.slice(2).slice(-40)
      if (poolAddr === '0x0000000000000000000000000000000000000000') continue
      slot0Calls.push(ethCall(poolAddr, '0x3850c7bd', s0Idx))
      slot0Meta[s0Idx] = meta; s0Idx++
    }
    if (!slot0Calls.length) return []
    const slot0Results = await rpcBatchThrottled(slot0Calls)
    const allSymbols = [...new Set(Object.values(slot0Meta).flatMap((m: any) => [m.t0sym, m.t1sym]))]
    const prices     = await getTokenPricesUSD(allSymbols)
    const positions: any[] = []
    for (const s0 of slot0Results) {
      const meta = slot0Meta[Number(s0.id)]
      if (!meta || !s0.result || s0.result === '0x' || s0.result.length < 10) continue
      const d = s0.result.slice(2)
      const w = Array.from({ length: 4 }, (_, j) => d.slice(j * 64, (j + 1) * 64))
      const ct = parseInt(w[1], 16)
      const currentTick  = ct > 0x7fffffff ? ct - 0x100000000 : ct
      const sqrtPriceX96 = BigInt('0x' + w[0])
      const inRange      = currentTick >= meta.tickLower && currentTick <= meta.tickUpper
      const { amount0, amount1 } = calcV3Amounts(meta.liquidity, sqrtPriceX96, meta.tickLower, meta.tickUpper, currentTick, meta.t0dec, meta.t1dec)
      const amountUSD = amount0 * (prices[meta.t0sym] ?? 0) + amount1 * (prices[meta.t1sym] ?? 0)
      positions.push({
        protocol, type: 'liquidity',
        logo:    protocol === 'PancakeSwap V3' ? '🥞' : '🦄',
        url:     protocol === 'PancakeSwap V3' ? 'https://pancakeswap.finance' : 'https://app.uniswap.org',
        chain:   'Monad',
        label:   `${meta.t0sym}/${meta.t1sym} ${meta.fee / 10000}%`,
        tokens:  [meta.t0sym, meta.t1sym],
        amounts: { [meta.t0sym]: amount0, [meta.t1sym]: amount1 },
        inRange, tickLower: meta.tickLower, tickUpper: meta.tickUpper, currentTick,
        amountUSD, netValueUSD: amountUSD,
      })
    }
    return positions
  } catch (e: any) { console.error('[defi][UniswapV3]', e?.message ?? e); return [] }
}

// ─── APR INJECTION ────────────────────────────────────────────────────────────
type AprLookup = Map<string, number>

function entriesToLookup(entries: Array<{ protocol: string; tokens: string[]; label: string; apr: number }>): AprLookup {
  const map = new Map<string, number>()
  for (const e of entries) {
    const proto = String(e.protocol ?? ''), apr = Number(e.apr ?? 0)
    if (!proto || apr <= 0) continue
    if (Array.isArray(e.tokens) && e.tokens.length > 0) {
      const k = proto + ':' + e.tokens.slice().sort().join('+')
      if ((map.get(k) ?? 0) < apr) map.set(k, apr)
    }
    const labelKey = proto + ':' + String(e.label ?? '').toLowerCase().trim()
    if (labelKey.length > proto.length + 1 && (map.get(labelKey) ?? 0) < apr) map.set(labelKey, apr)
    if ((map.get(proto) ?? 0) < apr) map.set(proto, apr)
  }
  return map
}

const MERKL_BASE      = 'https://api.merkl.xyz/v4/opportunities?chainId=143&status=LIVE&items=100'
const MERKL_TTL       = 3 * 60 * 1000
const MERKL_PROTO_MAP: Record<string, string> = {
  curve: 'Curve', uniswap: 'Uniswap V3', pancakeswap: 'PancakeSwap V3',
  morpho: 'Morpho', kintsu: 'Kintsu', magma: 'Magma', shmonad: 'shMonad',
  lagoon: 'LAGOON', kuru: 'Kuru', gearbox: 'GearBox V3', curvance: 'Curvance',
  neverland: 'Neverland', euler: 'Euler V2', upshift: 'Upshift',
}
let merklAprCache: { map: AprLookup; ts: number } | null = null

async function fetchMerklAprs(): Promise<AprLookup> {
  if (merklAprCache && Date.now() - merklAprCache.ts < MERKL_TTL) return merklAprCache.map
  try {
    const pages = await Promise.all([1, 2, 3].map(page =>
      fetchThrottled(`${MERKL_BASE}&page=${page}`, {
        signal: AbortSignal.timeout(12_000), cache: 'no-store', headers: { 'Accept': 'application/json' },
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ))
    const raw: any[] = pages.flatMap(r => !r ? [] : (Array.isArray(r) ? r : (r?.data ?? r?.opportunities ?? [])))
    if (!raw.length) return new Map()
    const entries = raw.flatMap((opp: any) => {
      const proto = MERKL_PROTO_MAP[((opp.mainProtocol ?? opp.protocol) ?? '').toLowerCase()] ?? ''
      if (!proto) return []
      const apr = Number(opp.apr ?? 0)
      if (apr <= 0) return []
      const tokens: string[] = (opp.tokens ?? [])
        .filter((t: any) => t.type === 'TOKEN' && !String(t.symbol ?? '').endsWith('-gauge'))
        .map((t: any) => String(t.symbol ?? '')).filter(Boolean)
      return [{ protocol: proto, tokens, label: String(opp.name ?? opp.identifier ?? ''), apr }]
    })
    const map = entriesToLookup(entries)
    merklAprCache = { map, ts: Date.now() }
    return map
  } catch { return new Map() }
}

// Protocol name aliases: best-aprs uses different names than Zerion for some protocols
const PROTO_ALIASES: Record<string, string> = {
  'Euler V2':   'Euler Yield',   // best-aprs calls it "Euler V2", Zerion calls it "Euler Yield"
}

async function buildAprLookup(origin?: string): Promise<AprLookup> {
  // 1. Try the in-process aprCache (populated if best-aprs ran in same CF worker instance)
  const cached = getAprEntries()
  if (cached) return entriesToLookup(cached.map(normalizeProtoName))

  // 2. Fetch from our own best-aprs API (reuses its cache, single source of truth)
  if (origin) {
    try {
      const res = await fetchThrottled(`${origin}/api/best-aprs?format=entries`, {
        signal: AbortSignal.timeout(8_000), cache: 'no-store',
      })
      if (res.ok) {
        const entries = await res.json()
        if (Array.isArray(entries) && entries.length > 0) {
          return entriesToLookup(entries.map(normalizeProtoName))
        }
      }
    } catch { /* fall through to Merkl */ }
  }

  // 3. Fallback: fetch directly from Merkl
  return fetchMerklAprs()
}

function normalizeProtoName(e: any): any {
  const alias = PROTO_ALIASES[e.protocol]
  return alias ? { ...e, protocol: alias } : e
}

function lookupApr(map: AprLookup, pos: any): number {
  const proto  = String(pos.protocol ?? '')
  const tokens: string[] = pos.tokens ?? (pos.asset ? [pos.asset] : [])
  if (tokens.length > 0) { const k = proto + ':' + tokens.slice().sort().join('+'); if (map.has(k)) return map.get(k)! }
  const label = String(pos.label ?? pos.asset ?? '').toLowerCase().trim()
  if (label) { const k = proto + ':' + label; if (map.has(k)) return map.get(k)! }
  return map.get(proto) ?? 0
}

function injectBestAprs(positions: any[], map: AprLookup): any[] {
  return positions.map(pos => {
    if ((pos.apy ?? 0) > 0) return pos
    const apr = lookupApr(map, pos)
    return apr > 0 ? { ...pos, apy: apr } : pos
  })
}

// ─── Server-side cache per address (stale-while-revalidate) ─────────────────
// FRESH  (age < TTL):         serve from cache → 0 Zerion calls
// STALE  (age >= TTL):        serve stale immediately + revalidate async → 0 wait time
// EMPTY  (no cache):          fetch and block → 1 Zerion call (first visit only)
// IN-FLIGHT (promise exists): await in-flight → deduplicated, no extra Zerion call
const DEFI_CACHE_TTL  = 3 * 60 * 1000   // fresh window: 3 min
const DEFI_STALE_TTL  = 10 * 60 * 1000  // serve stale up to 10 min, revalidate async
const DEFI_CACHE_MAX  = 100             // cap entries to avoid unbounded memory growth
interface DefiCacheEntry { result: any; fetchedAt: number; promise: Promise<any> | null }
const defiCache = new Map<string, DefiCacheEntry>()

function defiCacheSet(key: string, entry: DefiCacheEntry): void {
  // Evict oldest entry when at capacity (simple FIFO)
  if (defiCache.size >= DEFI_CACHE_MAX && !defiCache.has(key)) {
    const firstKey = defiCache.keys().next().value
    if (firstKey) defiCache.delete(firstKey)
  }
  defiCache.set(key, entry)
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function fetchDefiForAddress(address: string, debugMode: boolean, origin?: string): Promise<any> {
  // Simplified: getMonPrice already handles caching internally
  const MON_PRICE = await getMonPrice().catch(() => 0)

  function safeFetch(name: string, fn: () => Promise<any[]>): Promise<any[]> {
    return fn().catch((e: any) => { console.error(`[defi][${name}]`, e?.message ?? e); return [] })
  }

  // All fetchers in parallel — Zerion replaces 6 on-chain fetchers with 1 HTTP call
  // EulerV2 is now indexed by Zerion — no separate fetcher needed
  // Midas now indexed by Zerion — no separate fetcher needed
  const [zerionR, gearR, upshiftR, lstsR, uniR, pcakeR] =
    await Promise.allSettled([
      safeFetch('Zerion',        () => fetchZerion(address)),
      safeFetch('Gearbox',       () => fetchGearbox(address, MON_PRICE)),
      safeFetch('Upshift',       () => fetchUpshift(address)),
      safeFetch('MonLSTs',       () => fetchMonLSTs(address, MON_PRICE)),
      safeFetch('UniswapV3',     () => fetchUniswapV3(address, 'Uniswap V3',    UNI_NFT_PM, UNI_FACTORY)),
      safeFetch('PancakeswapV3', () => fetchUniswapV3(address, 'PancakeSwap V3', '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364', '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865')),
    ])

  function unwrap(r: PromiseSettledResult<any[]>): any[] {
    return r.status === 'fulfilled' ? r.value : []
  }

  const lstPositions = unwrap(lstsR)

  if (debugMode) {
    const named: [string, PromiseSettledResult<any[]>][] = [
      ['Zerion', zerionR], ['Gearbox', gearR], ['Upshift', upshiftR],
      ['Kintsu',  { status: 'fulfilled', value: lstPositions.filter(p => p.protocol === 'Kintsu')  }],
      ['Magma',   { status: 'fulfilled', value: lstPositions.filter(p => p.protocol === 'Magma')   }],
      ['ShMonad', { status: 'fulfilled', value: lstPositions.filter(p => p.protocol === 'shMonad') }],
      ['UniswapV3', uniR], ['PancakeswapV3', pcakeR],
    ]
    return {
      __debug: true, monPrice: MON_PRICE,
      fetchers: named.map(([name, r]) => ({
        name, status: r.status,
        count:     r.status === 'fulfilled' ? r.value.length : 0,
        positions: r.status === 'fulfilled' ? r.value : [],
        error:     r.status === 'rejected'  ? String(r.reason) : null,
      })),
    }
  }

  let allPositions = [
    ...unwrap(zerionR),
    ...unwrap(gearR), ...unwrap(upshiftR), ...lstPositions,
    ...unwrap(uniR), ...unwrap(pcakeR),
  ]

  const bestAprsMap = await buildAprLookup(origin)
  allPositions = injectBestAprs(allPositions, bestAprsMap)

  const totalNetValueUSD = allPositions.reduce((s, p) => s + (p.netValueUSD ?? 0), 0)
  const totalDebtUSD     = allPositions.reduce((s, p) => s + (p.totalDebtUSD ?? 0), 0)
  const totalSupplyUSD   = allPositions.reduce((s, p) => s + (p.totalCollateralUSD ?? p.amountUSD ?? 0), 0)
  const activeProtocols  = [...new Set(allPositions.map(p => p.protocol))]

  return {
    positions: allPositions,
    summary: { totalNetValueUSD, totalDebtUSD, totalSupplyUSD, netValueUSD: totalNetValueUSD, activeProtocols, monPrice: MON_PRICE },
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }
  const debugMode = req.nextUrl.searchParams.get('debug') === '1'
  const key       = address.toLowerCase()

  if (!debugMode) {
    const entry = defiCache.get(key)
    const now   = Date.now()
    const age   = entry ? now - entry.fetchedAt : Infinity

    // FRESH: serve immediately, no work needed
    if (entry && !entry.promise && age < DEFI_CACHE_TTL) {
      return NextResponse.json(entry.result)
    }

    // IN-FLIGHT: another request is already revalidating — join it
    if (entry?.promise) {
      try { return NextResponse.json(await entry.promise) } catch { /* fall through */ }
    }

    // STALE: serve stale immediately and kick off background revalidation
    if (entry?.result && age < DEFI_STALE_TTL) {
      const bgPromise = fetchDefiForAddress(address, false, new URL(req.url).origin)
        .then(result  => { defiCacheSet(key, { result, fetchedAt: Date.now(), promise: null }) })
        .catch(()     => { const e = defiCache.get(key); if (e) defiCacheSet(key, { ...e, promise: null }) })
      defiCacheSet(key, { ...entry, promise: bgPromise as any })
      return NextResponse.json(entry.result)
    }
  }

  // EMPTY: first visit — must block until we have data
  const origin  = new URL(req.url).origin

  // Fix #9 (MÉDIO): Global 25s timeout — prevents a slow external API from
  // hanging a Cloudflare Worker slot indefinitely (each fetch has its own
  // timeout, but Promise.allSettled can still block if many are slow together).
  const fetchWithTimeout = (addr: string, debug: boolean, orig: string | undefined) =>
    Promise.race([
      fetchDefiForAddress(addr, debug, orig),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('fetchDefiForAddress timeout')), 25_000)
      ),
    ])

  const promise = fetchWithTimeout(address, debugMode, debugMode ? undefined : origin)

  if (!debugMode) {
    const existing = defiCache.get(key)
    defiCacheSet(key, { result: existing?.result ?? null, fetchedAt: existing?.fetchedAt ?? 0, promise })
  }

  try {
    const result = await promise
    if (!debugMode) defiCacheSet(key, { result, fetchedAt: Date.now(), promise: null })
    return NextResponse.json(result)
  } catch (e: any) {
    if (!debugMode) {
      const existing = defiCache.get(key)
      if (existing) defiCacheSet(key, { ...existing, promise: null })
      if (existing?.result) return NextResponse.json(existing.result)
    }
    console.error('[defi] fatal error:', e?.message ?? e)
    return NextResponse.json({ error: 'Failed to fetch DeFi positions' }, { status: 500 })
  }
}
