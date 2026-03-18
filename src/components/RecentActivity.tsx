'use client'

import { useWallet } from '@/contexts/WalletContext'
import { RefreshCw, ChevronRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Zap, Image, ExternalLink, Wallet } from 'lucide-react'
import { useTransactions, formatTimeAgo, shortenAddr, Transaction } from '@/contexts/TransactionContext'
import { SORA } from '@/lib/styles'

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; text: string; label: string }> = {
  receive:  { icon: <ArrowDownLeft size={14} />,  bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Received' },
  send:     { icon: <ArrowUpRight size={14} />,   bg: 'bg-red-50',     text: 'text-red-500',    label: 'Sent' },
  swap:     { icon: <ArrowLeftRight size={14} />, bg: 'bg-violet-50',  text: 'text-violet-600', label: 'Swap' },
  defi:     { icon: <Zap size={14} />,            bg: 'bg-amber-50',   text: 'text-amber-600',  label: 'DeFi' },
  nft:      { icon: <Image size={14} />,          bg: 'bg-blue-50',    text: 'text-blue-600',   label: 'NFT' },
  contract: { icon: <Zap size={14} />,            bg: 'bg-gray-50',    text: 'text-gray-500',   label: 'Contract' },
}

function TxRow({ tx }: { tx: Transaction }) {
  const cfg = TYPE_CONFIG[tx.type] ?? TYPE_CONFIG.contract
  const valueNum = parseFloat(tx.valueNative)

  return (
    <a
      href={`https://monadscan.com/tx/${tx.hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-violet-50/60 transition-all group -mx-1"
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-800 truncate">
            {cfg.label}
            {tx.symbol && tx.symbol !== '?' && (
              <span className="font-normal text-gray-500 ml-1">{tx.symbol}</span>
            )}
          </span>
          {valueNum > 0 && (
            <span className={`text-sm font-bold shrink-0 ${tx.type === 'receive' ? 'text-emerald-600' : tx.type === 'send' ? 'text-red-500' : 'text-gray-700'}`}>
              {tx.type === 'receive' ? '+' : tx.type === 'send' ? '-' : ''}
              {valueNum < 0.001 ? valueNum.toFixed(6) : valueNum < 1 ? valueNum.toFixed(4) : valueNum.toLocaleString('en-US', { maximumFractionDigits: 4 })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-gray-400">{formatTimeAgo(tx.timestamp)}</span>
          <span className="text-gray-200">·</span>
          <span className="text-xs text-gray-400 font-mono">
            {tx.type === 'receive' ? `from ${shortenAddr(tx.from)}` : `to ${shortenAddr(tx.to)}`}
          </span>
          <ExternalLink size={10} className="text-gray-300 group-hover:text-violet-400 transition-colors ml-0.5 shrink-0" />
        </div>
      </div>
    </a>
  )
}

export default function RecentActivity() {
  const { isConnected } = useWallet()
  const { transactions, status, lastUpdated, refresh } = useTransactions()
  const recent = transactions.slice(0, 6)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800" style={SORA}>
            Recent Activity
          </h3>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">Updated {lastUpdated.toLocaleTimeString()}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button onClick={refresh} disabled={status === 'loading'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-all disabled:opacity-40">
              <RefreshCw size={13} className={status === 'loading' ? 'animate-spin' : ''} />
            </button>
          )}
          <a href="/transactions" className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-0.5">
            See all <ChevronRight size={12} />
          </a>
        </div>
      </div>

      {!isConnected && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center">
            <Wallet size={18} className="text-violet-400" />
          </div>
          <p className="text-sm text-gray-400">Connect your wallet to see activity</p>
        </div>
      )}

      {isConnected && status === 'loading' && transactions.length === 0 && (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5">
              <div className="w-8 h-8 rounded-xl bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2.5 bg-gray-50 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isConnected && status === 'no_api_key' && (
        <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center mb-1">
            <span className="text-amber-400 text-lg">🔑</span>
          </div>
          <p className="text-sm font-medium text-gray-600">API Key required</p>
          <p className="text-xs text-gray-400 max-w-[200px]">
            Add <code className="bg-gray-100 px-1 rounded text-violet-600">ETHERSCAN_API_KEY</code> in Vercel environment variables
          </p>
          <a href="https://etherscan.io/apis" target="_blank" rel="noopener noreferrer"
            className="text-xs text-violet-500 hover:text-violet-700 underline mt-1">Get free key →</a>
        </div>
      )}

      {isConnected && status === 'error' && (
        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
          <p className="text-sm text-red-400">Failed to load transactions</p>
          <button onClick={refresh} className="text-xs text-violet-600 hover:text-violet-800 flex items-center gap-1">
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      )}

      {isConnected && (status === 'success' || (status === 'loading' && transactions.length > 0)) && (
        <div className="space-y-0.5">
          {recent.length > 0
            ? recent.map(tx => <TxRow key={tx.hash + tx.timestamp} tx={tx} />)
            : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <p className="text-sm text-gray-400">No transactions found</p>
                <p className="text-xs text-gray-300">Your activity will appear here</p>
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}
