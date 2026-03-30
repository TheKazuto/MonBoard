'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, ExternalLink, TrendingUp, Zap, Layers, BookOpen, Coins } from 'lucide-react'
import { SORA } from '@/lib/styles'
import AdBanner from '@/components/AdBanner'
// Fix #13: import AprEntry from shared types — eliminates duplication with api/best-aprs/route.ts
import type { AprEntry } from '@/types/apr'

// ─── Auto-refresh interval ────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

// ─── APR badge ────────────────────────────────────────────────────────────────
function AprBadge({ apr }: { apr: number }) {
  const color =
    apr >= 20 ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark-badge-white' :
    apr >= 10 ? 'bg-violet-100 text-violet-700 border-violet-200 dark-badge-white' :
    apr >= 5  ? 'bg-blue-100   text-blue-700   border-blue-200   dark-badge-white' :
                'bg-gray-100   text-gray-600   border-gray-200'

  return (
    <span className={`text-sm font-bold px-3 py-1 rounded-full border ${color}`} style={SORA}>
      {apr.toFixed(2)}% APR
    </span>
  )
}

// ─── Token pills ──────────────────────────────────────────────────────────────
function TokenPills({ tokens }: { tokens: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map(t => (
        <span key={t} className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">
          {t}
        </span>
      ))}
    </div>
  )
}

// ─── Type badge (pool / lend / vault) ────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  pool:  { label: 'Pool',  color: 'bg-blue-50   text-blue-600   border-blue-100'   },
  lend:  { label: 'Lend',  color: 'bg-amber-50  text-amber-600  border-amber-100'  },
  vault: { label: 'Vault', color: 'bg-violet-50 text-violet-600 border-violet-100' },
}
function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? { label: type, color: 'bg-gray-50 text-gray-500 border-gray-100' }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

