'use client'
import { cachedFetch } from '@/lib/dataCache'

/**
 * PortfolioContext — single source of truth for portfolio totals.
 *
 * Fires 3 API calls in parallel the moment a wallet is connected.
 * Components read cached totals without re-fetching on page navigation.
 *
 * Key fixes:
 * - Debounce address/connection changes (wagmi can flicker on navigation)
 * - Never reset to ZERO while data is already loaded for the same address
 * - Cache by address — navigating back doesn't re-fetch if data is fresh (<5min)
 */

import {
  createContext, useContext, useState,
  useEffect, useCallback, useRef, ReactNode,
} from 'react'
import { useWallet } from './WalletContext'

// ─── Raw data types (shared with portfolio page) ─────────────────────────────
export interface TokenData {
  symbol: string; name: string; balance: number
  price: number; value: number; color: string; percentage: number
  imageUrl?: string
}
export interface NFTData {
  id: string; contract: string; tokenId: string
  collection: string; symbol: string; name: string
  image: string | null; floorMON: number; floorUSD: number
  openSeaUrl: string  // was magicEdenUrl — migrated to OpenSea
}

export interface PortfolioTotals {
  tokenValueUSD:       number
  nftValueUSD:         number
  defiNetValueUSD:     number
  totalValueUSD:       number
  defiActiveProtocols: string[]
  defiTotalDebtUSD:    number
  defiTotalSupplyUSD:  number
  defiPositions:       any[]        // raw positions array — consumed by DeFiPositions widget
  tokens:              TokenData[]  // full token list — consumed by portfolio page
  nfts:                NFTData[]    // full NFT list   — consumed by portfolio page
  nftTotal:            number       // total NFT count (may exceed nfts.length if >50)
  nftsNoKey:           boolean      // true when OpenSea API key is missing
}

export type LoadStatus = 'idle' | 'loading' | 'partial' | 'done' | 'error'

interface PortfolioContextValue {
  totals:      PortfolioTotals
  status:      LoadStatus
  lastUpdated: Date | null
  refresh:     () => void
  defiLoaded:  boolean  // true once defi positions have loaded at least once for current address
}

const ZERO: PortfolioTotals = {
  tokenValueUSD:       0,
  nftValueUSD:         0,
  defiNetValueUSD:     0,
  totalValueUSD:       0,
  defiActiveProtocols: [],
  defiTotalDebtUSD:    0,
  defiTotalSupplyUSD:  0,
  defiPositions:       [],
  tokens:              [],
  nfts:                [],
  nftTotal:            0,
  nftsNoKey:           false,
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  totals:    PortfolioTotals
  fetchedAt: number
}

// Module-level cache — survives React re-renders and page navigation
const portfolioCache = new Map<string, CacheEntry>()

const PortfolioCtx = createContext<PortfolioContextValue>({
  totals:        ZERO,
  status:        'idle',
  lastUpdated:   null,
  refresh:       () => {},
  defiLoaded:    false,
})

