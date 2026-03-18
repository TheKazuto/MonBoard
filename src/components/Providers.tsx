'use client'

import dynamic from 'next/dynamic'
import { ReactNode } from 'react'

// Load WalletProvider (wagmi/RainbowKit) client-side only
// This prevents the useLayoutEffect SSR crash from RainbowKit
const WalletProviderDynamic = dynamic(
  () => import('@/components/WalletProvider').then(m => m.WalletProvider),
  { ssr: false }
)

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProviderDynamic>
      {children}
    </WalletProviderDynamic>
  )
}
