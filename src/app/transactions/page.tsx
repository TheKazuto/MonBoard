'use client'

import { useState, useMemo, useRef } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import {
  Search, RefreshCw, ArrowDownLeft, ArrowUpRight,
  ArrowLeftRight, Zap, Image, ExternalLink, Wallet,
  Bell, Lock, Eye, Plus, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useTransactions, formatDate, formatTimeAgo, shortenAddr, Transaction } from '@/contexts/TransactionContext'
import { SORA } from '@/lib/styles'

// ─── Config ───────────────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; text: string; label: string }> = {
  receive:  { icon: <ArrowDownLeft size={15} />,  bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Received' },
  send:     { icon: <ArrowUpRight size={15} />,   bg: 'bg-red-50',     text: 'text-red-500',    label: 'Sent' },
  swap:     { icon: <ArrowLeftRight size={15} />, bg: 'bg-violet-50',  text: 'text-violet-600', label: 'Swap' },
  defi:     { icon: <Zap size={15} />,            bg: 'bg-amber-50',   text: 'text-amber-600',  label: 'DeFi' },
  nft:      { icon: <Image size={15} />,          bg: 'bg-blue-50',    text: 'text-blue-600',   label: 'NFT' },
  contract: { icon: <Zap size={15} />,            bg: 'bg-gray-50',    text: 'text-gray-500',   label: 'Contract' },
}

const FILTERS = ['All', 'Receive', 'Send', 'Swap', 'DeFi', 'NFT', 'Contract'] as const
type Filter = typeof FILTERS[number]
const PAGE_SIZE = 20

const watchedWallets = [
  { address: '0x1234...5678', label: 'Whale Watch', txCount: 142, lastTx: '5m ago' },
  { address: '0xabcd...ef01', label: 'Monad Team', txCount: 8, lastTx: '2h ago' },
]

