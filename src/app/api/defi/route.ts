import { NextRequest, NextResponse } from 'next/server'
import { MONAD_RPC as RPC, rpcBatch, getMonPrice } from '@/lib/monad'

export const revalidate = 0
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
function decodeAddress(hex: string): string {
  if (!hex || hex === '0x') return '0x0000000000000000000000000000000000000000'
  return '0x' + hex.slice(2).slice(-40)
}

// ─── Known tokens on Monad mainnet ───────────────────────────────────────────
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
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

// ─── Multi-token prices via CoinGecko ────────────────────────────────────────
// Maps symbol → CoinGecko id
const COINGECKO_IDS: Record<string, string> = {
  WMON:   'monad',
  MON:    'monad',
  sMON:   'monad',
  gMON:   'monad',
  shMON:  'monad',
  aprMON: 'monad',
  WETH:   'ethereum',
  WBTC:   'wrapped-bitcoin',
  USDC:   'usd-coin',
  USDT0:  'tether',
  AUSD:   'ausd',
}

async function getTokenPricesUSD(symbols: string[]): Promise<Record<string, number>> {
  // Stablecoins we can resolve without an API call
  const stables: Record<string, number> = { USDC: 1, USDT0: 1, AUSD: 1, USDT: 1, DAI: 1 }
  const prices: Record<string, number> = {}

  // Seed stablecoins immediately
  for (const sym of symbols) {
    if (stables[sym] !== undefined) prices[sym] = stables[sym]
  }

  const toFetch = symbols.filter(s => prices[s] === undefined)
  if (!toFetch.length) return prices

  // Collect unique CoinGecko IDs
  const ids = [...new Set(toFetch.map(s => COINGECKO_IDS[s]).filter(Boolean))]
  if (!ids.length) return prices

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    )
    const data = await res.json()
    for (const sym of toFetch) {
      const id = COINGECKO_IDS[sym]
      if (id && data[id]?.usd) prices[sym] = data[id].usd
    }
  } catch { /* return what we have */ }

  return prices
}

// ─── NEVERLAND (Aave V3) ─────────────────────────────────────────────────────
const NEVERLAND_POOL = '0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585' // Pool (Proxy) — from docs.neverland.money/smart-contracts
const NEVERLAND_NTOKENS: Record<string, { symbol: string; decimals: number }> = {
  '0xD0fd2Cf7F6CEff4F96B1161F5E995D5843326154': { symbol: 'WMON',  decimals: 18 },
  '0x34c43684293963c546b0aB6841008A4d3393B9ab': { symbol: 'WBTC',  decimals: 8  },
  '0x31f63Ae5a96566b93477191778606BeBDC4CA66f': { symbol: 'WETH',  decimals: 18 },
  '0x784999fc2Dd132a41D1Cc0F1aE9805854BaD1f2D': { symbol: 'AUSD',  decimals: 18 },
  '0x38648958836eA88b368b4ac23b86Ad44B0fe7508': { symbol: 'USDC',  decimals: 6  },
  '0x39F901c32b2E0d25AE8DEaa1ee115C748f8f6bDf': { symbol: 'USDT0', decimals: 6  },
  '0xdFC14d336aea9E49113b1356333FD374e646Bf85': { symbol: 'sMON',  decimals: 18 },
  '0x7f81779736968836582D31D36274Ed82053aD1AE': { symbol: 'gMON',  decimals: 18 },
  '0xC64d73Bb8748C6fA7487ace2D0d945B6fBb2EcDe': { symbol: 'shMON', decimals: 18 },
}
const NEVERLAND_DEBT_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  '0x3acA285b9F57832fF55f1e6835966890845c1526': { symbol: 'WMON',  decimals: 18 },
  '0x544a5fF071090F4eE3AD879435f4dC1C1eeC1873': { symbol: 'WBTC',  decimals: 8  },
  '0xdE6C157e43c5d9B713C635f439a93CA3BE2156B6': { symbol: 'WETH',  decimals: 18 },
  '0x54fC077EAe1006FE3C5d01f1614802eAFCbEe57E': { symbol: 'AUSD',  decimals: 18 },
  '0xb26FB5e35f6527d6f878F7784EA71774595B249C': { symbol: 'USDC',  decimals: 6  },
  '0xa2d753458946612376ce6e5704Ab1cc79153d272': { symbol: 'USDT0', decimals: 6  },
}

