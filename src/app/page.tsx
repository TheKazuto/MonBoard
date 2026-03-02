'use client'

import TopTokens from '@/components/TopTokens'
import RecentActivity from '@/components/RecentActivity'
import FearAndGreed from '@/components/FearAndGreed'
import TokenExposure from '@/components/TokenExposure'
import PortfolioHistory from '@/components/PortfolioHistory'
import AdBanner from '@/components/AdBanner'
import { usePortfolio } from '@/contexts/PortfolioContext'
import { useWallet }    from '@/contexts/WalletContext'
import { usePreferences } from '@/contexts/PreferencesContext'
import { SORA } from '@/lib/styles'
import {
  RefreshCw, Wallet, Image,
  Zap, ChevronRight, Bell,
} from 'lucide-react'

// ─── Wallet Summary hero ──────────────────────────────────────────────────────
function WalletSummary() {
  const { totals, status, lastUpdated, refresh } = usePortfolio()
  const { isConnected } = useWallet()
  const { fmtValue } = usePreferences()

  const isLoading = status === 'loading'
  const isPartial = status === 'partial'
  const hasData   = isConnected && (status === 'partial' || status === 'done')

  // Skeleton shimmer for a number slot
  const Shimmer = ({ w = 'w-28' }: { w?: string }) => (
    <div className={`${w} h-5 rounded-md bg-white/20 animate-pulse`} />
  )

  return (
    <div className="card p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #836EF9 0%, #6d28d9 100%)' }}>

      {/* Decorative blobs */}
      <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, white, transparent)', transform: 'translate(30%, -40%)' }} />
      <div className="absolute bottom-0 left-20 w-40 h-40 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, white, transparent)', transform: 'translate(0, 40%)' }} />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-violet-200 text-sm font-medium mb-1">Total Portfolio Value</p>

            {/* Main value */}
            {!isConnected ? (
              <h2 className="text-white font-display text-4xl font-bold" style={SORA}>
                —
              </h2>
            ) : isLoading ? (
              <div className="w-48 h-10 rounded-lg bg-white/20 animate-pulse mt-1" />
            ) : (
              <h2 className="text-white font-display text-4xl font-bold" style={SORA}>
                {fmtValue(totals.totalValueUSD)}
              </h2>
            )}

            {/* Wallet connected label */}
            {!isConnected && (
              <p className="text-violet-300 text-sm mt-2">Connect your wallet to see your portfolio</p>
            )}

            {/* Last updated */}
            {hasData && lastUpdated && (
              <p className="text-violet-300 text-xs mt-2">
                Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                {isPartial && <span className="ml-1 animate-pulse">· loading…</span>}
              </p>
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={refresh}
            disabled={!isConnected || isLoading}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white disabled:opacity-40 disabled:cursor-not-allowed"
            title="Refresh portfolio"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Three breakdown pills */}
        <div className="flex gap-6 pt-4 border-t border-white/20">

          {/* Token Assets */}
          <div>
            <div className="flex items-center gap-1.5 text-violet-200 text-xs mb-1">
              <Wallet size={12} />
              Token Assets
            </div>
            {!isConnected ? (
              <p className="text-white font-semibold text-lg">—</p>
            ) : isLoading ? (
              <Shimmer />
            ) : (
              <p className="text-white font-semibold text-lg">{fmtValue(totals.tokenValueUSD)}</p>
            )}
          </div>

          {/* NFT Value */}
          <div>
            <div className="flex items-center gap-1.5 text-violet-200 text-xs mb-1">
              <Image size={12} />
              NFT Value
            </div>
            {!isConnected ? (
              <p className="text-white font-semibold text-lg">—</p>
            ) : isLoading ? (
              <Shimmer />
            ) : (
              <p className="text-white font-semibold text-lg">{fmtValue(totals.nftValueUSD)}</p>
            )}
          </div>

          {/* DeFi Positions */}
          <div>
            <div className="flex items-center gap-1.5 text-violet-200 text-xs mb-1">
              <Zap size={12} />
              DeFi Positions
            </div>
            {!isConnected ? (
              <p className="text-white font-semibold text-lg">—</p>
            ) : isLoading ? (
              <Shimmer />
            ) : (
              <p className="text-white font-semibold text-lg">{fmtValue(totals.defiNetValueUSD)}</p>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── DeFi Positions helpers (outside component — stable references) ─────────
function typeLabel(type: string): string {
  if (type === 'lending')   return 'Lending'
  if (type === 'vault')     return 'Vault'
  if (type === 'liquidity') return 'Liquidity'
  return type
}

function getApy(pos: any): number | null {
  if (pos.apy != null && pos.apy > 0)  return pos.apy
  if (pos.supply?.[0]?.apy != null)    return pos.supply[0].apy
  return null
}

// ─── DeFi Positions widget (dashboard mini preview — top 3) ──────────────────
// Reads defiPositions directly from PortfolioContext — no extra API call needed.
function DeFiPositions() {
  const { totals, status, refresh } = usePortfolio()
  const { isConnected }             = useWallet()
  const { fmtValue }                = usePreferences()

  const loading = status === 'loading'
  const all     = totals.defiPositions
  const top3    = [...all]
    .filter(p => (p.netValueUSD ?? 0) > 0)
    .sort((a, b) => (b.netValueUSD ?? 0) - (a.netValueUSD ?? 0))
    .slice(0, 3)
  const total = all.reduce((s, p) => s + (p.netValueUSD ?? 0), 0)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800" style={SORA}>
          DeFi Positions
        </h3>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button
              onClick={refresh}
              disabled={loading}
              className="p-1 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-40"
              title="Refresh DeFi positions"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-violet-400' : ''} />
            </button>
          )}
          <a href="/defi" className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-0.5">
            See all <ChevronRight size={12} />
          </a>
        </div>
      </div>

      {/* Not connected */}
      {!isConnected && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <Zap size={18} className="text-violet-400" />
          </div>
          <p className="text-sm text-gray-400">Connect your wallet to see DeFi positions</p>
        </div>
      )}

      {/* Loading skeletons */}
      {isConnected && loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 animate-pulse" />
                  <div className="space-y-1">
                    <div className="w-24 h-3 bg-gray-100 rounded animate-pulse" />
                    <div className="w-16 h-2.5 bg-gray-50 rounded animate-pulse" />
                  </div>
                </div>
                <div className="space-y-1 items-end flex flex-col">
                  <div className="w-16 h-3 bg-gray-100 rounded animate-pulse" />
                  <div className="w-12 h-2.5 bg-gray-50 rounded animate-pulse" />
                </div>
              </div>
              <div className="progress-bar"><div className="progress-fill animate-pulse" style={{ width: '60%' }} /></div>
            </div>
          ))}
        </div>
      )}

      {/* No positions found */}
      {isConnected && !loading && top3.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <p className="text-sm text-gray-400">No DeFi positions found</p>
          <p className="text-xs text-gray-300">Your active positions will appear here</p>
        </div>
      )}

      {/* Top 3 real positions */}
      {isConnected && !loading && top3.length > 0 && (
        <div className="space-y-4">
          {top3.map((pos, i) => {
            const value      = pos.netValueUSD ?? 0
            const apy        = getApy(pos)
            const percentage = total > 0 ? (value / total) * 100 : 0
            const label      = pos.label ?? pos.asset ?? ''

            return (
              <div key={`${pos.protocol}-${i}`} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{pos.logo}</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{pos.protocol}</p>
                      <p className="text-xs text-gray-400">
                        {typeLabel(pos.type)}
                        {label ? ` · ${label}` : ''}
                        {apy != null ? ` · ${apy.toFixed(1)}% APY` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-800">{fmtValue(value)}</p>
                    {apy != null && apy > 0 && (
                      <p className="text-xs text-emerald-600 font-medium">+{apy.toFixed(1)}% APY</p>
                    )}
                  </div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.min(percentage, 100)}%` }} />
                </div>
                <p className="text-xs text-gray-400 text-right">{percentage.toFixed(1)}% of DeFi</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── NFT Gating Banner ────────────────────────────────────────────────────────
function NFTGatingBanner() {
  return (
    <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-purple-50 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shrink-0">
        <Bell size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-900">Unlock Telegram Alerts</p>
        <p className="text-xs text-violet-600 mt-0.5">
          Soon you will be able to receive real-time wallet alerts via Telegram and monitor other wallets.
        </p>
      </div>
      <button className="shrink-0 btn-primary text-xs px-4 py-2">Coming soon</button>
    </div>
  )
}

// ─── Sponsors Banner ──────────────────────────────────────────────────────────
function SponsorsBanner() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-gray-800 text-sm" style={SORA}>
          Partners & Sponsors
        </h3>
        <a href="https://forms.gle/2tqw8FWy1JD2Rd4s6" target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600">Become a partner →</a>
      </div>
      <div className="flex items-center justify-center gap-8 py-6 border border-dashed border-violet-200 rounded-xl">
        <p className="text-sm text-gray-400 font-medium">Advertise your project here</p>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <NFTGatingBanner />

      {/* Hero Row: Wallet Summary + Recent Activity */}
      {/* Left col is flex-col so AdBanner stretches to fill the gap below WalletSummary */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:items-stretch">
        <div className="lg:col-span-3 flex flex-col gap-5">
          <WalletSummary />
          <AdBanner className="flex-1 rounded-xl" />
        </div>
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
      </div>

      {/* Middle Row: Token Allocation + DeFi Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TokenExposure />
        <DeFiPositions />
      </div>

      {/* Portfolio History Chart */}
      <PortfolioHistory />

      {/* Bottom Row: Top Tokens + Fear & Greed + Ad */}
      {/* Right col is flex-col so AdBanner stretches to fill space below Fear & Greed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:items-stretch">
        <div className="lg:col-span-2"><TopTokens /></div>
        <div className="lg:col-span-1 flex flex-col gap-5">
          <FearAndGreed />
          <AdBanner className="flex-1 rounded-xl" />
        </div>
      </div>

      <SponsorsBanner />
    </div>
  )
}
