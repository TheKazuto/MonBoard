import { NextRequest, NextResponse } from 'next/server'
import { MONAD_RPC as RPC, rpcBatch, getMonPrice } from '@/lib/monad'

export const revalidate = 0

// ─── Security: SSRF protection for metadata fetching ─────────────────────────
// Block fetches to private/internal IP ranges and non-HTTPS protocols.
// A strict host allowlist was too restrictive (NFTs use hundreds of CDNs).
// These two checks cover the actual attack surface.

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc00:|fd)/

function isSafeMetaUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false           // HTTPS only — blocks file:, data:, javascript:, http:
    if (PRIVATE_IP_RE.test(u.hostname)) return false    // block internal IPs
    if (u.hostname === 'localhost' || u.hostname.endsWith('.local')) return false
    return true
  } catch { return false }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function padUint256(n: bigint) { return n.toString(16).padStart(64, '0') }
function decodeString(hex: string): string {
  try {
    if (!hex || hex === '0x') return ''
    const b = Buffer.from(hex.slice(2), 'hex')
    if (b.length < 64) return ''
    const len = Number(BigInt('0x' + b.slice(32, 64).toString('hex')))
    return b.slice(64, 64 + len).toString('utf8').replace(/\0/g, '')
  } catch { return '' }
}
function resolveURI(uri: string): string {
  if (!uri) return ''
  return uri.startsWith('ipfs://') ? uri.replace('ipfs://', 'https://ipfs.io/ipfs/') : uri
}

