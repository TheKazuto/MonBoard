'use client'

import { useState, useEffect, useCallback } from 'react'

interface MonadPrice {
  price:        number
  change24h:    number
  changeAmount: number
  loading:      boolean
  error:        boolean
  lastUpdated:  Date | null
}

// Default interval aligned with priceCache TTL (5 minutes).
// The server-side cache refreshes every 5 min — polling faster than that
// just returns the same cached value and wastes Worker CPU + KV reads.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export function useMonadPrice(refreshInterval = DEFAULT_INTERVAL_MS): MonadPrice {
  const [data, setData] = useState<MonadPrice>({
    price:        0,
    change24h:    0,
    changeAmount: 0,
    loading:      true,
    error:        false,
    lastUpdated:  null,
  })

  const fetchPrice = useCallback(async () => {
    try {
      // Calls our own Next.js API route — server handles CoinGecko and caches the result
      const res = await fetch('/api/mon-price')
      if (!res.ok) throw new Error(`/api/mon-price ${res.status}`)

      const json = await res.json()
      if (json.error) throw new Error(json.error)

      setData({
        price:        json.price,
        change24h:    json.change24h,
        changeAmount: json.changeAmount,
        loading:      false,
        error:        false,
        lastUpdated:  new Date(),
      })
    } catch {
      setData(prev => ({ ...prev, loading: false, error: true }))
    }
  }, [])

  useEffect(() => {
    fetchPrice()
    const interval = setInterval(fetchPrice, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchPrice, refreshInterval])

  return data
}
