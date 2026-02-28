'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Wallet, BarChart3, History, User, Menu, X, Zap, ArrowLeftRight, Shield, TrendingUp } from 'lucide-react'
import { ConnectButton } from '@rainbow-me/rainbowkit'

// Stable style object for the logo wordmark — avoids creating a new object per render
const LOGO_STYLE = { fontFamily: 'Sora, sans-serif', fontWeight: 700, color: '#200052', fontSize: '1.125rem' } as const

const navLinks = [
  { href: '/',             label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/portfolio',    label: 'Portfolio',      icon: Wallet },
  { href: '/defi',         label: 'DeFi Positions', icon: BarChart3 },
  { href: '/best-aprs',    label: 'Best APRs',      icon: TrendingUp },
  { href: '/swap',         label: 'Swap/Bridge',    icon: ArrowLeftRight },
  { href: '/security',     label: 'Security',       icon: Shield },
  { href: '/transactions', label: 'Transactions',   icon: History },
  { href: '/account',      label: 'Account',        icon: User },
]

export default function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 glass border-b border-violet-100/60 h-16">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-200">
            <Zap size={16} className="text-white" fill="white" />
          </div>
          <span style={LOGO_STYLE}>
            Mon<span style={{ color: '#836EF9' }}>board</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive ? 'bg-violet-100 text-violet-700' : 'text-gray-600 hover:text-violet-700 hover:bg-violet-50'
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            )
          })}
        </div>

        {/* Desktop wallet — RainbowKit ConnectButton */}
        <div className="hidden md:flex items-center">
          <ConnectButton
            showBalance={false}
            chainStatus="none"
            accountStatus={{
              smallScreen: 'avatar',
              largeScreen: 'full',
            }}
          />
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-violet-50 transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 glass border-b border-violet-100/60 py-3 px-4 flex flex-col gap-1 shadow-xl z-50">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href
            return (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'bg-violet-100 text-violet-700' : 'text-gray-600'
                }`}>
                <Icon size={16} />
                {label}
              </Link>
            )
          })}
          <div className="mt-2 pt-2 border-t border-violet-100 flex justify-center">
            <ConnectButton showBalance={false} chainStatus="none" />
          </div>
        </div>
      )}
    </nav>
  )
}
