'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { useWallet } from '@/contexts/WalletContext'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Transaction {
  hash: string
  type: 'send' | 'receive' | 'swap' | 'defi' | 'nft' | 'contract'
  from: string
  to: string
  valueNative: string
  symbol: string
  tokenName?: string
  timestamp: number
  isError: boolean
  isToken?: boolean
  functionName?: string
}

export type TxStatus = 'idle' | 'loading' | 'success' | 'error' | 'no_api_key'

interface TransactionContextValue {
  transactions: Transaction[]
  status: TxStatus
  lastUpdated: Date | null
  refresh: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────
const TransactionContext = createContext<TransactionContextValue>({
  transactions: [],
  status: 'idle',
  lastUpdated: null,
  refresh: () => {},
})

export function useTransactions() {
  return useContext(TransactionContext)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function classifyType(tx: Transaction, address: string): Transaction['type'] {
  const fn = (tx.functionName || '').toLowerCase()
  if (fn.includes('swap') || fn.includes('exchange')) return 'swap'
  if (fn.includes('deposit') || fn.includes('borrow') || fn.includes('supply') || fn.includes('withdraw') || fn.includes('stake')) return 'defi'
  if (fn.includes('mint') || fn.includes('nft') || fn.includes('erc721')) return 'nft'
  if (tx.to && tx.functionName && tx.functionName !== '') return 'contract'
  return tx.from?.toLowerCase() === address.toLowerCase() ? 'send' : 'receive'
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function shortenAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function TransactionProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useWallet()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [status, setStatus] = useState<TxStatus>('idle')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAddressRef = useRef<string | null>(null)

  const fetchTransactions = useCallback(async (addr: string) => {
    setStatus('loading')
    try {
      const res = await fetch(`/api/transactions?address=${addr}`)
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()

      if (data.error === 'no_api_key') {
        setStatus('no_api_key')
        return
      }
      if (data.error) throw new Error(data.error)

      const enriched: Transaction[] = (data.transactions ?? [])
        .map((tx: Transaction) => ({
          ...tx,
          type: classifyType(tx, addr),
        }))
        // Deduplicate by hash (keep first occurrence)
        .filter((tx: Transaction, i: number, arr: Transaction[]) => arr.findIndex((t: Transaction) => t.hash === tx.hash) === i)
        // Always sort newest first — stable order, never shuffles on re-render
        .sort((a: Transaction, b: Transaction) => b.timestamp - a.timestamp)

      setTransactions(enriched)
      setLastUpdated(new Date())
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }, [])

  const refresh = useCallback(() => {
    if (!address) return
    // Reset the auto-refresh timer so it doesn't fire immediately after a manual refresh
    if (intervalRef.current) clearInterval(intervalRef.current)
    fetchTransactions(address)
    intervalRef.current = setInterval(() => fetchTransactions(address), 120_000)
  }, [address, fetchTransactions])

  useEffect(() => {
    // Clear interval on any change
    if (intervalRef.current) clearInterval(intervalRef.current)

    if (!isConnected || !address) {
      setTransactions([])
      setStatus('idle')
      setLastUpdated(null)
      lastAddressRef.current = null
      return
    }

    // Reset if wallet changed
    if (lastAddressRef.current !== address) {
      setTransactions([])
      setStatus('idle')
      lastAddressRef.current = address
    }

    // Initial fetch
    fetchTransactions(address)

    // Auto-refresh every 2 minutes
    intervalRef.current = setInterval(() => fetchTransactions(address), 120_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isConnected, address, fetchTransactions])

  return (
    <TransactionContext.Provider value={{ transactions, status, lastUpdated, refresh }}>
      {children}
    </TransactionContext.Provider>
  )
}
