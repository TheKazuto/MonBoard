/**
 * priceCache.ts — cache unificado de preços CoinGecko.
 *
 * Cache em duas camadas:
 *   L1 — In-memory por isolate (0ms, reseta em cold starts)
 *   L2 — Cloudflare Workers KV (global, sobrevive a cold starts)
 *
 * Fluxo: L1 fresco → KV fresco → CoinGecko → grava KV + L1
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'

// Interface mínima do KV binding — evita dependência do tipo global KVNamespace
// que não está disponível durante o build do Next.js
interface KVStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

// ─── Master coin list ─────────────────────────────────────────────────────────
export const ALL_COIN_IDS = [
  'monad',           // MON / WMON / sMON / gMON / shMON / aprMON
  'usd-coin',        // USDC
  'ethereum',        // ETH / WETH
  'tether',          // USDT / USDT0
  'wrapped-bitcoin', // WBTC
  'agora-dollar',    // AUSD
] as const

export type CoinId = typeof ALL_COIN_IDS[number]

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface PriceData {
  prices:    Record<string, number>
  images:    Record<string, string>
  change24h: Record<string, number>
  fetchedAt: number
}

// ─── Fallback hardcoded (CoinGecko indisponível) ──────────────────────────────
const FALLBACK: PriceData = {
  prices: {
    'monad':           0.02,
    'usd-coin':        1.00,
    'ethereum':        2300,
    'tether':          1.00,
    'wrapped-bitcoin': 85000,
    'agora-dollar':    1.00,
  },
  images:    {},
  change24h: {},
  fetchedAt: 0,
}

// ─── TTLs ─────────────────────────────────────────────────────────────────────
const TTL_MS  = 5 * 60 * 1000  // 5 min em ms  (comparação com Date.now())
const TTL_SEC = 5 * 60         // 5 min em seg  (KV expirationTtl usa segundos)

// ─── L1 — In-memory ───────────────────────────────────────────────────────────
let memCache:     PriceData | null = null
let fetchPromise: Promise<PriceData> | null = null

// ─── L2 — Cloudflare Workers KV ──────────────────────────────────────────────
const KV_KEY = 'prices:all'

function getKV(): KVStore | null {
  try {
    const ctx = getCloudflareContext()
    const kv  = (ctx?.env as any)?.PRICE_KV
    if (kv && typeof kv.get === 'function') return kv as KVStore
    return null
  } catch {
    // getCloudflareContext lança fora de um request ativo (ex: build time)
    return null
  }
}

async function readFromKV(kv: KVStore): Promise<PriceData | null> {
  try {
    const raw = await kv.get(KV_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PriceData
    if (!data.prices || typeof data.fetchedAt !== 'number') return null
    return data
  } catch {
    return null
  }
}

async function writeToKV(kv: KVStore, data: PriceData): Promise<void> {
  try {
    await kv.put(KV_KEY, JSON.stringify(data), { expirationTtl: TTL_SEC })
  } catch (err) {
    console.error('[priceCache] KV write failed:', err)
  }
}

// ─── Fetch CoinGecko ──────────────────────────────────────────────────────────
async function fetchFromCoinGecko(): Promise<PriceData> {
  const apiKey  = process.env.COINGECKO_API_KEY
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey

  const ids = ALL_COIN_IDS.join(',')
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?ids=${ids}&vs_currency=usd&per_page=20&price_change_percentage=24h`,
    { headers, cache: 'no-store', signal: AbortSignal.timeout(8_000) }
  )
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)

  const coins: any[] = await res.json()
  const prices:    Record<string, number> = {}
  const images:    Record<string, string> = {}
  const change24h: Record<string, number> = {}

  for (const coin of coins) {
    if (!coin.id) continue
    prices[coin.id]    = Math.max(0, coin.current_price               ?? 0)
    change24h[coin.id] = coin.price_change_percentage_24h ?? 0
    if (coin.image) images[coin.id] = coin.image
  }

  return { prices, images, change24h, fetchedAt: Date.now() }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna preços, imagens e variação 24h de todos os tokens do projeto.
 * Hierarquia: L1 in-memory (0ms) → L2 KV (~10ms) → CoinGecko (~300ms)
 */
export async function getAllPrices(): Promise<PriceData> {
  const now = Date.now()

  // ── L1: in-memory fresco ──────────────────────────────────────────────────
  if (memCache && now - memCache.fetchedAt < TTL_MS) return memCache

  // ── Deduplicação: apenas um fetch simultâneo por isolate ──────────────────
  if (fetchPromise) {
    try { return await fetchPromise } catch { /* segue para fallback */ }
  }

  fetchPromise = (async (): Promise<PriceData> => {
    const kv = getKV()

    // ── L2: KV (compartilhado entre isolates/regiões) ─────────────────────
    if (kv) {
      const kvData = await readFromKV(kv)
      if (kvData && now - kvData.fetchedAt < TTL_MS) {
        memCache = kvData
        return kvData
      }
    }

    // ── Miss total: busca na CoinGecko ────────────────────────────────────
    const fresh = await fetchFromCoinGecko()
    memCache = fresh
    if (kv) await writeToKV(kv, fresh)
    return fresh
  })()

  try {
    const result = await fetchPromise
    fetchPromise = null
    return result
  } catch (err) {
    fetchPromise = null
    if (memCache) return memCache
    console.error('[priceCache] falha total, usando fallback hardcoded:', err)
    return FALLBACK
  }
}

/**
 * Preço MON + variação 24h. Usado por /api/mon-price.
 */
export async function getMonPriceData(): Promise<{
  price:        number
  change24h:    number
  changeAmount: number
}> {
  const data  = await getAllPrices()
  const price = data.prices['monad'] ?? FALLBACK.prices['monad']!
  const chg   = data.change24h['monad'] ?? 0
  return {
    price,
    change24h:    chg,
    changeAmount: price - price / (1 + chg / 100),
  }
}

/**
 * Apenas o preço MON em USD.
 * Drop-in replacement para o antigo getMonPrice() de lib/monad.ts.
 */
export async function getMonPrice(): Promise<number> {
  const data = await getAllPrices()
  return data.prices['monad'] ?? FALLBACK.prices['monad']!
}