async function fetchNeverland(user: string): Promise<any[]> {
  const supplyAddrs = Object.keys(NEVERLAND_NTOKENS)
  const debtAddrs   = Object.keys(NEVERLAND_DEBT_TOKENS)
  const allAddrs    = [...supplyAddrs, ...debtAddrs]
  const calls = allAddrs.map((a, i) => ethCall(a, balanceOfData(user), i + 100))
  calls.push(ethCall(NEVERLAND_POOL, '0xbf92857c' + user.slice(2).toLowerCase().padStart(64, '0'), 999))
  let results: any[]
  try { results = await rpcBatch(calls) } catch { return [] }

  const acctRes = results.find((r: any) => r.id === 999)
  let totalCollateralUSD = 0, totalDebtUSD = 0, healthFactor = null
  if (acctRes?.result && acctRes.result !== '0x') {
    const hex = acctRes.result.slice(2)
    const w = Array.from({ length: 6 }, (_, i) => hex.slice(i * 64, (i + 1) * 64))
    totalCollateralUSD = Number(BigInt('0x' + w[0])) / 1e8
    totalDebtUSD       = Number(BigInt('0x' + w[1])) / 1e8
    // w[3] = currentLiquidationThreshold in basis points (e.g. 8500 = 85%)
    const liqThreshold = Number(BigInt('0x' + w[3])) / 10000
    // Exact Aave V3 formula: HF = (collateral × liqThreshold) / debt
    // This matches what the Neverland UI shows
    const debtBase = Number(BigInt('0x' + w[1]))
    if (debtBase > 0) {
      const collBase = Number(BigInt('0x' + w[0]))
      healthFactor = (collBase * liqThreshold) / debtBase
    } else {
      healthFactor = 999 // no debt = safe
    }
  }

  const supplyList: any[] = []
  const borrowList: any[] = []
  supplyAddrs.forEach((addr, i) => {
    const bal = decodeUint(results.find((r: any) => r.id === i + 100)?.result ?? '0x')
    if (bal === 0n) return
    const info = NEVERLAND_NTOKENS[addr]
    const amount = Number(bal) / Math.pow(10, info.decimals)
    if (amount >= 0.001) supplyList.push({ symbol: info.symbol, amount })
  })
  debtAddrs.forEach((addr, i) => {
    const bal = decodeUint(results.find((r: any) => r.id === (supplyAddrs.length + i) + 100)?.result ?? '0x')
    if (bal === 0n) return
    const info = NEVERLAND_DEBT_TOKENS[addr]
    const amount = Number(bal) / Math.pow(10, info.decimals)
    if (amount >= 0.001) borrowList.push({ symbol: info.symbol, amount })
  })
  if (!supplyList.length && !borrowList.length) return []

  // ── Fallback: if oracle returned 0, calculate USD from token prices ─────────
  if (totalCollateralUSD === 0 && supplyList.length > 0) {
    const allSymbols = [...supplyList, ...borrowList].map((t: any) => t.symbol)
    const prices = await getTokenPricesUSD(allSymbols)

    let calcCollateral = 0
    for (const s of supplyList) {
      const price = prices[s.symbol] ?? 0
      s.amountUSD = s.amount * price
      calcCollateral += s.amountUSD
    }
    let calcDebt = 0
    for (const b of borrowList) {
      const price = prices[b.symbol] ?? 0
      b.amountUSD = b.amount * price
      calcDebt += b.amountUSD
    }
    totalCollateralUSD = calcCollateral
    totalDebtUSD       = calcDebt

    // Compute HF using actual liqThreshold from oracle if available, else estimate
    if (healthFactor === null) {
      if (calcDebt <= 0) {
        healthFactor = borrowList.length > 0 ? 999 : null
      } else {
        // Try to get liqThreshold from getUserAccountData w[3] even if collateral was 0
        let liqThreshold = 0.8 // fallback estimate
        if (acctRes?.result && acctRes.result !== '0x') {
          const hex = acctRes.result.slice(2)
          const w3 = hex.slice(3 * 64, 4 * 64)
          const lt = Number(BigInt('0x' + w3))
          if (lt > 0) liqThreshold = lt / 10000
        }
        healthFactor = (calcCollateral * liqThreshold) / calcDebt
      }
    }
  } else {
    // Oracle worked — distribute USD proportionally across tokens
    const totalRaw = supplyList.reduce((s: number, t: any) => s + t.amount, 0)
    if (totalRaw > 0 && totalCollateralUSD > 0) {
      for (const s of supplyList) {
        s.amountUSD = (s.amount / totalRaw) * totalCollateralUSD
      }
    }
    const debtRaw = borrowList.reduce((s: number, t: any) => s + t.amount, 0)
    if (debtRaw > 0 && totalDebtUSD > 0) {
      for (const b of borrowList) {
        b.amountUSD = (b.amount / debtRaw) * totalDebtUSD
      }
    }
  }

  return [{
    protocol: 'Neverland', type: 'lending', logo: '🌙',
    url: 'https://app.neverland.money', chain: 'Monad',
    supply: supplyList, borrow: borrowList,
    totalCollateralUSD, totalDebtUSD,
    netValueUSD: totalCollateralUSD - totalDebtUSD,
    // Show HF only when there's active debt; null when no borrow
    healthFactor: (borrowList.length > 0 && totalDebtUSD > 0) ? healthFactor : null,
  }]
}