// ─── Single APR card ──────────────────────────────────────────────────────────
function AprCard({ entry, rank, showType = false }: { entry: AprEntry; rank: number; showType?: boolean }) {
  return (
    <div className="card p-4 flex items-center gap-4 hover:shadow-md transition-all duration-200">
      {/* Rank */}
      <div className="w-7 h-7 rounded-full bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-violet-500" style={SORA}>{rank}</span>
      </div>

      {/* Logo + Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          {entry.logo.startsWith('http') || entry.logo.startsWith('/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.logo} alt={entry.protocol} width={20} height={20} className="rounded-md object-contain" />
          ) : (
            <span className="text-base">{entry.logo}</span>
          )}
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{entry.protocol}</span>
          {showType && <TypeBadge type={entry.type} />}
        </div>
        <p className="text-sm font-semibold text-gray-800 truncate mb-1.5" style={SORA}>{entry.label}</p>
        <div className="flex items-center gap-2">
          <TokenPills tokens={entry.tokens} />
          {entry.tvl > 0 && (
            <span className="text-xs text-gray-400 font-medium">
              TVL ${entry.tvl >= 1_000_000
                ? `${(entry.tvl / 1_000_000).toFixed(1)}M`
                : entry.tvl >= 1_000
                  ? `${(entry.tvl / 1_000).toFixed(0)}K`
                  : entry.tvl.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* APR + Link */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        <AprBadge apr={entry.apr} />
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors px-3 py-1.5 rounded-lg border border-violet-200 hover:bg-violet-50"
        >
          Go to protocol <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

// ─── Section skeleton ─────────────────────────────────────────────────────────
function SectionSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 flex items-center gap-4 animate-pulse">
          <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-gray-100 rounded w-1/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="h-5 bg-gray-50 rounded w-24" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="h-7 bg-gray-100 rounded-full w-28" />
            <div className="h-8 bg-gray-50 rounded-lg w-28" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, count, accent }: {
  icon: React.ReactNode
  title: string
  count: number
  accent: string
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div>
        <h2 className="text-base font-bold text-gray-800" style={SORA}>{title}</h2>
        <p className="text-xs text-gray-400">{count} positions</p>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function Empty({ label }: { label: string }) {
  return (
    <div className="card p-10 text-center text-gray-400">
      <TrendingUp size={28} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">No {label} data available right now</p>
      <p className="text-xs mt-1 opacity-70">Data is fetched live from protocol APIs</p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
interface AprData {
  stableAPRs:   AprEntry[]
  pools:        AprEntry[]
  vaults:       AprEntry[]
  lends:        AprEntry[]
  lastUpdated:  number
  totalEntries: number
}


export default function BestAprsPage() {
  const [data,       setData]       = useState<AprData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [countdown,  setCountdown]  = useState(REFRESH_INTERVAL_MS / 1000)
  const lastFetchRef = useRef<number>(Date.now())
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/best-aprs', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json.pools || json.vaults || json.lends || json.stableAPRs) {
          setData({
            stableAPRs:   json.stableAPRs   ?? [],
            pools:        json.pools         ?? [],
            vaults:       json.vaults        ?? [],
            lends:        json.lends         ?? [],
            lastUpdated:  json.lastUpdated   ?? Date.now(),
            totalEntries: json.totalEntries  ?? 0,
          })
        }
        setLastLoaded(new Date())
        lastFetchRef.current = Date.now()
        setCountdown(REFRESH_INTERVAL_MS / 1000)
      }
    } catch {
      // keeps previous data on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastFetchRef.current
      const remaining = Math.max(0, Math.round((REFRESH_INTERVAL_MS - elapsed) / 1000))
      setCountdown(remaining)
      if (remaining === 0) fetchData()
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-bold text-2xl text-gray-900" style={SORA}>Best APRs</h1>
          <p className="text-gray-500 text-sm mt-1">
            Top yield opportunities across the Monad ecosystem
            {lastLoaded && (
              <span className="ml-2 text-gray-400">· Updated {lastLoaded.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && (
            <span className="text-xs text-gray-400">
              Refreshing in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 btn-primary text-xs px-4 py-2 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {data && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Stablecoins', value: data.stableAPRs.length, icon: '🏦', best: data.stableAPRs[0]?.apr },
            { label: 'Pools',       value: data.pools.length,       icon: '🌊', best: data.pools[0]?.apr       },
            { label: 'Vaults',      value: data.vaults.length,      icon: '🔒', best: data.vaults[0]?.apr      },
            { label: 'Lend',        value: data.lends.length,       icon: '📊', best: data.lends[0]?.apr       },
          ].map(stat => (
            <div key={stat.label} className="card p-4 text-center">
              <div className="text-xl mb-1">{stat.icon}</div>
              <div className="text-xs text-gray-400 font-medium">{stat.label}</div>
              {stat.best ? (
                <div className="text-sm font-bold text-emerald-600 mt-1" style={SORA}>
                  Best: {stat.best.toFixed(2)}%
                </div>
              ) : (
                <div className="text-sm text-gray-300 mt-1">—</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Grid of sections ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── LEFT COLUMN: Stablecoin + AdsTerra banner ── */}
        <div className="flex flex-col gap-6">
          {/* ── 1. Trending Stable APR ── */}
          <div className="card p-5">
            <SectionHeader
              icon={<Coins size={18} className="text-emerald-600" />}
              title="Trending Stablecoin"
              count={data?.stableAPRs.length ?? 0}
              accent="bg-emerald-50"
            />
            {loading
              ? <SectionSkeleton count={5} />
              : data?.stableAPRs.length
                ? <div className="space-y-3">
                    {data.stableAPRs.map((e, i) => <AprCard key={`stable-${i}`} entry={e} rank={i + 1} showType />)}
                  </div>
                : <Empty label="stable" />
            }
          </div>

          {/* ── AdsTerra banner slot ── */}
          <AdBanner className="flex-1 min-h-[250px]" />
        </div>

        {/* ── RIGHT COLUMN: Trending Pools ── */}
        <div className="card p-5">
          <SectionHeader
            icon={<Layers size={18} className="text-blue-600" />}
            title="Trending Pools"
            count={data?.pools.length ?? 0}
            accent="bg-blue-50"
          />
          {loading
            ? <SectionSkeleton count={5} />
            : data?.pools.length
              ? <div className="space-y-3">
                  {data.pools.map((e, i) => <AprCard key={`pool-${i}`} entry={e} rank={i + 1} />)}
                </div>
              : <Empty label="pools" />
          }
        </div>

        {/* ── 3. Trending Vaults ── */}
        <div className="card p-5">
          <SectionHeader
            icon={<Zap size={18} className="text-violet-600" />}
            title="Trending Vaults"
            count={data?.vaults.length ?? 0}
            accent="bg-violet-50"
          />
          {loading
            ? <SectionSkeleton count={5} />
            : data?.vaults.length
              ? <div className="space-y-3">
                  {data.vaults.map((e, i) => <AprCard key={`vault-${i}`} entry={e} rank={i + 1} />)}
                </div>
              : <Empty label="vaults" />
          }
        </div>

        {/* ── 4. Trending Lend ── */}
        <div className="card p-5">
          <SectionHeader
            icon={<BookOpen size={18} className="text-amber-600" />}
            title="Trending Lend"
            count={data?.lends.length ?? 0}
            accent="bg-amber-50"
          />
          {loading
            ? <SectionSkeleton count={5} />
            : data?.lends.length
              ? <div className="space-y-3">
                  {data.lends.map((e, i) => <AprCard key={`lend-${i}`} entry={e} rank={i + 1} />)}
                </div>
              : <Empty label="lend" />
          }
        </div>
      </div>

      {/* ── Footer note ── */}
      <p className="text-center text-xs text-gray-300 mt-8">
        APR data is fetched live from protocol APIs and on-chain sources. Rates change in real-time. Not financial advice.
      </p>
    </div>
  )
}
