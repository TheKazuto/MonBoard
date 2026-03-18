import { NextRequest, NextResponse } from 'next/server'
import { getMonPrice } from '@/lib/monad'

export const revalidate = 0

// ─── Security: SSRF protection for metadata fetching ─────────────────────────
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc00:|fd)/

// Fix #7 (MÉDIO): Extended blocklist to include cloud metadata endpoints.
// A malicious NFT metadata_url pointing to these would allow SSRF attacks
// against cloud provider instance metadata services.
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
  '169.254.169.254',   // AWS/Azure/GCP link-local metadata
  'instance-data',     // EC2 legacy metadata hostname
])

function isSafeMetaUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (PRIVATE_IP_RE.test(u.hostname)) return false
    if (u.hostname === 'localhost' || u.hostname.endsWith('.local')) return false
    // Block cloud metadata endpoints by hostname
    if (BLOCKED_HOSTNAMES.has(u.hostname)) return false
    // Block any subdomain of known metadata hosts
    for (const blocked of BLOCKED_HOSTNAMES) {
      if (u.hostname.endsWith('.' + blocked)) return false
    }
    return true
  } catch { return false }
}

function resolveURI(uri: string): string {
  if (!uri) return ''
  return uri.startsWith('ipfs://') ? uri.replace('ipfs://', 'https://ipfs.io/ipfs/') : uri
}

function sanitizeImage(raw: string | null | undefined): string | null {
  if (!raw) return null
  const resolved = resolveURI(String(raw))
  return isSafeMetaUrl(resolved) ? resolved : null
}

// ─── OpenSea API helpers ──────────────────────────────────────────────────────
// Chain identifier used by OpenSea for Monad mainnet
const OS_CHAIN = 'monad'
const OS_BASE  = 'https://api.opensea.io/api/v2'

function osHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'Accept':    'application/json',
  }
}

// ─── Step 1: Fetch NFTs owned by account via OpenSea ─────────────────────────
// Replaces: Etherscan tokennfttx discovery + on-chain ownerOf verification +
//           on-chain tokenURI + off-chain metadata fetch.
// OpenSea returns name, image, collection slug, contract, tokenId in one call.

interface OSNft {
  identifier:   string   // token id (string)
  collection:   string   // collection slug
  contract:     string   // contract address (lowercase)
  name:         string | null
  image_url:    string | null
  metadata_url: string | null
}

async function fetchNFTsFromOpenSea(
  address: string,
  apiKey:  string,
): Promise<OSNft[]> {
  const all: OSNft[] = []
  let next: string | null = null
  const limit = 50

  // Paginate up to 200 NFTs (4 pages) to avoid very long responses
  for (let page = 0; page < 4; page++) {
    const url = new URL(`${OS_BASE}/chain/${OS_CHAIN}/account/${address}/nfts`)
    url.searchParams.set('limit', String(limit))
    if (next) url.searchParams.set('next', next)

    const res = await fetch(url.toString(), {
      headers: osHeaders(apiKey),
      signal:  AbortSignal.timeout(12_000),
      cache:   'no-store',
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('opensea_invalid_key')
      }
      if (res.status === 404) break // chain/address not found = no NFTs
      throw new Error(`OpenSea error ${res.status}`)
    }

    const data = await res.json()
    const nfts: any[] = data?.nfts ?? []
    for (const n of nfts) {
      all.push({
        identifier:   String(n.identifier ?? ''),
        collection:   String(n.collection ?? ''),
        contract:     String(n.contract   ?? '').toLowerCase(),
        name:         n.name         ?? null,
        image_url:    n.image_url    ?? null,
        metadata_url: n.metadata_url ?? null,
      })
    }

    next = data?.next ?? null
    if (!next || nfts.length < limit) break
  }

  return all
}

// ─── Step 2: Floor prices via OpenSea collection stats ───────────────────────
// GET /api/v2/collections/{slug}/stats
// Returns total.floor_price (in native token = MON on Monad).

async function fetchFloorPrices(
  slugs:  string[],
  apiKey: string,
): Promise<Record<string, number>> {
  const floorMap: Record<string, number> = {}

  await Promise.allSettled(
    [...new Set(slugs)].filter(Boolean).map(async (slug) => {
      try {
        const res = await fetch(`${OS_BASE}/collections/${slug}/stats`, {
          headers: osHeaders(apiKey),
          signal:  AbortSignal.timeout(8_000),
          cache:   'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        // total.floor_price is in the native token of the chain (MON for Monad)
        const floor = Number(data?.total?.floor_price ?? 0)
        if (floor > 0) floorMap[slug] = floor
      } catch { /* skip per-collection errors */ }
    })
  )

  return floorMap
}

// ─── Main route ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const apiKey = process.env.OPENSEA_API_KEY
  // Keep same 'no_api_key' error string — PortfolioContext checks for it
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key', nfts: [], nftValue: 0, total: 0 })
  }

  try {
    // ── 1. Fetch all owned NFTs from OpenSea ─────────────────────────────────
    const osNfts = await fetchNFTsFromOpenSea(address, apiKey)
    if (!osNfts.length) {
      return NextResponse.json({ nfts: [], nftValue: 0, total: 0 })
    }

    const total = osNfts.length
    const cap   = osNfts.slice(0, 50) // display cap

    // ── 2. Collect unique slugs for floor price lookup ────────────────────────
    const slugs = [...new Set(cap.map(n => n.collection).filter(Boolean))]

    // ── 3. Fetch floor prices + MON price in parallel ─────────────────────────
    const [floorMap, monPrice] = await Promise.all([
      fetchFloorPrices(slugs, apiKey),
      getMonPrice(),
    ])

    // ── 4. Assemble response ──────────────────────────────────────────────────
    const nfts = cap.map((n) => {
      const floorMON = floorMap[n.collection] ?? 0
      const floorUSD = floorMON * monPrice

      // Collection display name: use slug with dashes replaced by spaces, title-cased
      const collectionName = n.collection
        ? n.collection.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : `${n.contract.slice(0, 6)}…${n.contract.slice(-4)}`

      return {
        id:          `${n.contract}_${n.identifier}`,
        contract:    n.contract,
        tokenId:     n.identifier,
        collection:  collectionName,
        slug:        n.collection,
        name:        n.name ?? `${collectionName} #${n.identifier}`,
        image:       sanitizeImage(n.image_url),
        floorMON,
        floorUSD,
        openSeaUrl:  `https://opensea.io/assets/${OS_CHAIN}/${n.contract}/${n.identifier}`,
      }
    })

    const nftValue = nfts.reduce((s, n) => s + n.floorUSD, 0)
    return NextResponse.json({ nfts, nftValue, total })

  } catch (err: any) {
    // OpenSea invalid key — surface as no_api_key so UI shows correct message
    if (err?.message === 'opensea_invalid_key') {
      return NextResponse.json({ error: 'no_api_key', nfts: [], nftValue: 0, total: 0 })
    }
    console.error('[nfts]', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 })
  }
}