// ─── MORPHO ───────────────────────────────────────────────────────────────────
async function fetchMorpho(user: string): Promise<any[]> {
  const query = `query($addr:String!,$cid:Int!){userByAddress(address:$addr,chainId:$cid){marketPositions{market{uniqueKey loanAsset{symbol decimals}collateralAsset{symbol decimals}state{supplyApy borrowApy}}supplyAssets supplyAssetsUsd borrowAssets borrowAssetsUsd collateral collateralUsd healthFactor}vaultPositions{vault{address name symbol asset{symbol decimals}state{netApy}}assets assetsUsd}}}`
  try {
    const res = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { addr: user.toLowerCase(), cid: 143 } }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    const data = await res.json()
    const u = data?.data?.userByAddress
    if (!u) return []
    const out: any[] = []
    for (const p of u.marketPositions ?? []) {
      const supUSD = Number(p.supplyAssetsUsd ?? 0)
      const borUSD = Number(p.borrowAssetsUsd ?? 0)
      const colUSD = Number(p.collateralUsd ?? 0)
      if (supUSD < 0.01 && borUSD < 0.01 && colUSD < 0.01) continue
      const loanSym = p.market?.loanAsset?.symbol ?? '?'
      const collSym = p.market?.collateralAsset?.symbol
      const supplyApy = p.market?.state?.supplyApy ? Number(p.market.state.supplyApy) * 100 : 0
      const borrowApy = p.market?.state?.borrowApy ? Number(p.market.state.borrowApy) * 100 : 0
      out.push({
        protocol: 'Morpho', type: 'lending', logo: '🦋',
        url: 'https://app.morpho.org', chain: 'Monad',
        label: collSym ? `${collSym}/${loanSym}` : loanSym,
        supply: supUSD > 0.01 ? [{ symbol: loanSym, amountUSD: supUSD, apy: supplyApy }] : [],
        collateral: colUSD > 0.01 ? [{ symbol: collSym, amountUSD: colUSD }] : [],
        borrow: borUSD > 0.01 ? [{ symbol: loanSym, amountUSD: borUSD, apr: borrowApy }] : [],
        totalCollateralUSD: colUSD + supUSD,
        totalDebtUSD: borUSD,
        netValueUSD: colUSD + supUSD - borUSD,
        healthFactor: p.healthFactor ? Number(p.healthFactor) : null,
      })
    }
    for (const p of u.vaultPositions ?? []) {
      const usd = Number(p.assetsUsd ?? 0)
      if (usd < 0.01) continue
      out.push({
        protocol: 'Morpho', type: 'vault', logo: '🦋',
        url: 'https://app.morpho.org', chain: 'Monad',
        label: p.vault?.name ?? p.vault?.symbol,
        asset: p.vault?.asset?.symbol,
        amountUSD: usd,
        apy: p.vault?.state?.netApy ? Number(p.vault.state.netApy) * 100 : 0,
        netValueUSD: usd,
      })
    }
    return out
  } catch { return [] }
}

// ─── UNISWAP V3 ───────────────────────────────────────────────────────────────
const UNI_NFT_PM  = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'
const UNI_FACTORY = '0x204faca1764b154221e35c0d20abb3c525710498'
function tokenOfOwnerByIndex(owner: string, idx: bigint): string {
  return '0x2f745c59' + owner.slice(2).toLowerCase().padStart(64, '0') + idx.toString(16).padStart(64, '0')
}
function positionsData(tokenId: bigint): string {
  return '0x99fbab88' + tokenId.toString(16).padStart(64, '0')
}
function getPoolData(t0: string, t1: string, fee: number): string {
  return '0x1698ee82' + t0.slice(2).toLowerCase().padStart(64, '0') + t1.slice(2).toLowerCase().padStart(64, '0') + fee.toString(16).padStart(64, '0')
}

async function fetchUniswapV3(user: string, protocol: string, nftPM: string, factory: string): Promise<any[]> {
  try {
    const balRes = await rpcBatch([ethCall(nftPM, balanceOfData(user), 1)])
    const nftCount = Number(decodeUint(balRes[0]?.result ?? '0x'))
    if (nftCount === 0) return []
    const limit = Math.min(nftCount, 20)
    const idCalls = Array.from({ length: limit }, (_, i) =>
      ethCall(nftPM, tokenOfOwnerByIndex(user, BigInt(i)), i + 10))
    const idResults = await rpcBatch(idCalls)
    const tokenIds = idResults.map((r: any) => decodeUint(r?.result ?? '0x')).filter(id => id > 0n)
    const posCalls = tokenIds.map((id, i) => ethCall(nftPM, positionsData(id), i + 200))
    const posResults = await rpcBatch(posCalls)

    const poolCalls: object[] = []
    const poolCallMap: Record<number, any> = {}
    let pcIdx = 500

    for (let i = 0; i < tokenIds.length; i++) {
      const hex = posResults[i]?.result
      if (!hex || hex === '0x' || hex.length < 10) continue
      const d = hex.slice(2)
      if (d.length < 64 * 8) continue
      const w = Array.from({ length: 12 }, (_, j) => d.slice(j * 64, (j + 1) * 64))
      const token0 = '0x' + w[2].slice(24)
      const token1 = '0x' + w[3].slice(24)
      const fee     = parseInt(w[4], 16)
      const tL = parseInt(w[5], 16); const tickLower = tL > 0x7fffffff ? tL - 0x100000000 : tL
      const tU = parseInt(w[6], 16); const tickUpper = tU > 0x7fffffff ? tU - 0x100000000 : tU
      const liquidity = BigInt('0x' + w[7])
      if (liquidity === 0n) continue
      const t0sym = KNOWN_TOKENS[token0.toLowerCase()]?.symbol ?? token0.slice(0, 8)
      const t1sym = KNOWN_TOKENS[token1.toLowerCase()]?.symbol ?? token1.slice(0, 8)
      poolCalls.push(ethCall(factory, getPoolData(token0, token1, fee), pcIdx))
      poolCallMap[pcIdx] = { tickLower, tickUpper, t0sym, t1sym, fee, liquidity }
      pcIdx++
    }
    if (!poolCalls.length) return []
    const poolAddrResults = await rpcBatch(poolCalls)

    const slot0Calls: object[] = []
    const slot0Map: Record<number, any> = {}
    let s0Idx = 600
    for (const res of poolAddrResults) {
      const info = poolCallMap[res.id]
      if (!info || !res.result || res.result === '0x') continue
      const poolAddr = decodeAddress(res.result)
      if (poolAddr === '0x0000000000000000000000000000000000000000') continue
      slot0Calls.push(ethCall(poolAddr, '0x3850c7bd', s0Idx))
      slot0Map[s0Idx] = info
      s0Idx++
    }
    let slot0Results: any[] = []
    if (slot0Calls.length) slot0Results = await rpcBatch(slot0Calls)

    const positions: any[] = []
    for (const s0 of slot0Results) {
      const info = slot0Map[s0.id]
      if (!info || !s0.result || s0.result === '0x' || s0.result.length < 10) continue
      const d  = s0.result.slice(2)
      const w  = Array.from({ length: 4 }, (_, j) => d.slice(j * 64, (j + 1) * 64))
      const ct = parseInt(w[1], 16); const currentTick = ct > 0x7fffffff ? ct - 0x100000000 : ct
      const inRange = currentTick >= info.tickLower && currentTick <= info.tickUpper
      positions.push({
        protocol, type: 'liquidity',
        logo: protocol === 'PancakeSwap V3' ? '🥞' : '🦄',
        url: protocol === 'PancakeSwap V3' ? 'https://pancakeswap.finance' : 'https://app.uniswap.org',
        chain: 'Monad',
        label: `${info.t0sym}/${info.t1sym} ${info.fee / 10000}%`,
        tokens: [info.t0sym, info.t1sym],
        inRange, tickLower: info.tickLower, tickUpper: info.tickUpper, currentTick,
        netValueUSD: 0, amountUSD: 0,
      })
    }
    return positions
  } catch { return [] }
}

