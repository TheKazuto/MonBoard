'use client'

import { useEffect, useState } from 'react'
import { Banknote, Shield, Globe, Zap, CreditCard } from 'lucide-react'
import { useWallet } from '@/contexts/WalletContext'
import { SORA } from '@/lib/styles'

// ─── Transak config ───────────────────────────────────────────────────────────
// Staging (immediate, no approval):  https://global-stg.transak.com
// Production (requires KYB):         https://global.transak.com
//
// Setup (free):
//   1. Create account at dashboard.transak.com
//   2. Copy your API key (staging works instantly)
//   3. Add to .env.local:
//        NEXT_PUBLIC_TRANSAK_API_KEY=your_key_here
//        NEXT_PUBLIC_TRANSAK_ENV=staging   # or "production"
//   4. For production: submit KYB at forms.transak.com/kyb

const TRANSAK_ENV     = (process.env.NEXT_PUBLIC_TRANSAK_ENV ?? 'staging') as 'staging' | 'production'
const TRANSAK_API_KEY = process.env.NEXT_PUBLIC_TRANSAK_API_KEY ?? ''

const TRANSAK_BASE = TRANSAK_ENV === 'production'
  ? 'https://global.transak.com'
  : 'https://global-stg.transak.com'

function buildWidgetUrl(walletAddress?: string): string {
  const params = new URLSearchParams()

  if (TRANSAK_API_KEY) params.set('apiKey', TRANSAK_API_KEY)

  // Default to MON on Monad (official launch partner)
  params.set('cryptoCurrencyCode', 'MON')
  params.set('network',            'monad')

  // Pre-fill wallet — user skips that step when connected
  if (walletAddress) {
    params.set('walletAddress',           walletAddress)
    params.set('disableWalletAddressForm', 'true')
  }

  // Tokens available for purchase on Monad
  params.set('cryptoCurrencyList', 'MON,USDC,ETH,WBTC')

  // Match MonBoard violet palette — no # prefix
  params.set('themeColor', '836EF9')
  params.set('hideMenu',   'true')

  return `${TRANSAK_BASE}?${params.toString()}`
}

// ─── Feature pills ────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Globe,
    title: '162 countries',
    desc: '170+ payment methods',
  },
  {
    icon: Shield,
    title: 'KYC handled',
    desc: 'Fully licensed & compliant',
  },
  {
    icon: Zap,
    title: 'MON native',
    desc: 'Official Monad partner',
  },
  {
    icon: CreditCard,
    title: 'Card & PIX',
    desc: 'Apple Pay, Google Pay…',
  },
]

// ─── No API key setup guide ───────────────────────────────────────────────────
function SetupBanner() {
  return (
    <div className="h-[630px] flex items-center justify-center bg-gray-50 rounded-xl">
      <div className="max-w-sm text-center px-6 space-y-4">
        <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mx-auto">
          <Banknote size={22} className="text-violet-600" />
        </div>
        <div>
          <p className="font-semibold text-gray-800 mb-1">Configure Transak</p>
          <p className="text-sm text-gray-500 leading-relaxed">
            Create a free account at{' '}
            <a
              href="https://dashboard.transak.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-600 hover:underline font-medium"
            >
              dashboard.transak.com
            </a>
            {' '}and add to{' '}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.env.local</code>:
          </p>
        </div>
        <pre className="text-left bg-gray-900 text-green-400 text-xs rounded-xl p-4 leading-relaxed">
{`NEXT_PUBLIC_TRANSAK_API_KEY=sua_chave
NEXT_PUBLIC_TRANSAK_ENV=staging`}
        </pre>
        <p className="text-xs text-gray-400">
          Staging funciona imediatamente sem aprovação.<br />
          Para produção, submeta o KYB.
        </p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OnrampPage() {
  const { address, isConnected } = useWallet()
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null)

  // Build URL client-side — wallet address only available after hydration
  useEffect(() => {
    setWidgetUrl(buildWidgetUrl(isConnected && address ? address : undefined))
  }, [address, isConnected])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-200">
            <Banknote size={17} className="text-white" />
          </div>
          <h1 className="font-bold text-2xl text-gray-900" style={SORA}>
            Buy crypto with fiat money
          </h1>
        </div>
        <p className="text-sm text-gray-500 ml-12">
          Convert your local currency to MON and other tokens — directly to your wallet
        </p>
      </div>

      {/* Widget */}
      <div className="card overflow-hidden">
        {widgetUrl === null ? (
          <div className="h-[630px] flex items-center justify-center bg-gray-50">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          </div>
        ) : !TRANSAK_API_KEY ? (
          <SetupBanner />
        ) : (
          // Fix #6 (ALTO): Added sandbox attribute to limit iframe capabilities.
          // allow-scripts    — required for Transak widget JS to run
          // allow-forms      — required for KYC forms and payment input
          // allow-same-origin — required for Transak to read its own cookies/storage
          // allow-popups     — required to open card processor redirects
          // allow-popups-to-escape-sandbox — required for OAuth redirects (Google Pay etc.)
          // NOT included: allow-top-navigation (prevents iframe from redirecting the whole page)
          <iframe
            src={widgetUrl}
            title="Buy crypto with fiat — Transak"
            height="630"
            width="100%"
            className="border-0"
            allow="accelerometer; autoplay; camera; gyroscope; payment; microphone"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            style={{ display: 'block' }}
          />
        )}
      </div>

      {/* Feature pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="card p-3 flex flex-col gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
              <Icon size={14} className="text-violet-600" />
            </div>
            <p className="text-xs font-semibold text-gray-800">{title}</p>
            <p className="text-xs text-gray-400 leading-snug">{desc}</p>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
        Powered by{' '}
        <a
          href="https://transak.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-500 hover:text-violet-700"
        >
          Transak
        </a>
        {' '}· Parceiro oficial do Monad · MonBoard nunca retém seus fundos
      </p>
    </div>
  )
}
