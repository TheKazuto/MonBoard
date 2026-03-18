'use client'
import { cachedFetch, getCached } from '@/lib/dataCache'
import { SORA } from '@/lib/styles'
import { fmtUSD, fmtYAxis } from '@/lib/format'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useWallet }      from '@/contexts/WalletContext'
import { usePreferences } from '@/contexts/PreferencesContext'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, TrendingDown, RefreshCw, Wallet } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface HistoryPoint { date: string; value: number }
interface ApiResponse { history: HistoryPoint[]; totalValue: number; change: number }

type Range = '7d' | '30d' | '90d' | '1y'
const RANGES: { label: string; key: Range; days: number }[] = [
  { label: '7D',  key: '7d',  days: 7   },
  { label: '30D', key: '30d', days: 30  },
  { label: '90D', key: '90d', days: 90  },
  { label: '1Y',  key: '1y',  days: 365 },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDate(dateStr: string, range: Range) {
  const d = new Date(dateStr)
  if (range === '7d') return d.toLocaleDateString('en', { weekday: 'short' })
  if (range === '1y') return d.toLocaleDateString('en', { month: 'short' })
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function tickInterval(length: number, range: Range) {
  if (range === '7d')  return 1
  if (range === '30d') return Math.floor(length / 6)
  if (range === '90d') return Math.floor(length / 6)
  return Math.floor(length / 6)
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-400 mb-0.5">
        {new Date(label).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="font-bold text-violet-700">{fmtUSD(payload[0].value)}</p>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function Skeleton({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="card p-5 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-4 w-36 bg-gray-100 rounded mb-2" />
          <div className="h-3 w-24 bg-gray-100 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={!onRefresh}
            className="p-1 rounded-md text-gray-300 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            title="Refresh data"
          >
            <RefreshCw size={13} className="animate-spin text-violet-300" />
          </button>
          <div className="h-8 w-40 bg-gray-100 rounded-lg" />
        </div>
      </div>
      <div className="h-48 bg-gray-50 rounded-xl" />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PortfolioHistory() {
  const { address, stableAddress, isConnected } = useWallet()
  const { defaultRange } = usePreferences()
  const [range, setRange] = useState<Range>(defaultRange)
  // Sync range when the user changes their preferred default in Account settings
  const prevDefaultRange = useRef(defaultRange)
  useEffect(() => {
    if (defaultRange !== prevDefaultRange.current) {
      prevDefaultRange.current = defaultRange
      setRange(defaultRange)
    }
  }, [defaultRange])
  const [data, setData] = useState<Record<Range, ApiResponse | null>>({
    '7d': null, '30d': null, '90d': null, '1y': null,
  })
  const [loading, setLoading] = useState<Record<Range, boolean>>({
    '7d': false, '30d': false, '90d': false, '1y': false,
  })
  const [error, setError] = useState(false)

  async function fetchRange(r: Range, force = false) {
    if (!stableAddress) return
    const days = RANGES.find(x => x.key === r)!.days
    // Use cached if available and not forced
    const cacheKey = `/api/portfolio-history?days=${days}`
    if (!force) {
      const cached = getCached<ApiResponse>(cacheKey, stableAddress)
      if (cached) { setData(prev => ({ ...prev, [r]: cached })); return }
    }
    setLoading(prev => ({ ...prev, [r]: true }))
    setError(false)
    try {
      const json = await cachedFetch<ApiResponse>(cacheKey, stableAddress, force)
      if ((json as any).error) throw new Error((json as any).error)
      setData(prev => ({ ...prev, [r]: json }))
    } catch {
      setError(true)
    } finally {
      setLoading(prev => ({ ...prev, [r]: false }))
    }
  }

  // Fetch default range when wallet connects
  useEffect(() => {
    if (stableAddress) {
      fetchRange("30d")
    } else {
      setData({ '7d': null, '30d': null, '90d': null, '1y': null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableAddress])

  // Fetch on range change (lazy — only if not already fetched)
  // Uses stableAddress (not raw address) to avoid triggering during wagmi reconnect flicker
  useEffect(() => {
    if (isConnected && stableAddress && !data[range] && !loading[range]) {
      fetchRange(range)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800" style={SORA}>
          Token Portfolio History
        </h3>
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center">
            <Wallet size={22} className="text-violet-400" />
          </div>
          <p className="text-sm text-gray-400">Connect your wallet to view portfolio history</p>
        </div>
      </div>
    )
  }

  // ── Loading (first load) ────────────────────────────────────────────────────
  if (loading[range] && !data[range]) return <Skeleton onRefresh={() => fetchRange(range, true)} />

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error && !data[range]) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800" style={SORA}>Token Portfolio History</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchRange(range, true)}
              className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              title="Refresh data"
            >
              <RefreshCw size={13} />
            </button>
            <RangeSelector range={range} setRange={setRange} />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <p className="text-sm text-red-400">Failed to load portfolio history</p>
          <button
            onClick={() => fetchRange(range, true)}
            className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      </div>
    )
  }

  const current = data[range]
  const history = current?.history ?? []
  const isPositive = (current?.change ?? 0) >= 0
  const isLoading = loading[range]

  // ── Empty wallet ─────────────────────────────────────────────────────────────
  if (current && history.length === 0) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800" style={SORA}>Token Portfolio History</h3>
          <RangeSelector range={range} setRange={setRange} />
        </div>
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
          <p className="text-sm text-gray-400">No token holdings found in this wallet</p>
          <p className="text-xs text-gray-300">Add tokens to see your portfolio chart</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800" style={SORA}>
            Token Portfolio History
          </h3>
          {current && (
            <div className={`flex items-center gap-1 mt-0.5 text-sm ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              <span className="font-medium">
                {isPositive ? '+' : ''}{current.change.toFixed(2)}%
              </span>
              <span className="text-gray-400 text-xs">
                · {fmtUSD(current.totalValue)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchRange(range, true)}
            className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            title="Refresh data"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin text-violet-400' : ''} />
          </button>
          <RangeSelector range={range} setRange={setRange} />
        </div>
      </div>

      <div className={`h-48 transition-opacity duration-300 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#836EF9" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#836EF9" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f0ff" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatDate(v, range)}
              interval={tickInterval(history.length, range)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmtYAxis}
              width={52}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#836EF9"
              strokeWidth={2}
              fill="url(#portfolioGrad)"
              dot={false}
              activeDot={{ r: 4, fill: '#836EF9', strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-gray-300 mt-2 text-right">
        Based on current balances × historical prices
      </p>
    </div>
  )
}

// ─── Range selector ───────────────────────────────────────────────────────────
function RangeSelector({
  range, setRange,
}: {
  range: Range
  setRange: (r: Range) => void
}) {
  return (
    <div className="flex gap-1 bg-violet-50 rounded-lg p-1">
      {RANGES.map(r => (
        <button
          key={r.key}
          onClick={() => setRange(r.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
            range === r.key
              ? 'bg-white text-violet-700 shadow-sm'
              : 'text-gray-500 hover:text-violet-600'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