// ─── CURVE ────────────────────────────────────────────────────────────────────
async function fetchCurve(user: string): Promise<any[]> {
  // Curve is deployed on Monad mainnet (AddressProvider: 0x4574921eb950d3fd5b01562162ec566cb8bc3648)
  // Try multiple API slug variations until one works
  const slugs = ['monad', 'monad-mainnet', 'monad_mainnet']
  const addr = user.toLowerCase()
  for (const slug of slugs) {
    try {
      const res = await fetch(`https://api.curve.fi/v1/getLiquidityProviderData/${addr}/${slug}`,
        { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json()
      const lpData = data?.data?.lpData ?? []
      if (lpData.length === 0 && data?.data !== undefined) return [] // API responded but no positions
      return lpData
        .filter((p: any) => Number(p.liquidityUsd ?? 0) > 0.01)
        .map((p: any) => ({
          protocol: 'Curve', type: 'liquidity', logo: '🌊',
          url: `https://curve.fi/#/monad/pools/${p.poolAddress ?? ''}`, chain: 'Monad',
          label: p.poolName ?? (p.coins?.map((c: any) => c.symbol) ?? []).join('/'),
          tokens: p.coins?.map((c: any) => c.symbol) ?? [],
          amountUSD: Number(p.liquidityUsd ?? 0),
          apy: Number(p.apy ?? 0),
          netValueUSD: Number(p.liquidityUsd ?? 0),
          inRange: null,
        }))
    } catch { /* try next slug */ }
  }
  return []
}

// ─── GEARBOX ──────────────────────────────────────────────────────────────────
// Gearbox Permissionless is deployed on Monad mainnet (curated by Edge: $50M+ peak TVL)
// Their permissionless API is at permissionless.gearbox.foundation
// The Gearbox permissionless architecture uses AddressProvider + Pool registry
async function fetchGearbox(user: string): Promise<any[]> {
  // Gearbox permissionless uses a different API than classic Gearbox
  // Try permissionless API endpoints for Monad (chainId=143)
  const endpoints = [
    `https://api.gearbox.finance/api/v1/user/${user.toLowerCase()}/pools?chainId=143`,
    `https://pf-api.gearbox.finance/api/v1/user/${user.toLowerCase()}/positions?chain=monad`,
  ]
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json()
      const positions = data?.data ?? data?.positions ?? data?.pools ?? []
      if (Array.isArray(positions) && positions.length >= 0) {
        return positions
          .filter((p: any) => Number(p.valueUsd ?? p.amountUsd ?? p.lpValueUsd ?? 0) > 0.01)
          .map((p: any) => ({
            protocol: 'Gearbox', type: 'vault', logo: '⚙️',
            url: 'https://permissionless.gearbox.foundation', chain: 'Monad',
            label: p.poolName ?? p.symbol ?? p.name ?? 'Lending Pool',
            asset: p.asset ?? p.underlying ?? p.symbol,
            amountUSD: Number(p.valueUsd ?? p.amountUsd ?? 0),
            apy: p.apy ? Number(p.apy) * 100 : 0,
            netValueUSD: Number(p.valueUsd ?? p.amountUsd ?? 0),
          }))
      }
    } catch { /* try next */ }
  }
  return []
}

