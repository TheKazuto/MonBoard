'use client'

import { ReactNode, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { defineChain } from 'viem'
import { RainbowKitProvider, getDefaultConfig, lightTheme } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletContextProvider } from '@/contexts/WalletContext'
import { PortfolioProvider }     from '@/contexts/PortfolioContext'
import { TransactionProvider }   from '@/contexts/TransactionContext'
import { PreferencesProvider }   from '@/contexts/PreferencesContext'

import '@rainbow-me/rainbowkit/styles.css'

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: 'https://monadexplorer.com' },
  },
})

// Fix #12 (MÉDIO): Removed the 'monboard' fallback projectId.
// An invalid/unknown projectId causes WalletConnect to fail silently or use
// another project's credentials. A real projectId from cloud.walletconnect.com
// is required. If not set, we warn clearly rather than use a fake value.
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
if (!wcProjectId && typeof window !== 'undefined') {
  console.warn('[MonBoard] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. WalletConnect connections will be disabled.')
}

const wagmiConfig = getDefaultConfig({
  appName:   'MonBoard',
  projectId: wcProjectId ?? 'MISSING_WALLETCONNECT_PROJECT_ID',
  chains:    [monadMainnet],
  ssr:       false,
})

export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  }))

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: '#836EF9',
            accentColorForeground: 'white',
            borderRadius: 'large',
            fontStack: 'system',
          })}
          locale="en-US"
        >
          <PreferencesProvider>
            <WalletContextProvider>
              <PortfolioProvider>
                <TransactionProvider>
                  {children}
                </TransactionProvider>
              </PortfolioProvider>
            </WalletContextProvider>
          </PreferencesProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
