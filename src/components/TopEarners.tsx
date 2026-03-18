'use client'

import { useState, useEffect } from 'react'
import { SORA } from '@/lib/styles'
import { fmtTokenPrice } from '@/lib/format'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface Gainer {
  symbol: string
  name: string
  address: string
  priceUsd: number
  change24h: number
  volume24h: number
  imageUrl: string | null
}

const CACHE_TTL = 3 * 60 * 1000
let cached: { data: Gainer[]; ts: number } | null = null

function formatChange(c: number): string {
  const sign = c >= 0 ? '+' : ''
  return `${sign}${c.toFixed(2)}%`
}

// Generate a color from symbol string for the fallback avatar
function symbolColor(sym: string): string {
  let hash = 0
  for (const ch of sym) hash = ch.charCodeAt(0) + ((hash << 5) - hash)
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 55%, 50%)`
}

export default function TopEarners() {
  const [gainers, setGainers] = useState<Gainer[]>(() => cached?.data ?? [])
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    async function load() {
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setGainers(cached.data)
        setLoading(false)
        return
      }
      try {
        const res = await fetch('/api/top-gainers')
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          cached = { data, ts: Date.now() }
          setGainers(data)
        }
      } catch { /* keep existing */ }
      finally { setLoading(false) }
    }
    load()
  }, [])

  // Split into two columns
  const left  = gainers.slice(0, 5)
  const right = gainers.slice(5, 10)

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-semibold text-gray-800" style={SORA}>
          Top Earners in the Ecosystem
        </h3>
        <p className="text-xs text-gray-400">24 hours</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gray-50">
              <div className="w-8 h-8 rounded-full skeleton" />
              <div className="flex-1 space-y-1.5">
                <div className="w-16 h-3 skeleton" />
                <div className="w-12 h-2.5 skeleton" />
              </div>
              <div className="w-14 h-3 skeleton" />
            </div>
          ))}
        </div>
      ) : gainers.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No data available</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0">
          {/* Left column */}
          <div className="space-y-0 divide-y divide-gray-50">
            {left.map((t, i) => (
              <TokenRow key={t.address} token={t} rank={i + 1} />
            ))}
          </div>
          {/* Right column */}
          <div className="space-y-0 divide-y divide-gray-50">
            {right.map((t, i) => (
              <TokenRow key={t.address} token={t} rank={i + 6} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TokenRow({ token, rank }: { token: Gainer; rank: number }) {
  const isPositive = token.change24h >= 0

  return (
    <a
      href={`https://www.geckoterminal.com/monad/tokens/${token.address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 py-2.5 px-1 rounded-lg hover:bg-gray-50 transition-colors group"
    >
      {/* Rank */}
      <span className="text-xs font-bold text-gray-300 w-4 text-center">{rank}</span>

      {/* Token avatar */}
      {token.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.imageUrl} alt={token.symbol} width={28} height={28} className="rounded-full object-cover" />
      ) : (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ background: symbolColor(token.symbol) }}
        >
          {token.symbol.slice(0, 2)}
        </div>
      )}

      {/* Name + Price */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark-token-name truncate group-hover:text-violet-600 transition-colors">
          {token.symbol}
        </p>
        <p className="text-xs text-gray-400">{fmtTokenPrice(token.priceUsd)}</p>
      </div>

      {/* 24h change badge */}
      <div className={`flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-md ${
        isPositive
          ? 'text-emerald-600 bg-emerald-50'
          : 'text-red-500 bg-red-50'
      }`}>
        {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {formatChange(token.change24h)}
      </div>
    </a>
  )
}