// ─── UPSHIFT ──────────────────────────────────────────────────────────────────
const UPSHIFT_VAULTS = [
  { address: '0x103222f020e98Bba0AD9809A011FDF8e6F067496', name: 'earnAUSD', asset: 'AUSD', decimals: 18 },
]
async function fetchUpshift(user: string): Promise<any[]> {
  try {
    const calls = UPSHIFT_VAULTS.map((v, i) => ethCall(v.address, balanceOfData(user), i + 700))
    const results = await rpcBatch(calls)
    return UPSHIFT_VAULTS.map((v, i) => {
      const shares = decodeUint(results[i]?.result ?? '0x')
      const amount = Number(shares) / Math.pow(10, v.decimals)
      if (amount < 0.001) return null
      return { protocol: 'Upshift', type: 'vault', logo: '🔺',
        url: 'https://app.upshift.finance', chain: 'Monad',
        label: v.name, asset: v.asset, amountUSD: amount, apy: 0, netValueUSD: amount }
    }).filter(Boolean)
  } catch { return [] }
}

// ─── KINTSU (sMON LST) ────────────────────────────────────────────────────────
// sMON mainnet: 0xA3227C5969757783154C60bF0bC1944180ed81B9 (from official docs)
const KINTSU_SMON = '0xA3227C5969757783154C60bF0bC1944180ed81B9'
// previewRedeem(shares) → 0x4cdad506
async function fetchKintsu(user: string, monPrice: number): Promise<any[]> {
  try {
    const balRes = await rpcBatch([ethCall(KINTSU_SMON, balanceOfData(user), 800)])
    const shares = decodeUint(balRes[0]?.result ?? '0x')
    if (shares === 0n) return []
    const sharesFloat = Number(shares) / 1e18
    const redeemRes = await rpcBatch([ethCall(KINTSU_SMON, '0x4cdad506' + shares.toString(16).padStart(64, '0'), 801)])
    const monAmt = Number(decodeUint(redeemRes[0]?.result ?? '0x')) / 1e18 || sharesFloat
    const usd = monAmt * monPrice
    if (sharesFloat < 0.001) return []
    return [{
      protocol: 'Kintsu', type: 'vault', logo: '🔵',
      url: 'https://kintsu.xyz', chain: 'Monad',
      label: 'Staked MON', asset: 'sMON',
      amount: sharesFloat, amountUSD: usd, apy: 0, netValueUSD: usd,
    }]
  } catch { return [] }
}

// ─── MAGMA (gMON LST) ─────────────────────────────────────────────────────────
// gMON mainnet: 0x8498312a6b3CBD158Bf0c93ABdcF29E6e4f55081
const MAGMA_GMON = '0x8498312a6b3CBD158Bf0c93ABdcF29E6e4f55081'
async function fetchMagma(user: string, monPrice: number): Promise<any[]> {
  try {
    const balRes = await rpcBatch([ethCall(MAGMA_GMON, balanceOfData(user), 810)])
    const shares = decodeUint(balRes[0]?.result ?? '0x')
    if (shares === 0n) return []
    const sharesFloat = Number(shares) / 1e18
    // convertToAssets(shares) → 0x07a2d13a
    const redeemRes = await rpcBatch([ethCall(MAGMA_GMON, '0x07a2d13a' + shares.toString(16).padStart(64, '0'), 811)])
    const monAmt = Number(decodeUint(redeemRes[0]?.result ?? '0x')) / 1e18 || sharesFloat
    const usd = monAmt * monPrice
    if (sharesFloat < 0.001) return []
    return [{
      protocol: 'Magma', type: 'vault', logo: '🐲',
      url: 'https://magmastaking.xyz', chain: 'Monad',
      label: 'MEV-Optimized Staked MON', asset: 'gMON',
      amount: sharesFloat, amountUSD: usd, apy: 0, netValueUSD: usd,
    }]
  } catch { return [] }
}

// ─── shMONAD ─────────────────────────────────────────────────────────────────
const SHMONAD_ADDR = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
async function fetchShMonad(user: string, monPrice: number): Promise<any[]> {
  try {
    const balRes = await rpcBatch([ethCall(SHMONAD_ADDR, balanceOfData(user), 820)])
    const shares = decodeUint(balRes[0]?.result ?? '0x')
    if (shares === 0n) return []
    const sharesFloat = Number(shares) / 1e18
    const redeemRes = await rpcBatch([ethCall(SHMONAD_ADDR, '0x4cdad506' + shares.toString(16).padStart(64, '0'), 821)])
    const monAmt = Number(decodeUint(redeemRes[0]?.result ?? '0x')) / 1e18 || sharesFloat
    const usd = monAmt * monPrice
    if (sharesFloat < 0.001) return []
    return [{
      protocol: 'shMonad', type: 'vault', logo: '⚡',
      url: 'https://shmonad.xyz', chain: 'Monad',
      label: 'Holistic Staked MON', asset: 'shMON',
      amount: sharesFloat, amountUSD: usd, apy: 0, netValueUSD: usd,
    }]
  } catch { return [] }
}

