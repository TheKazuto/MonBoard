'use client'

// Fix #12: TokenExposure now reads from PortfolioContext instead of making an
// independent cachedFetch('/api/token-exposure'). Both calls resolve from the
// same 5-min client cache anyway, so this removes redundant state machinery and
// ensures the widget always shows data consistent with the rest of the dashboard.

import { useWallet } from '@/contexts/WalletContext'
import { usePortfolio } from '@/contexts/PortfolioContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { RefreshCw, Wallet } from 'lucide-react'
import { SORA } from '@/lib/styles'
import type { TokenData } from '@/contexts/PortfolioContext'

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
  const { isConnected } = useWallet()
  const { totals, status, lastUpdated, refresh } = usePortfolio()

  const loading = status === 'loading' || status === 'partial'
  const tokens  = totals.tokens
  const totalValue = totals.tokenValueUSD

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
  if (tokens.length === 0 && loading) {
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
  if (status === 'error' && tokens.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-4" style={SORA}>
          Token Exposure
        </h3>
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
          <p className="text-sm text-red-400">Failed to load balances</p>
          <button
            onClick={refresh}
            className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      </div>
    )
  }

  // ── Empty wallet ─────────────────────────────────────────────────────────────
  if (tokens.length === 0) {
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
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800" style={SORA}>
            Token Exposure
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Total: <span className="font-medium text-gray-600">{formatValue(totalValue)}</span>
          </p>
        </div>
        <button
          onClick={refresh}
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
                {tokens.map((token) => (
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
              {formatValue(totalValue)}
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