// ─── Row ──────────────────────────────────────────────────────────────────────
function TxRow({ tx }: { tx: Transaction }) {
  const cfg = TYPE_CONFIG[tx.type] ?? TYPE_CONFIG.contract
  const valueNum = parseFloat(tx.valueNative)

  return (
    <a
      href={`https://monadscan.com/tx/${tx.hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-violet-50/60 transition-all group border-b border-gray-50 last:border-0"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-gray-800">
              {cfg.label}
              {tx.symbol && tx.symbol !== '?' && (
                <span className="font-normal text-gray-500 ml-1">{tx.symbol}</span>
              )}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-400">{formatDate(tx.timestamp)}</span>
              <span className="text-gray-200">·</span>
              <span className="text-xs text-gray-400">{formatTimeAgo(tx.timestamp)}</span>
              <span className="text-gray-200">·</span>
              <span className="text-xs text-gray-400 font-mono">
                {tx.type === 'receive' ? `from ${shortenAddr(tx.from)}` : `to ${shortenAddr(tx.to)}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {valueNum > 0 && (
              <span className={`text-sm font-bold ${tx.type === 'receive' ? 'text-emerald-600' : tx.type === 'send' ? 'text-red-500' : 'text-gray-700'}`}>
                {tx.type === 'receive' ? '+' : tx.type === 'send' ? '-' : ''}
                {valueNum < 0.001 ? valueNum.toFixed(6) : valueNum < 1 ? valueNum.toFixed(4) : valueNum.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                {tx.symbol && tx.symbol !== '?' && <span className="text-xs font-normal ml-0.5 text-gray-400">{tx.symbol}</span>}
              </span>
            )}
            <ExternalLink size={12} className="text-gray-300 group-hover:text-violet-400 transition-colors" />
          </div>
        </div>
      </div>
    </a>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function TxSkeleton() {
  return (
    <div className="animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50">
          <div className="w-9 h-9 rounded-xl bg-gray-100 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-gray-100 rounded w-1/3" />
            <div className="h-2.5 bg-gray-50 rounded w-1/2" />
          </div>
          <div className="h-3.5 w-20 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { address, isConnected } = useWallet()
  const { transactions, status, lastUpdated, refresh } = useTransactions()

  const [filter, setFilter] = useState<Filter>('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [watchInput, setWatchInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // ── Filter + search ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (filter !== 'All' && tx.type !== filter.toLowerCase()) return false
      if (search) {
        const q = search.toLowerCase()
        if (!tx.hash.toLowerCase().includes(q) &&
            !tx.symbol?.toLowerCase().includes(q) &&
            !tx.from?.toLowerCase().includes(q) &&
            !tx.to?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [transactions, filter, search])

  const goToPage = (n: number) => {
    setPage(n)
    // Scroll to top of list smoothly
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleFilterChange = (f: Filter) => { setFilter(f); setPage(1) }
  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // FIX 2: clip page to valid range when filtered results shrink
  const safePage = Math.min(page, totalPages)

  // FIX 5: memoize the page slice — only recomputes when filtered list or page changes
  const pageTxs = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  )

  const monadScanUrl = `https://monadscan.com/address/${address}`

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-gray-900" style={SORA}>Transactions</h1>
          <p className="text-gray-500 text-sm mt-1">Full history and wallet monitoring</p>
        </div>
        {isConnected && lastUpdated && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            <button onClick={refresh} disabled={status === 'loading'}
              className="p-1.5 rounded-lg hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-all disabled:opacity-40">
              <RefreshCw size={13} className={status === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Transaction History (2/3) ──────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Search + Filter */}
          <div className="card p-4 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search by hash, token, address…"
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-violet-100 text-sm bg-violet-50/30 focus:outline-none focus:border-violet-300 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(f => (
                <button key={f} onClick={() => handleFilterChange(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filter === f ? 'bg-violet-600 text-white' : 'bg-violet-50 text-gray-600 hover:bg-violet-100'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Tx list card */}
          <div ref={listRef} className="card overflow-hidden">

            {/* Card header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-50">
              <h2 className="font-semibold text-gray-800" style={SORA}>
                Transaction History
              </h2>
              <div className="flex items-center gap-3">
                {/* MonadScan link */}
                {isConnected && address && (
                  <a
                    href={monadScanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700 transition-colors font-medium"
                  >
                    View all on MonadScan
                    <ExternalLink size={11} />
                  </a>
                )}
                <span className="text-xs text-gray-400">
                  {(status === 'success' || transactions.length > 0)
                    ? `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`
                    : '—'
                  }
                </span>
              </div>
            </div>

            {/* States */}
            {!isConnected && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center">
                  <Wallet size={22} className="text-violet-400" />
                </div>
                <p className="text-sm text-gray-400">Connect your wallet to see transactions</p>
              </div>
            )}

            {isConnected && status === 'loading' && transactions.length === 0 && <TxSkeleton />}

            {isConnected && status === 'no_api_key' && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3 px-6">
                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                  <span className="text-amber-400 text-2xl">🔑</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">API Key Required</p>
                  <p className="text-xs text-gray-400 max-w-xs">
                    Add <code className="bg-gray-100 px-1 rounded text-violet-600">ETHERSCAN_API_KEY</code> to your Vercel environment variables to enable transaction history.
                  </p>
                </div>
                <a href="https://etherscan.io/apis" target="_blank" rel="noopener noreferrer"
                  className="text-sm text-violet-600 hover:text-violet-800 font-medium underline">Get free API key →</a>
              </div>
            )}

            {isConnected && status === 'error' && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <p className="text-sm text-red-400">Failed to load transactions</p>
                <button onClick={refresh} className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1">
                  <RefreshCw size={12} /> Try again
                </button>
              </div>
            )}

            {/* Transactions + slide pagination */}
            {isConnected && (status === 'success' || transactions.length > 0) && (
              <>
                {pageTxs.length > 0
                  ? pageTxs.map(tx => <TxRow key={tx.hash} tx={tx} />)
                  : (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                      <p className="text-sm text-gray-400">
                        {search || filter !== 'All' ? 'No transactions match your filters' : 'No transactions found'}
                      </p>
                    </div>
                  )
                }

                {/* ── Slide pagination footer ── */}
                {filtered.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 bg-gray-50/30">
                    {/* Prev arrow */}
                    <button
                      onClick={() => goToPage(safePage - 1)}
                      disabled={safePage === 1}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft size={16} strokeWidth={2.5} />
                      <span>Previous</span>
                    </button>

                    {/* Center: range + dots */}
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-500">
                        {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}
                        <span className="text-gray-300 mx-1">/</span>
                        {filtered.length}
                      </span>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                          <button
                            key={n}
                            onClick={() => goToPage(n)}
                            aria-label={`Page ${n}`}
                            className={`rounded-full transition-all duration-200 ${
                              safePage === n
                                ? 'w-4 h-2 bg-violet-600'
                                : 'w-2 h-2 bg-gray-200 hover:bg-violet-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Next arrow */}
                    <button
                      onClick={() => goToPage(safePage + 1)}
                      disabled={safePage === totalPages}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                    >
                      <span>Next</span>
                      <ChevronRight size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Sidebar (1/3) ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Watch Wallets */}
          <div className="card p-5 relative">
            {/* TODO: implement NFT gating — replace with dynamic check when collection launches */}
            <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center z-10 text-center p-6"
              style={{ background: 'var(--premium-overlay-bg)', backdropFilter: 'blur(4px)' }}>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center mb-3">
                <Lock size={24} className="text-white" />
              </div>
              <h3 className="font-bold text-gray-800 mb-1" style={SORA}>Premium Feature</h3>
              <p className="text-sm text-gray-500 mb-4">
                Soon you will be able to monitor wallets and receive alerts from Telegram.
              </p>
              <button className="btn-primary text-sm px-5 py-2">Coming soon</button>
              <p className="text-xs text-gray-400 mt-2">News coming soon!</p>
            </div>
            <h2 className="font-semibold text-gray-800 mb-4" style={SORA}>
              <Eye size={16} className="inline mr-1.5 text-violet-500" />Watch Wallets
            </h2>
            <div className="flex gap-2 mb-4">
              <input type="text" value={watchInput} onChange={e => setWatchInput(e.target.value)}
                placeholder="0x... or ENS name"
                className="flex-1 px-3 py-2 rounded-lg border border-violet-100 text-sm bg-violet-50/30 focus:outline-none focus:border-violet-300 transition-all" />
              <button className="btn-primary text-sm px-3 py-2"><Plus size={15} /></button>
            </div>
            <div className="space-y-3">
              {watchedWallets.map(wallet => (
                <div key={wallet.address} className="flex items-center gap-3 p-3 rounded-xl bg-violet-50/60 border border-violet-100">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center">
                    <Eye size={13} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{wallet.label}</p>
                    <p className="text-xs text-gray-400 font-mono">{wallet.address}</p>
                    <p className="text-xs text-gray-400">{wallet.txCount} txs · last {wallet.lastTx}</p>
                  </div>
                  <button className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Telegram Alerts */}
          <div className="card p-5 relative">
            {/* TODO: implement NFT gating */}
            <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center z-10 text-center p-6"
              style={{ background: 'var(--premium-overlay-bg)', backdropFilter: 'blur(4px)' }}>
              <Lock size={20} className="text-violet-400 mb-2" />
              <p className="text-xs text-gray-500">Coming soon</p>
            </div>
            <h2 className="font-semibold text-gray-800 mb-3" style={SORA}>
              <Bell size={16} className="inline mr-1.5 text-violet-500" />Telegram Alerts
            </h2>
            <p className="text-xs text-gray-500 mb-4">Connect Telegram to get real-time notifications for your wallet and watched wallets.</p>
            <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100 transition-all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Connect Telegram Bot
            </button>
            <p className="text-xs text-gray-400 mt-2 text-center">@MonBoardBot</p>
          </div>
        </div>
      </div>
    </div>
  )
}
