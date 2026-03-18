'use client'

import { useEffect, useState } from 'react'
import { cachedFetch } from '@/lib/dataCache'
import { useWallet } from '@/contexts/WalletContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { RefreshCw, Wallet } from 'lucide-react'
import { SORA } from '@/lib/styles'

interface TokenData {
  symbol: string
  name: string
  balance: number
  price: number
  value: number
  color: string
  percentage: number
}

interface ApiResponse {
  tokens: TokenData[]
  totalValue: number
  address: string
}

function formatValue(v: number) {
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(4)}`
}

function formatBalance(b: number, symbol: string) {
  if (b >= 1000) return `${b.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}`
  if (b >= 1) return `${b.toFixed(4)} ${symbol}`
  return `${b.toFixed(6)} ${symbol}`
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as TokenData
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 mb-0.5">{d.symbol}</p>
      <p className="text-gray-500">{formatValue(d.value)}</p>
      <p className="text-gray-400">{d.percentage.toFixed(1)}%</p>
    </div>
  )
}

export default function TokenExposure() {
  const { address, stableAddress, isConnected } = useWallet()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function fetchTokens(force = false) {
    if (!stableAddress) return
    setLoading(true)
    setError(false)
    try {
      const json = await cachedFetch<ApiResponse>('/api/token-exposure', stableAddress, force)
      if ((json as any).error) throw new Error((json as any).error)
      setData(json)
      setLastUpdated(new Date())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (stableAddress) {
      fetchTokens()
    } else {
      setData(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableAddress])

  // ── Not connected ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-4" style={SORA}>
          Token Exposure
        </h3>
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center">
            <Wallet size={22} className="text-violet-400" />
          </div>
          <p className="text-sm text-gray-400">Connect your wallet to see your token breakdown</p>
        </div>
      </div>
    )
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-4" style={SORA}>
          Token Exposure
        </h3>
        <div className="flex flex-col sm:flex-row items-center gap-4 animate-pulse">
          <div className="w-48 h-48 rounded-full bg-gray-100 shrink-0" />
          <div className="flex-1 space-y-3 w-full">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                <div className="w-12 h-3 bg-gray-100 rounded" />
                <div className="flex-1 h-2 bg-gray-100 rounded-full" />
                <div className="w-8 h-3 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-4" style={SORA}>
          Token Exposure
        </h3>
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
          <p className="text-sm text-red-400">Failed to load balances</p>
          <button
            onClick={() => fetchTokens(true)}
            className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      </div>
    )
  }

  // ── Empty wallet ─────────────────────────────────────────────────────────────
  if (data && data.tokens.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-4" style={SORA}>
          Token Exposure
        </h3>
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <p className="text-sm text-gray-400">No tokens found in this wallet</p>
          <p className="text-xs text-gray-300">Your token portfolio will appear here</p>
        </div>
      </div>
    )
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  const tokens = data?.tokens ?? []

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800" style={SORA}>
            Token Exposure
          </h3>
          {data && (
            <p className="text-xs text-gray-400 mt-0.5">
              Total: <span className="font-medium text-gray-600">{formatValue(data.totalValue)}</span>
            </p>
          )}
        </div>
        <button
          onClick={() => fetchTokens(true)}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Pie chart */}
        <div className="w-44 h-44 shrink-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={tokens}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={78}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {tokens.map((token, i) => (
                  <Cell key={token.symbol} fill={token.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-gray-400">Total</span>
            <span className="text-sm font-bold text-gray-700">
              {data ? formatValue(data.totalValue) : '—'}
            </span>
          </div>
        </div>

        {/* Token list */}
        <div className="flex-1 space-y-2.5 w-full">
          {tokens.map((token) => (
            <div key={token.symbol}>
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: token.color }}
                />
                <span className="text-sm font-semibold text-gray-700 w-12 shrink-0">
                  {token.symbol}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(token.percentage, 1)}%`,
                        background: token.color,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0 w-20">
                  <span className="text-xs font-medium text-gray-600">
                    {formatValue(token.value)}
                  </span>
                  <span className="text-xs text-gray-400 ml-1">
                    ({token.percentage.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400 pl-[18px]">
                {formatBalance(token.balance, token.symbol)}
                {token.price > 0 && (
                  <span className="ml-1 text-gray-300">@ ${token.price < 0.01 ? token.price.toFixed(4) : token.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {lastUpdated && (
        <p className="text-xs text-gray-300 text-right mt-3">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}
