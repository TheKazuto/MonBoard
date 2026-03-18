/**
 * serverCache.ts — cache genérico para respostas de API routes.
 *
 * Cache em duas camadas:
 *   L1 — In-memory por isolate (0ms, reseta em cold starts)
 *   L2 — Cloudflare Workers KV (global, sobrevive a cold starts)
 *
 * Usado por: /api/top-tokens, /api/exchange-rates, /api/portfolio-history
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'

// Interface mínima do KV binding — evita dependência do tipo global KVNamespace
// que não está disponível durante o build do Next.js
interface KVStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface CacheEntry<T> {
  data:      T
  fetchedAt: number
  promise:   Promise<T> | null
}

// ─── L1 — In-memory ───────────────────────────────────────────────────────────
const store = new Map<string, CacheEntry<any>>()

// ─── L2 — Cloudflare Workers KV ──────────────────────────────────────────────

function getKV(): KVStore | null {
  try {
    const ctx = getCloudflareContext()
    const kv  = (ctx?.env as any)?.PRICE_KV
    if (kv && typeof kv.get === 'function') return kv as KVStore
    return null
  } catch {
    // Fora do contexto de request (ex: build time) — silencioso
    return null
  }
}

async function kvGet<T>(key: string): Promise<{ data: T; fetchedAt: number } | null> {
  const kv = getKV()
  if (!kv) return null
  try {
    const raw = await kv.get(`cache:${key}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function kvSet<T>(key: string, value: T, fetchedAt: number, ttlMs: number): Promise<void> {
  const kv = getKV()
  if (!kv) return
  try {
    const ttlSec = Math.max(60, Math.floor(ttlMs / 1000))
    await kv.put(`cache:${key}`, JSON.stringify({ data: value, fetchedAt }), { expirationTtl: ttlSec })
  } catch (err) {
    console.error(`[serverCache] KV write failed for "${key}":`, err)
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Get-or-fetch com cache em 2 camadas.
 *
 * @param key     Chave única (ex: 'top-tokens', 'price-history:monad:30')
 * @param fetcher Função async que produz o dado fresco
 * @param ttlMs   TTL em milissegundos
 */
export async function cached<T>(
  key:     string,
  fetcher: () => Promise<T>,
  ttlMs:   number,
): Promise<T> {
  const entry = store.get(key) as CacheEntry<T> | undefined
  const now   = Date.now()

  // ── L1: in-memory fresco ──────────────────────────────────────────────────
  if (entry && !entry.promise && now - entry.fetchedAt < ttlMs) {
    return entry.data
  }

  // ── Deduplicação de requests em voo ──────────────────────────────────────
  if (entry?.promise) {
    return entry.promise
  }

  const promise: Promise<T> = (async () => {
    // ── L2: KV ───────────────────────────────────────────────────────────
    const kvEntry = await kvGet<T>(key)
    if (kvEntry && now - kvEntry.fetchedAt < ttlMs) {
      store.set(key, { data: kvEntry.data, fetchedAt: kvEntry.fetchedAt, promise: null })
      return kvEntry.data
    }

    // ── Miss total: executa fetcher ───────────────────────────────────────
    const data      = await fetcher()
    const fetchedAt = Date.now()
    store.set(key, { data, fetchedAt, promise: null })
    await kvSet(key, data, fetchedAt, ttlMs)
    return data
  })()

  store.set(key, {
    data:      entry?.data ?? (null as any),
    fetchedAt: entry?.fetchedAt ?? 0,
    promise,
  })

  try {
    return await promise
  } catch (err) {
    const current = store.get(key)
    if (current) store.set(key, { ...current, promise: null })
    if (entry?.data != null) return entry.data
    throw err
  }
}
