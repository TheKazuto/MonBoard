/**
 * lib/aprCache.ts
 *
 * Shared in-memory APR cache — populated by best-aprs/route.ts,
 * consumed by defi/route.ts without any HTTP self-call.
 *
 * Flow:
 *   best-aprs GET  →  fetchAllData()  →  setAprCache(entries)
 *   defi      GET  →  getAprEntries() → warm? inject APRs : apy: 0 (next call will be warm)
 *
 * The cache is warmed the first time someone visits the Best APRs page.
 * On Cloudflare Pages, both routes share the same Worker isolate, so the
 * module-level cache is shared between them at zero cost.
 */

export interface AprCacheEntry {
  protocol: string
  tokens:   string[]
  label:    string
  apr:      number
}

const TTL = 4 * 60 * 1000  // 4 min — slightly longer than best-aprs own 3-min cache

let cache: { entries: AprCacheEntry[]; ts: number } | null = null

/** Called by best-aprs/route.ts after building the full entry list. */
export function setAprCache(entries: AprCacheEntry[]): void {
  cache = { entries, ts: Date.now() }
}

/**
 * Returns cached entries if fresh, null if cold/stale.
 * defi/route.ts falls back to apy: 0 when null — positions still show,
 * APRs appear once best-aprs has been called at least once.
 */
export function getAprEntries(): AprCacheEntry[] | null {
  if (!cache) return null
  if (Date.now() - cache.ts > TTL) return null
  return cache.entries
}