export function usePortfolio() {
  return useContext(PortfolioCtx)
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { stableAddress: address, isConnected } = useWallet()

  const [totals,      setTotals]      = useState<PortfolioTotals>(ZERO)
  const [status,      setStatus]      = useState<LoadStatus>('idle')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Refs for parallel fetch accumulation
  const tokenRef      = useRef(0)
  const nftRef        = useRef(0)
  const defiRef       = useRef<Partial<PortfolioTotals> & { defiPositions?: any[] }>({})
  const tokenListRef  = useRef<TokenData[]>([])
  const nftListRef    = useRef<NFTData[]>([])
  const nftTotalRef   = useRef(0)
  const nftsNoKeyRef  = useRef(false)
  const loadingAddr   = useRef<string | null>(null)
  const lastAddr      = useRef<string | null>(null)  // track last loaded address
  const defiLoadedRef = useRef<string | null>(null)  // address for which defi has loaded

  const flush = useCallback((addr: string, final = false) => {
    const key = addr.toLowerCase()
    const t = tokenRef.current
    const n = nftRef.current
    const d = defiRef.current.defiNetValueUSD ?? 0

    // Protect defiPositions: never overwrite a non-empty list with an empty one.
    // This prevents a partial flush (e.g. tokens arriving before defi) from
    // caching an empty defiPositions and making positions disappear on navigation.
    const prevCached      = portfolioCache.get(key)
    const newPositions    = defiRef.current.defiPositions ?? []
    const prevPositions   = prevCached?.totals.defiPositions ?? []

    // Per-protocol preservation: always preserve protocols seen this session.
    // If a protocol returns [] it could be a failure OR a genuine close.
    // We can't tell the difference — so we keep previously-seen positions until:
    //   a) the same protocol returns a NON-EMPTY result (proves it's alive, old data stale)
    //   b) the user reloads the page (portfolioCache resets to empty)
    // This avoids positions disappearing after the 5-min cache window expires.
    let safePositions: any[]
    if (newPositions.length === 0) {
      // Full failure — keep everything from cache
      safePositions = prevPositions
    } else if (prevPositions.length > 0) {
      // Merge: keep new positions + preserve any protocol missing from new result
      const newProtos = new Set(newPositions.map((p: any) => p.protocol))
      const preserved = prevPositions.filter((p: any) => !newProtos.has(p.protocol))
      safePositions   = preserved.length > 0 ? [...newPositions, ...preserved] : newPositions
    } else {
      safePositions = newPositions
    }

    const next: PortfolioTotals = {
      tokenValueUSD:       t,
      nftValueUSD:         n,
      defiNetValueUSD:     d,
      totalValueUSD:       t + n + d,
      defiActiveProtocols: defiRef.current.defiActiveProtocols?.length
        ? defiRef.current.defiActiveProtocols
        : (prevCached?.totals.defiActiveProtocols ?? []),
      defiTotalDebtUSD:    defiRef.current.defiTotalDebtUSD    ?? 0,
      defiTotalSupplyUSD:  defiRef.current.defiTotalSupplyUSD  ?? 0,
      defiPositions:       safePositions,
      tokens:              tokenListRef.current,
      nfts:                nftListRef.current,
      nftTotal:            nftTotalRef.current,
      nftsNoKey:           nftsNoKeyRef.current,
    }
    setTotals(next)

    // Write to cache on final flush OR whenever we have defi positions.
    // Only advance fetchedAt if the new result is at least as complete as before —
    // this prevents a partial fetch result from being stamped as "fresh" and
    // suppressing re-fetches when protocols are intermittently missing.
    if (final || safePositions.length > 0) {
      const resultComplete = prevPositions.length === 0 || newPositions.length >= prevPositions.length
      const newFetchedAt   = final && resultComplete ? Date.now() : (prevCached?.fetchedAt ?? Date.now())
      portfolioCache.set(key, { totals: next, fetchedAt: newFetchedAt })
    }
  }, [])

  const load = useCallback(async (addr: string, force = false) => {
    const key   = addr.toLowerCase()
    const entry = portfolioCache.get(key)

    // Serve from cache if fresh and not forced
    if (!force && entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
      setTotals(entry.totals)
      setStatus('done')
      setLastUpdated(new Date(entry.fetchedAt))
      // Mark defi as loaded for this address so the DeFi page doesn't
      // show loading state when restoring from cache on navigation
      if (entry.totals.defiPositions.length > 0) {
        defiLoadedRef.current = key
      }
      return
    }

    // Already loading this address — don't double-fetch
    if (loadingAddr.current === key) return
    loadingAddr.current = key
    lastAddr.current    = key
    // Keep defiLoadedRef set during re-fetch if we already have defi data
    // This prevents isLoading from hiding existing positions during background refresh

    // Seed from cache while re-fetching so UI doesn't flash empty
    if (entry) {
      tokenRef.current     = entry.totals.tokenValueUSD
      nftRef.current       = entry.totals.nftValueUSD
      tokenListRef.current = entry.totals.tokens
      nftListRef.current   = entry.totals.nfts
      nftTotalRef.current  = entry.totals.nftTotal
      nftsNoKeyRef.current = entry.totals.nftsNoKey
      defiRef.current  = {
        defiNetValueUSD:     entry.totals.defiNetValueUSD,
        defiTotalDebtUSD:    entry.totals.defiTotalDebtUSD,
        defiTotalSupplyUSD:  entry.totals.defiTotalSupplyUSD,
        defiActiveProtocols: entry.totals.defiActiveProtocols,
        defiPositions:       entry.totals.defiPositions,
      }
      setTotals(entry.totals)
    } else {
      tokenRef.current     = 0
      nftRef.current       = 0
      tokenListRef.current = []
      nftListRef.current   = []
      nftTotalRef.current  = 0
      nftsNoKeyRef.current = false
      defiRef.current      = {}
    }

    setStatus('loading')

    const fetchTokens = async () => {
      try {
        const data = await cachedFetch<any>('/api/token-exposure', addr)
        if (loadingAddr.current !== key) return // stale
        tokenRef.current     = Number(data.totalValue ?? 0)
        tokenListRef.current = Array.isArray(data.tokens) ? data.tokens : []
        flush(addr)
        setStatus(s => s === 'loading' ? 'partial' : s)
      } catch { /* keeps previous value */ }
    }

    const fetchNFTs = async () => {
      try {
        const data = await cachedFetch<any>('/api/nfts', addr)
        if (loadingAddr.current !== key) return
        if (data.error === 'no_api_key') {
          nftsNoKeyRef.current = true
          flush(addr)
          return
        }
        nftRef.current       = Number(data.nftValue ?? 0)
        nftListRef.current   = Array.isArray(data.nfts) ? data.nfts : []
        nftTotalRef.current  = Number(data.total ?? 0)
        nftsNoKeyRef.current = false
        flush(addr)
        setStatus(s => s === 'loading' ? 'partial' : s)
      } catch { /* keeps previous value */ }
    }

    const fetchDefi = async () => {
      try {
        // Use cachedFetch — fast on navigation (serves dataCache).
        // safePositions guard in flush() prevents empty overwrites.
        const data = await cachedFetch<any>('/api/defi', addr)
        if (loadingAddr.current !== key) return
        const s    = data.summary ?? {}
        defiRef.current = {
          defiNetValueUSD:     Number(s.netValueUSD     ?? 0),
          defiTotalDebtUSD:    Number(s.totalDebtUSD    ?? 0),
          defiTotalSupplyUSD:  Number(s.totalSupplyUSD  ?? 0),
          defiActiveProtocols: Array.isArray(s.activeProtocols) ? s.activeProtocols : [],
          defiPositions:       Array.isArray(data.positions) ? data.positions : [],
        }
        defiLoadedRef.current = key  // mark defi as loaded for this address
        flush(addr)
        setStatus(s2 => s2 === 'loading' ? 'partial' : s2)
      } catch { /* keeps previous value */ }
    }

    await Promise.allSettled([fetchTokens(), fetchNFTs(), fetchDefi()])

    if (loadingAddr.current === key) {
      flush(addr, true)  // final=true — write complete data to cache
      setStatus('done')
      setLastUpdated(new Date())
      loadingAddr.current = null
    }
  }, [flush])

  // Navigation guard — prevents positions from disappearing when wagmi briefly
  // loses connection during page navigation (~100-300ms flicker).
  // Strategy: use a ref to track the last known good address and restore from
  // cache immediately instead of resetting to ZERO.
  const stableAddrRef = useRef<string | null>(null)

  useEffect(() => {
    // When address is available, always keep stableAddrRef up to date
    if (address) stableAddrRef.current = address.toLowerCase()
  }, [address])

  useEffect(() => {
    if (!isConnected || !address) {
      // Wagmi temporarily lost connection (navigation flicker).
      // Find the last known address — prefer stableAddrRef, then lastAddr.
      // If both are null (provider just re-mounted), scan portfolioCache for any entry.
      const knownAddr = stableAddrRef.current
        ?? lastAddr.current
        ?? (() => {
          // Fallback: find any cached address with defi positions
          for (const [addr, entry] of portfolioCache.entries()) {
            if (entry.totals.defiPositions.length > 0) return addr
          }
          return null
        })()

      if (knownAddr) {
        const cached = portfolioCache.get(knownAddr)
        if (cached) {
          // Restore cached state immediately so UI never goes blank
          setTotals(cached.totals)
          setStatus('done')
          if (cached.totals.defiPositions.length > 0) {
            defiLoadedRef.current = knownAddr
            stableAddrRef.current = knownAddr  // re-seed ref so next disconnect works too
          }
          return
        }
        // Has an address but no cache yet and already loading — just wait
        if (loadingAddr.current !== null) return
      }
      // Genuinely disconnected with no data — reset
      setTotals(ZERO)
      setStatus('idle')
      setLastUpdated(null)
      return
    }

    const key = address.toLowerCase()

    // ── Immediate cache restore (zero delay) ──────────────────────────────
    // When React re-renders after navigation, state resets to ZERO.
    // Restore from portfolioCache synchronously — before the debounce fires —
    // so positions are shown immediately without a 200ms blank flash.
    const existing = portfolioCache.get(key)
    if (existing) {
      setTotals(existing.totals)
      setStatus(Date.now() - existing.fetchedAt < CACHE_TTL_MS ? 'done' : 'loading')
      if (existing.totals.defiPositions.length > 0) {
        defiLoadedRef.current = key
      }
      // If cache is still fresh, no need to re-fetch — bail early
      if (Date.now() - existing.fetchedAt < CACHE_TTL_MS) return
    }

    // ── Debounced load (absorbs wagmi reconnect flicker) ──────────────────
    const timer = setTimeout(() => load(address), 200)
    return () => clearTimeout(timer)
  }, [address, isConnected, load])

  const refresh = useCallback(() => {
    if (address && isConnected) {
      loadingAddr.current = null // allow re-fetch
      load(address, true)        // force bypass cache
    }
  }, [address, isConnected, load])

  const defiLoaded = defiLoadedRef.current === (address?.toLowerCase() ?? null)

  return (
    <PortfolioCtx.Provider value={{ totals, status, lastUpdated, refresh, defiLoaded }}>
      {children}
    </PortfolioCtx.Provider>
  )
}
