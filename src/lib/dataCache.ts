/**
 * dataCache — module-level cache for API responses.
 * Lives outside React, survives page navigation, component unmount/remount.
 * TTL: 5 minutes per entry per address.
 */

const TTL = 5 * 60 * 1000

interface Entry<T> {
  data:      T
  fetchedAt: number
  promise:   Promise<T> | null  // in-flight dedup
}

const store = new Map<string, Entry<any>>()

function key(endpoint: string, address: string) {
  return `${endpoint}::${address.toLowerCase()}`
}

export async function cachedFetch<T>(
  endpoint: string,
  address: string,
  force = false,
): Promise<T> {
  // Fix #17 (BAIXO): Validate address format before use in URL construction.
  // Previously, a malformed address could produce unexpected query parameters
  // via special characters like &, =, or ?.
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`cachedFetch: invalid Ethereum address: ${address}`)
  }

  const k     = key(endpoint, address)
  const entry = store.get(k)
  const now   = Date.now()

  // Return cached data if fresh
  if (!force && entry && !entry.promise && now - entry.fetchedAt < TTL) {
    return entry.data as T
  }

  // Deduplicate in-flight requests
  if (entry?.promise) {
    return entry.promise as Promise<T>
  }

  // Fire new request
  const sep = endpoint.includes('?') ? '&' : '?'
  // Fix #17: encodeURIComponent ensures the address cannot inject extra query params
  const promise = fetch(`${endpoint}${sep}address=${encodeURIComponent(address)}`)
    .then(r => r.json())
    .then(data => {
      store.set(k, { data, fetchedAt: Date.now(), promise: null })
      return data as T
    })
    .catch(err => {
      // On error, clear the promise so next call retries
      const existing = store.get(k)
      if (existing) store.set(k, { ...existing, promise: null })
      throw err
    })

  store.set(k, {
    data:      entry?.data ?? null,
    fetchedAt: entry?.fetchedAt ?? 0,
    promise,
  })

  return promise
}

export function getCached<T>(endpoint: string, address: string): T | null {
  const entry = store.get(key(endpoint, address))
  return (entry && !entry.promise) ? entry.data as T : null
}

export function invalidate(endpoint: string, address: string) {
  store.delete(key(endpoint, address))
}

export function invalidateAll(address: string) {
  for (const k of store.keys()) {
    if (k.endsWith(`::${address.toLowerCase()}`)) store.delete(k)
  }
}
