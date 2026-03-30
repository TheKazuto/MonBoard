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

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

// Throw at module load time so the error is visible in build/runtime logs.
// A missing or fake projectId causes WalletConnect to fail silently or
// piggyback on another project's credentials.
if (!wcProjectId) {
  throw new Error(
    '[MonBoard] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required. ' +
    'Get a project ID at https://cloud.walletconnect.com and add it to your .env file.'
  )
}

const wagmiConfig = getDefaultConfig({
  appName:   'MonBoard',
  projectId: wcProjectId,
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