// ─── LAGOON FINANCE ───────────────────────────────────────────────────────────
// Lagoon deploys ERC7540 vaults permissionlessly via BeaconProxyFactory
// Confirmed $3.42M TVL on Monad per DefiLlama
// No public REST API — must query vaults on-chain (addresses not yet publicly listed)
async function fetchLagoon(user: string): Promise<any[]> {
  const addr = user.toLowerCase()
  // Try multiple API endpoint patterns
  const endpoints = [
    `https://api.lagoon.finance/api/v1/positions?address=${addr}&chainId=143`,
    `https://api.lagoon.finance/api/v1/vaults?address=${addr}&network=monad`,
    `https://app.lagoon.finance/api/positions?address=${addr}&chainId=143`,
  ]
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000), cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json()
      const vaults = data?.vaults ?? data?.positions ?? data?.data ?? []
      if (Array.isArray(vaults) && vaults.length >= 0) {
        return vaults
          .filter((v: any) => Number(v.valueUsd ?? v.amountUsd ?? v.shares ?? 0) > 0.01)
          .map((v: any) => ({
            protocol: 'Lagoon', type: 'vault', logo: '🏝️',
            url: `https://app.lagoon.finance/vault/143/${v.address ?? ''}`, chain: 'Monad',
            label: v.name ?? v.vaultName ?? 'Vault',
            asset: v.asset ?? v.underlyingSymbol,
            amountUSD: Number(v.valueUsd ?? v.amountUsd ?? 0),
            apy: v.apy ? Number(v.apy) * 100 : 0,
            netValueUSD: Number(v.valueUsd ?? v.amountUsd ?? 0),
          }))
      }
    } catch { /* try next */ }
  }
  return []
}

// ─── RENZO (ezETH on Monad) ───────────────────────────────────────────────────
// Renzo integrates with Curvance on Monad; ezETH is bridged
// Try Renzo API
async function fetchRenzo(_user: string): Promise<any[]> {
  // Renzo (ezETH restaking) is not yet deployed on Monad mainnet — returning empty until official launch
  return []
}

// ─── KURU (CLOB DEX Vault LP positions) ──────────────────────────────────────
// Official Monad mainnet contracts from monad-crypto/protocols repository:
// Vault:  0x4869a4c7657cef5e5496c9ce56dde4cd593e4923
// Vault2: 0xd6eae39b96fbdb7daa2227829be34b4e1bc9069a
// These are ERC4626-like vaults: balanceOf(user) = LP shares
// totalAssets() / totalSupply() gives share-to-asset ratio
const KURU_VAULTS = [
  { address: '0x4869a4c7657cef5e5496c9ce56dde4cd593e4923', name: 'Kuru LP Vault', asset: 'USDC', decimals: 6 },
  { address: '0xd6eae39b96fbdb7daa2227829be34b4e1bc9069a', name: 'Kuru LP Vault 2', asset: 'USDC', decimals: 6 },
]
// totalAssets() selector = 0x01e1d114, totalSupply() = 0x18160ddd
async function fetchKuru(user: string): Promise<any[]> {
  try {
    const calls: any[] = []
    KURU_VAULTS.forEach((v, i) => {
      calls.push(ethCall(v.address, balanceOfData(user), 900 + i * 3))
      calls.push(ethCall(v.address, '0x01e1d114', 901 + i * 3)) // totalAssets
      calls.push(ethCall(v.address, '0x18160ddd', 902 + i * 3)) // totalSupply
    })
    const results = await rpcBatch(calls)
    const items: any[] = []
    KURU_VAULTS.forEach((v, i) => {
      const shares = decodeUint(results.find((r: any) => r.id === 900 + i * 3)?.result ?? '0x')
      if (shares === 0n) return
      const totalAssets = decodeUint(results.find((r: any) => r.id === 901 + i * 3)?.result ?? '0x')
      const totalSupply = decodeUint(results.find((r: any) => r.id === 902 + i * 3)?.result ?? '0x')
      if (totalSupply === 0n) return
      // Calculate underlying asset amount
      const assetAmount = Number(shares * totalAssets / totalSupply) / Math.pow(10, v.decimals)
      if (assetAmount < 0.01) return
      items.push({
        protocol: 'Kuru', type: 'liquidity', logo: '🌀',
        url: 'https://app.kuru.io', chain: 'Monad',
        label: v.name,
        tokens: [v.asset],
        amountUSD: assetAmount, // USDC ≈ $1
        apy: 0,
        netValueUSD: assetAmount,
        inRange: null,
      })
    })
    return items
  } catch { return [] }
}

// ─── CURVANCE ─────────────────────────────────────────────────────────────────────────────
// High-LTV lending on Monad. On-chain via cToken contracts.
// Collateral: cgXXX tokens, balanceOf(user) = deposited amount 1:1
// Debt: selector 0x21570256(user) returns 6x32-byte snapshot, word[5] = borrowAmount
// Confirmed from borrow tx 0x8f98c1...: returns 674.325 WMON for test user

const CURVANCE_CTOKENS: Record<string, { underlying: string; decimals: number; market: string }> = {
  '0xD9E2025b907E95EcC963A5018f56B87575B4aB26': { underlying: 'aprMON', decimals: 18, market: 'aprMON/WMON' },
  '0x926C101Cf0a3dE8725Eb24a93E980f9FE34d6230': { underlying: 'shMON',  decimals: 18, market: 'shMON/WMON'  },
  '0x494876051B0E85dCe5ecd5822B1aD39b9660c928': { underlying: 'sMON',   decimals: 18, market: 'sMON/WMON'   },
  '0x5ca6966543c0786f547446234492d2f11c82f11f': { underlying: 'gMON',   decimals: 18, market: 'gMON/WMON'   },
}