// Security: sanitize image URL before sending to client (fix #13)
// Only allow HTTPS URLs — blocks javascript:, data:, file:, http:
function sanitizeImage(raw: string | null | undefined): string | null {
  if (!raw) return null
  const resolved = resolveURI(String(raw))
  return isSafeMetaUrl(resolved) ? resolved : null
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────
async function discoverNFTs(address: string, apiKey: string) {
  // Security fix #5: use URL object so the API key is set via searchParams,
  // not interpolated into a template string (avoids accidental log exposure).
  const url = new URL('https://api.etherscan.io/v2/api')
  url.searchParams.set('chainid', '143')
  url.searchParams.set('module',  'account')
  url.searchParams.set('action',  'tokennfttx')
  url.searchParams.set('address', address)
  url.searchParams.set('page',    '1')
  url.searchParams.set('offset',  '100')
  url.searchParams.set('sort',    'desc')
  url.searchParams.set('apikey',  apiKey)

  const res  = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  const data = await res.json()
  if (data.status !== '1') {
    if (data.message?.includes('No transactions') || data.message?.includes('No records')) return []
    throw new Error(`Etherscan: ${data.message}`)
  }
  const addrLower = address.toLowerCase()
  const lastTx    = new Map<string, any>()
  for (const tx of data.result as any[]) {
    const key = `${tx.contractAddress.toLowerCase()}_${BigInt(tx.tokenID)}`
    if (!lastTx.has(key)) lastTx.set(key, tx)
  }
  return [...lastTx.values()]
    .filter(tx => tx.to?.toLowerCase() === addrLower)
    .map(tx => ({ contract: tx.contractAddress.toLowerCase(), tokenId: BigInt(tx.tokenID) }))
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
async function verifyOwnership(candidates: { contract: string; tokenId: bigint }[], address: string) {
  const calls = candidates.map((c, i) => ({
    jsonrpc: '2.0', method: 'eth_call',
    params: [{ to: c.contract, data: '0x6352211e' + padUint256(c.tokenId) }, 'latest'],
    id: i,
  }))
  const results: any[] = []
  for (let i = 0; i < calls.length; i += 20)
    results.push(...await rpcBatch(calls.slice(i, i + 20)))
  const lo = address.toLowerCase()
  return candidates.filter((_, i) => {
    const r = results[i]?.result
    return r && r.length >= 26 && ('0x' + r.slice(-40)).toLowerCase() === lo
  })
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
async function fetchOnChainMeta(owned: { contract: string; tokenId: bigint }[]) {
  const contracts = [...new Set(owned.map(t => t.contract))]
  const [nameRes, symRes, uriRes] = await Promise.all([
    rpcBatch(contracts.map((a, i) => ({ jsonrpc:'2.0', method:'eth_call', params:[{to:a,data:'0x06fdde03'},'latest'], id:i }))),
    rpcBatch(contracts.map((a, i) => ({ jsonrpc:'2.0', method:'eth_call', params:[{to:a,data:'0x95d89b41'},'latest'], id:i }))),
    rpcBatch(owned.map(({ contract, tokenId }, i) => ({ jsonrpc:'2.0', method:'eth_call', params:[{to:contract,data:'0xc87b56dd'+padUint256(tokenId)},'latest'], id:i }))),
  ])
  const cMeta: Record<string, { name: string; symbol: string }> = {}
  contracts.forEach((a, i) => {
    cMeta[a] = { name: decodeString(nameRes[i]?.result ?? ''), symbol: decodeString(symRes[i]?.result ?? '') }
  })
  return { cMeta, uriRes }
}

async function fetchTokenMeta(uri: string) {
  try {
    const url = resolveURI(uri)
    // Security: only fetch metadata from HTTPS, non-private URLs
    if (!isSafeMetaUrl(url)) return null
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

// ─── Step 4: Floor prices via Magic Eden ─────────────────────────────────────
async function fetchFloorPrices(
  _address: string,
  contracts: string[]
): Promise<Record<string, number>> {
  const floorMap: Record<string, number> = {}
  contracts.forEach(c => { floorMap[c] = 0 })

  await Promise.allSettled(contracts.map(async (contract) => {
    try {
      const url = `https://api-mainnet.magiceden.dev/v4/evm-public/assets/collection-assets?chain=monad&collectionId=${contract}&limit=1`
      const r = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      })
      if (!r.ok) return
      const body = await r.json()
      const items: any[] = body?.assets ?? []
      if (!items.length) return
      // floorAsk is at the item wrapper level, not inside item.asset
      const floorAsk = items[0]?.floorAsk
      const floor = Number(floorAsk?.price?.amount?.native ?? 0)
      if (floor > 0) floorMap[contract] = floor
    } catch { /* ignore per-collection errors */ }
  }))

  return floorMap
}

// ─── Main route ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const apiKey = process.env.ETHERSCAN_API_KEY
  // Keep the original 'no_api_key' error — PortfolioContext checks for this exact string
  if (!apiKey) return NextResponse.json({ error: 'no_api_key', nfts: [], nftValue: 0, total: 0 })

  try {
    const candidates = await discoverNFTs(address, apiKey)
    if (!candidates.length) return NextResponse.json({ nfts: [], nftValue: 0, total: 0 })

    const owned = await verifyOwnership(candidates, address)
    if (!owned.length) return NextResponse.json({ nfts: [], nftValue: 0, total: 0 })

    const cap   = owned.slice(0, 20)
    const total = owned.length
    const { cMeta, uriRes } = await fetchOnChainMeta(cap)
    const contracts = [...new Set(cap.map(t => t.contract))]

    const [metaResults, floorMap, monPrice] = await Promise.all([
      Promise.all(cap.map((_, i) => fetchTokenMeta(decodeString(uriRes[i]?.result ?? '')))),
      fetchFloorPrices(address, contracts),
      getMonPrice(),
    ])

    const nfts = cap.map(({ contract, tokenId }, i) => {
      const cm         = cMeta[contract] ?? { name: '', symbol: '' }
      const meta       = metaResults[i]
      const floorMON   = floorMap[contract] ?? 0
      const floorUSD   = floorMON * monPrice
      const collection = cm.name || cm.symbol || `${contract.slice(0, 6)}...${contract.slice(-4)}`
      return {
        id:           `${contract}_${tokenId}`,
        contract,
        tokenId:      tokenId.toString(),
        collection,
        symbol:       cm.symbol,
        name:         meta?.name ?? `${collection} #${tokenId}`,
        // Security fix #13: sanitize image URL before sending to client
        image:        sanitizeImage(meta?.image),
        floorMON,
        floorUSD,
        magicEdenUrl: `https://magiceden.io/collections/monad/${contract}`,
      }
    })

    const nftValue = nfts.reduce((s, n) => s + n.floorUSD, 0)
    return NextResponse.json({ nfts, nftValue, total })

  } catch (err: any) {
    console.error('[nfts]', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 })
  }
}
