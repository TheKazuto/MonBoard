'use client'

/**
 * WalletContext — thin bridge over wagmi useAccount.
 *
 * Exposes a `stableAddress` that only updates after 150ms of stability.
 * This prevents wagmi's reconnect flicker (address briefly = undefined
 * during page navigation) from causing cascade re-fetches in all components.
 */

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { useAccount, useDisconnect } from 'wagmi'

interface WalletContextValue {
  address:       string | null  // raw wagmi value (may flicker)
  stableAddress: string | null  // debounced — use this for fetch triggers
  isConnected:   boolean
  disconnect:    () => void
}

const WalletContext = createContext<WalletContextValue>({
  address:       null,
  stableAddress: null,
  isConnected:   false,
  disconnect:    () => {},
})

export function useWallet() {
  return useContext(WalletContext)
}

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { disconnect }           = useDisconnect()

  const rawAddress    = (isConnected && address) ? address : null
  const [stable, setStable] = useState<string | null>(rawAddress)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Clear any pending debounce
    if (timerRef.current) clearTimeout(timerRef.current)

    if (rawAddress) {
      // Address present — update stable after short debounce
      timerRef.current = setTimeout(() => {
        setStable(rawAddress)
      }, 150)
    } else {
      // Disconnected — wait longer before clearing (avoids nav flicker)
      timerRef.current = setTimeout(() => {
        setStable(null)
      }, 500)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [rawAddress])

  return (
    <WalletContext.Provider value={{
      address:       rawAddress,
      stableAddress: stable,
      isConnected:   !!stable,
      disconnect,
    }}>
      {children}
    </WalletContext.Provider>
  )
}
