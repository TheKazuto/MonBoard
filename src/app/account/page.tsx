'use client'

import { useState } from 'react'
import { useWallet }        from '@/contexts/WalletContext'
import { usePortfolio }     from '@/contexts/PortfolioContext'
import { usePreferences }   from '@/contexts/PreferencesContext'
import type { Currency, TimeRange, Theme } from '@/contexts/PreferencesContext'
import { CURRENCIES, CURRENCY_LABELS } from '@/contexts/PreferencesContext'
import { User, Copy, ExternalLink, Shield, CheckCircle, Lock, Sun, Moon } from 'lucide-react'
import { shortenAddr } from '@/contexts/TransactionContext'
// Fix #6: import SORA from shared lib instead of redeclaring locally
import { SORA } from '@/lib/styles'

export default function AccountPage() {
  const [copied, setCopied] = useState(false)
  const hasNFT = false

  const { address, isConnected, disconnect } = useWallet()
  const { totals, status } = usePortfolio()
  const { currency, defaultRange, theme, setCurrency, setDefaultRange, setTheme, fmtValue, rates, ratesUpdatedAt } = usePreferences()

  const isLoading = status === 'loading'

  const handleCopy = () => {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-gray-900" style={SORA}>
          Account
        </h1>
        <p className="text-gray-500 text-sm mt-1">Manage your profile and preferences</p>
      </div>

      {/* Wallet Card */}
      <div className="card p-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)' }}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, white, transparent)', transform: 'translate(30%, -40%)' }} />
        <div className="flex items-start gap-4 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
            <User size={28} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-white font-display font-bold text-lg" style={SORA}>My Wallet</p>
              {hasNFT && (
                <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
                  ⭐ NFT Holder
                </span>
              )}
            </div>

            {isConnected && address ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-violet-200 text-sm font-mono">{shortenAddr(address)}</p>
                  <button onClick={handleCopy} className="text-violet-200 hover:text-white transition-colors" title="Copy address">
                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                  </button>
                  <a
                    href={`https://monadexplorer.com/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-200 hover:text-white transition-colors"
                    title="View on explorer"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
                <p className="text-violet-200 text-sm mt-2">
                  Portfolio:{' '}
                  {isLoading ? (
                    <span className="inline-block w-20 h-4 bg-white/20 rounded animate-pulse align-middle" />
                  ) : (
                    <span className="text-white font-bold">{fmtValue(totals.totalValueUSD)}</span>
                  )}
                </p>
              </>
            ) : (
              <p className="text-violet-300 text-sm mt-1">No wallet connected</p>
            )}
          </div>
        </div>
      </div>

      {/* NFT Access Status */}
      <div className={`card p-5 border-2 ${hasNFT ? 'border-emerald-200 bg-emerald-50/30' : 'border-violet-200'}`}>
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${hasNFT ? 'bg-emerald-100' : 'bg-violet-100'}`}>
            {hasNFT ? <Shield size={22} className="text-emerald-600" /> : <Lock size={22} className="text-violet-500" />}
          </div>
          <div className="flex-1">
            <h3 className="font-display font-semibold text-gray-800" style={SORA}>
              {hasNFT ? '✅ Premium Access Unlocked' : 'MonBoard NFT Access'}
            </h3>
            {hasNFT ? (
              <p className="text-emerald-600 text-sm mt-1">You have access to all premium features.</p>
            ) : (
              <div>
                <p className="text-gray-500 text-sm mt-1">
                  Hold a MonBoard NFT to unlock premium features like wallet monitoring and Telegram alerts.
                </p>
                <button className="mt-3 btn-primary text-xs px-4 py-2">Get MonBoard NFT</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="card p-5 space-y-5">
        <h3 className="font-display font-semibold text-gray-800" style={SORA}>Preferences</h3>

        {/* Currency */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Display Currency</p>
            <p className="text-xs text-gray-400 mt-0.5">Values shown across the dashboard</p>
          </div>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value as Currency)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>{CURRENCY_LABELS[c]}</option>
            ))}
          </select>
        </div>

        {/* Default Range */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Default Chart Range</p>
            <p className="text-xs text-gray-400 mt-0.5">Default time range for portfolio history</p>
          </div>
          <select
            value={defaultRange}
            onChange={e => setDefaultRange(e.target.value as TimeRange)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            {(['7d', '30d', '90d', '1y'] as TimeRange[]).map(r => (
              <option key={r} value={r}>{r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : r === '90d' ? '90 Days' : '1 Year'}</option>
            ))}
          </select>
        </div>

        {/* Theme */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Theme</p>
            <p className="text-xs text-gray-400 mt-0.5">Light or dark interface</p>
          </div>
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {theme === 'light' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'light' ? 'Light' : 'Dark'}
          </button>
        </div>

        {/* Exchange rates info */}
        {ratesUpdatedAt && (
          <p className="text-xs text-gray-300 pt-2 border-t border-gray-50">
            Exchange rates updated: {new Date(ratesUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Disconnect */}
      {isConnected && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Disconnect Wallet</p>
              <p className="text-xs text-gray-400 mt-0.5">Remove wallet connection from this browser</p>
            </div>
            <button
              onClick={disconnect}
              className="text-xs font-semibold text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 px-4 py-2 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