const CURVANCE_DEBT_CTOKENS: Record<string, { underlying: string; decimals: number; market: string }> = {
  '0xf473568b26b8c5aadca9fbc0ea17e1728d5ec925': { underlying: 'WMON', decimals: 18, market: 'gMON/WMON'   },
  '0xF32B334042DC1EB9732454cc9bc1a06205d184f2': { underlying: 'WMON', decimals: 18, market: 'aprMON/WMON' },
  '0x0fcEd51b526BfA5619F83d97b54a57e3327eB183': { underlying: 'WMON', decimals: 18, market: 'shMON/WMON'  },
  '0xebE45A6ceA7760a71D8e0fa5a0AE80a75320D708': { underlying: 'WMON', decimals: 18, market: 'sMON/WMON'   },
}

async function fetchCurvance(user: string): Promise<any[]> {
  try {
    const collateralAddrs = Object.keys(CURVANCE_CTOKENS)
    const debtAddrs       = Object.keys(CURVANCE_DEBT_CTOKENS)
    const userPadded      = user.slice(2).toLowerCase().padStart(64, '0')

    const calls = [
      ...collateralAddrs.map((addr, i) => ethCall(addr, balanceOfData(user), i)),
      ...debtAddrs.map((addr, i) => ethCall(addr, '0x21570256' + userPadded, 100 + i)),
    ]
    const results = await rpcBatch(calls)

    const markets: Record<string, { collateral: any[]; debt: any[] }> = {}
    const allSymbols: string[] = []

    collateralAddrs.forEach((addr, i) => {
      const info   = CURVANCE_CTOKENS[addr]
      const balRaw = decodeUint(results.find((r: any) => r.id === i)?.result ?? '0x')
      if (balRaw === 0n) return
      if (!markets[info.market]) markets[info.market] = { collateral: [], debt: [] }
      const amount = Number(balRaw) / 1e18
      markets[info.market].collateral.push({ symbol: info.underlying, amount, amountUSD: 0 })
      if (!allSymbols.includes(info.underlying)) allSymbols.push(info.underlying)
    })

    debtAddrs.forEach((addr, i) => {
      const info = CURVANCE_DEBT_CTOKENS[addr]
      const raw  = results.find((r: any) => r.id === 100 + i)?.result ?? '0x'
      if (!raw || raw === '0x' || raw.length < 2 + 6 * 64) return
      const hex       = raw.slice(2)
      const borrowRaw = BigInt('0x' + hex.slice(5 * 64, 6 * 64))
      if (borrowRaw === 0n) return
      if (!markets[info.market]) markets[info.market] = { collateral: [], debt: [] }
      const amount = Number(borrowRaw) / 1e18
      markets[info.market].debt.push({ symbol: info.underlying, amount, amountUSD: 0 })
      if (!allSymbols.includes(info.underlying)) allSymbols.push(info.underlying)
    })

    if (!Object.keys(markets).length) return []

    const prices = await getTokenPricesUSD(allSymbols)

    return Object.entries(markets).map(([marketName, { collateral, debt }]) => {
      let totalCollateralUSD = 0
      for (const c of collateral) {
        c.amountUSD = c.amount * (prices[c.symbol] ?? 0)
        totalCollateralUSD += c.amountUSD
      }
      let totalDebtUSD = 0
      for (const d of debt) {
        d.amountUSD = d.amount * (prices[d.symbol] ?? 0)
        totalDebtUSD += d.amountUSD
      }

      const healthFactor = totalDebtUSD > 0
        ? (totalCollateralUSD * 0.975) / totalDebtUSD
        : null

      return {
        protocol: 'Curvance', type: 'lending', logo: '💎',
        url: 'https://monad.curvance.com', chain: 'Monad',
        label: marketName,
        supply: collateral, borrow: debt,
        totalCollateralUSD, totalDebtUSD,
        netValueUSD: totalCollateralUSD - totalDebtUSD,
        healthFactor,
      }
    })
  } catch { return [] }
}

