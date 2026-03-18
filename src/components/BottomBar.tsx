'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useMonadPrice } from '@/hooks/useMonadPrice'
import { SORA } from '@/lib/styles'

const SocialLinks = [
  {
    name: 'Telegram',
    href: 'https://t.me/ShinkaLabs',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
    ),
  },
  {
    name: 'Twitter/X',
    href: 'https://x.com/ShinkaLabsHQ',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    name: 'Discord',
    href: 'https://discord.gg/n6V8WV5ZN4',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.085.118 18.11.14 18.129a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
      </svg>
    ),
  },
  {
    name: 'Docs',
    href: 'https://shinkalabs.gitbook.io/dashboard',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
]

export default function BottomBar() {
  // Guard de mount — evita hydration mismatch no preço (dado dinâmico)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { price, change24h, loading, error, lastUpdated } = useMonadPrice(30000)
  const isPositive = change24h >= 0

  return (
    <div className="bottom-bar">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">

        {/* MON Price */}
        <div className="flex items-center gap-2">
          {/* Logo circle */}
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center overflow-hidden shadow shadow-violet-200 shrink-0">
            <img
              src="/monad-logo.png"
              alt="Monad"
              width={16}
              height={16}
              className="object-contain scale-90"
            />
          </div>

          <span className="font-display text-sm font-semibold text-gray-800" style={SORA}>
            MON
          </span>

          {/* Só exibe dados de preço após mount para evitar mismatch SSR/client */}
          {!mounted ? (
            <span className="text-sm text-gray-300 w-20 h-4 bg-gray-100 rounded animate-pulse inline-block" />
          ) : loading && !lastUpdated ? (
            <span className="text-sm text-gray-400 animate-pulse">Loading...</span>
          ) : (
            <>
              <span className="text-sm font-mono font-medium text-gray-700">
                ${price.toFixed(4)}
              </span>
              <div className={`flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {isPositive ? '+' : ''}{change24h.toFixed(2)}%
              </div>
              {error && (
                <span title="Using cached price" className="text-xs text-amber-400 cursor-help">●</span>
              )}
            </>
          )}

          <div className="status-dot ml-0.5" title={lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} />
        </div>

        {/* Powered by */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
          <span>Powered by</span>
          <a
            href="https://www.shinkalabs.tech/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-violet-500 hover:text-violet-700 transition-colors"
          >
            Shinka Labs
          </a>
        </div>

        {/* Social Links */}
        <div className="flex items-center gap-0.5">
          {SocialLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={link.name}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-violet-600 hover:bg-violet-50 transition-all duration-200"
            >
              {link.icon}
            </a>
          ))}
        </div>

      </div>
    </div>
  )
}
