import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/Providers'
import ConditionalShell from '@/components/ConditionalShell'

export const metadata: Metadata = {
  title: 'MonBoard — Your Monad DeFi Dashboard',
  description: 'The ultimate dashboard for the Monad ecosystem. Track your portfolio, DeFi positions, NFTs and get real-time alerts.',
  keywords: ['monad', 'blockchain', 'portfolio', 'defi', 'nft', 'dashboard', 'mon'],
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'MonBoard',
    description: 'Your Monad DeFi Dashboard',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme — runs before React hydration */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-screen" style={{ background: 'var(--ink-bg)' }}>
        <Providers>
          <ConditionalShell>
            {children}
          </ConditionalShell>
        </Providers>
      </body>
    </html>
  )
}