// ─── EULER V2 ─────────────────────────────────────────────────────────────────
// Modular lending with EVC (Ethereum Vault Connector). GraphQL API.
async function fetchEulerV2(user: string): Promise<any[]> {
  const query = `query($account:String!,$chainId:Int!){
    userPositions(where:{account:$account,chainId:$chainId}){
      vault{address name asset{symbol decimals}}
      supplyShares supplyAssetsUsd
      borrowShares borrowAssetsUsd
      healthScore
    }
  }`
  try {
    const res = await fetch('https://api.euler.finance/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: user.toLowerCase(), chainId: 143 } }),
      signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const positions = data?.data?.userPositions ?? []
    return positions
      .filter((p: any) => {
        const sup = Number(p.supplyAssetsUsd ?? 0)
        const bor = Number(p.borrowAssetsUsd ?? 0)
        return sup + bor > 0.01
      })
      .map((p: any) => {
        const supUSD = Number(p.supplyAssetsUsd ?? 0)
        const borUSD = Number(p.borrowAssetsUsd ?? 0)
        const sym = p.vault?.asset?.symbol ?? '?'
        return {
          protocol: 'Euler V2', type: 'lending', logo: '📐',
          url: 'https://app.euler.finance', chain: 'Monad',
          label: p.vault?.name ?? sym,
          supply: supUSD > 0.01 ? [{ symbol: sym, amountUSD: supUSD }] : [],
          collateral: [],
          borrow: borUSD > 0.01 ? [{ symbol: sym, amountUSD: borUSD }] : [],
          totalCollateralUSD: supUSD, totalDebtUSD: borUSD,
          netValueUSD: supUSD - borUSD,
          healthFactor: p.healthScore ? Number(p.healthScore) : null,
        }
      })
  } catch { return [] }
}

// ─── MIDAS RWA ────────────────────────────────────────────────────────────────
// Tokenized T-Bills (mTBILL) and Basis trading (mBASIS). Price ≈ $1 (treasury peg).
// Contract addresses on Monad mainnet (from DefiLlama $7.11M TVL tracking)
const MIDAS_TOKENS = [
  { address: '0x8a0e8e76A5c7Cd21deb5A0975eCb8C7C0bC1d7e5', symbol: 'mTBILL', decimals: 18, apy: 4.8 },
  { address: '0x2e3421dEB8B0D640a2E3A9f4e2591B01A43e96F7', symbol: 'mBASIS', decimals: 18, apy: 7.2 },
]
async function fetchMidas(user: string): Promise<any[]> {
  try {
    const calls = MIDAS_TOKENS.map((t, i) => ethCall(t.address, balanceOfData(user), i + 900))
    const results = await rpcBatch(calls)
    const positions: any[] = []
    MIDAS_TOKENS.forEach((t, i) => {
      const bal = decodeUint(results[i]?.result ?? '0x')
      if (bal === 0n) return
      const amount = Number(bal) / Math.pow(10, t.decimals)
      if (amount < 0.001) return
      // mTBILL/mBASIS price ≈ $1 (T-bill backed)
      const amountUSD = amount
      positions.push({
        protocol: 'Midas', type: 'vault', logo: '🏛️',
        url: 'https://midas.app', chain: 'Monad',
        label: t.symbol === 'mTBILL' ? 'Tokenized US T-Bills' : 'Basis Trading Strategy',
        asset: t.symbol, amount, amountUSD, apy: t.apy, netValueUSD: amountUSD,
      })
    })
    return positions
  } catch { return [] }
}

// ─── PNL calculation helper ──────────────────────────────────────────────────
// PNL for lending = netValueUSD vs deposited (hard to get without historical, expose as null)
// PNL for vaults = amountUSD - cost basis (only if entry data available from the protocol API)
// We attach pnl: null by default; protocols that return cost basis can populate it

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const [monPriceR] = await Promise.allSettled([getMonPrice()])
  const MON_PRICE = monPriceR.status === 'fulfilled' ? (monPriceR.value as number) : 0

  const [nevR, morphoR, uniR, pcakeR, curveR, gearR, upshiftR, kintsuR, magmaR, shmonadR, lagoonR, renzoR, kuruR, curvanceR, eulerR, midasR] =
    await Promise.allSettled([
      fetchNeverland(address),
      fetchMorpho(address),
      fetchUniswapV3(address, 'Uniswap V3',   UNI_NFT_PM, UNI_FACTORY),
      fetchUniswapV3(address, 'PancakeSwap V3', '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364', '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'),
      fetchCurve(address),
      fetchGearbox(address),
      fetchUpshift(address),
      fetchKintsu(address, MON_PRICE),
      fetchMagma(address, MON_PRICE),
      fetchShMonad(address, MON_PRICE),
      fetchLagoon(address),
      fetchRenzo(address),
      fetchKuru(address),
      fetchCurvance(address),
      fetchEulerV2(address),
      fetchMidas(address),
    ])

  function unwrap(r: PromiseSettledResult<any[]>): any[] {
    return r.status === 'fulfilled' ? r.value : []
  }

  const allPositions = [
    ...unwrap(nevR), ...unwrap(morphoR), ...unwrap(uniR), ...unwrap(pcakeR),
    ...unwrap(curveR), ...unwrap(gearR), ...unwrap(upshiftR),
    ...unwrap(kintsuR), ...unwrap(magmaR), ...unwrap(shmonadR),
    ...unwrap(lagoonR), ...unwrap(renzoR), ...unwrap(kuruR),
    ...unwrap(curvanceR), ...unwrap(eulerR), ...unwrap(midasR),
  ]

  const totalNetValueUSD = allPositions.reduce((s, p) => s + (p.netValueUSD ?? 0), 0)
  const totalDebtUSD     = allPositions.reduce((s, p) => s + (p.totalDebtUSD ?? 0), 0)
  const totalSupplyUSD   = allPositions.reduce((s, p) => s + (p.totalCollateralUSD ?? p.amountUSD ?? 0), 0)
  const activeProtocols  = [...new Set(allPositions.map(p => p.protocol))]

  return NextResponse.json({
    positions: allPositions,
    summary: { totalNetValueUSD, totalDebtUSD, totalSupplyUSD, netValueUSD: totalNetValueUSD, activeProtocols, monPrice: MON_PRICE },
  })
}
