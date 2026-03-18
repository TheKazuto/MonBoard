'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// ─── Animated counter ─────────────────────────────────────────────────────────
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      let start = 0
      const step = Math.ceil(to / 60)
      const timer = setInterval(() => {
        start += step
        if (start >= to) { setVal(to); clearInterval(timer) }
        else setVal(start)
      }, 16)
    }, { threshold: 0.5 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [to])

  return <span ref={ref}>{val}{suffix}</span>
}

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: '/features/feature-portfolio.png',
    title: 'Portfolio Overview',
    desc: 'Total wallet value in USD combining tokens, NFTs and DeFi positions. 24h change at a glance.',
    tag: 'Live',
  },
  {
    icon: '/features/feature-defi.png',
    title: 'DeFi Positions',
    desc: 'All your active positions across 14+ Monad protocols (liquidity pools, lending, staking) in one view.',
    tag: '14+ protocols',
  },
  {
    icon: '/features/feature-aprs.png',
    title: 'Best APRs',
    desc: 'Real-time yield opportunities aggregated from every major Monad protocol.',
    tag: 'Real-time',
  },
  {
    icon: '/features/feature-swap.png',
    title: 'Swap & Bridge',
    desc: 'Cross-chain swaps across 70+ networks, best rate from 360+ DEXes and bridges via Rubic.',
    tag: 'Cross-chain',
  },
  {
    icon: '/features/feature-security.png',
    title: 'Security Scanner',
    desc: 'Token approval scanner with one-click revoke. Know exactly which contracts have access to your funds.',
    tag: 'On-chain',
  },
  {
    icon: '/features/feature-history.png',
    title: 'Transaction History',
    desc: 'Full on-chain history with smart classification: sends, swaps, DeFi, NFT mints and more.',
    tag: 'Full history',
  },
]

// ─── Protocol logos ───────────────────────────────────────────────────────────
const PROTOCOLS = [
  'Morpho', 'Euler V2', 'Neverland', 'Uniswap V3',
  'PancakeSwap', 'Curve', 'GearBox', 'Lagoon',
  'Upshift', 'Kintsu', 'Magma', 'shMonad',
  'Curvance', 'Midas', 'Kuru',
]

// ─── Stats ─────────────────────────────────────────────────────────────────────
const STATS = [
  { label: 'Protocols integrated', value: 14, suffix: '+' },
  { label: 'Features available',   value: 10, suffix: '+' },
  { label: 'Networks supported',   value: 70, suffix: '+' },
  { label: 'Cost to use',          value: 0,  suffix: '' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <>
      {/* ── Global styles + keyframes ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500&display=swap');

        :root {
          --land-bg:     #08080f;
          --land-card:   rgba(255,255,255,0.04);
          --land-border: rgba(255,255,255,0.08);
          --land-violet: #836EF9;
          --land-violet2: #6d28d9;
          --land-text:   #e8e5ff;
          --land-muted:  rgba(232,229,255,0.45);
        }

        .land * { box-sizing: border-box; }
        .land { font-family: 'DM Sans', sans-serif; background: var(--land-bg); color: var(--land-text); min-height: 100vh; overflow-x: hidden; }

        /* Mesh bg */
        .land-hero-bg {
          position: absolute; inset: 0; overflow: hidden; pointer-events: none;
        }
        .land-hero-bg::before {
          content: '';
          position: absolute; inset: -50%;
          background: radial-gradient(ellipse 80% 60% at 60% 30%, rgba(131,110,249,0.18) 0%, transparent 70%),
                      radial-gradient(ellipse 60% 50% at 20% 70%, rgba(109,40,217,0.12) 0%, transparent 70%);
          animation: meshPulse 8s ease-in-out infinite alternate;
        }
        .land-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(131,110,249,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(131,110,249,0.06) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 100% 80% at 50% 0%, black 0%, transparent 80%);
        }

        /* Floating orbs */
        .orb {
          position: absolute; border-radius: 50%;
          filter: blur(60px); opacity: 0.25;
          animation: orbFloat 12s ease-in-out infinite;
        }
        .orb-1 { width: 400px; height: 400px; background: #836EF9; top: -100px; left: -80px; animation-delay: 0s; }
        .orb-2 { width: 300px; height: 300px; background: #6d28d9; top: 200px; right: -60px; animation-delay: -4s; }
        .orb-3 { width: 200px; height: 200px; background: #a78bfa; bottom: 0; left: 40%; animation-delay: -8s; }

        @keyframes meshPulse { from { transform: scale(1) rotate(0deg); } to { transform: scale(1.08) rotate(3deg); } }
        @keyframes orbFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-40px) scale(1.05); }
        }

        /* Reveal animations */
        .reveal {
          opacity: 0; transform: translateY(28px);
          animation: revealUp 0.7s cubic-bezier(.16,1,.3,1) forwards;
        }
        @keyframes revealUp { to { opacity: 1; transform: translateY(0); } }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.22s; }
        .d3 { animation-delay: 0.34s; }
        .d4 { animation-delay: 0.46s; }
        .d5 { animation-delay: 0.58s; }

        /* Headline */
        .land-h1 {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: clamp(2.6rem, 7vw, 5.5rem);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.03em;
        }
        .land-h2 {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: clamp(1.6rem, 3.5vw, 2.5rem);
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        /* Gradient text */
        .grad-text {
          background: linear-gradient(135deg, #a78bfa 0%, #836EF9 40%, #c4b5fd 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Header */
        .land-header {
          position: fixed; top: 0; left: 0; right: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 2rem; height: 64px;
          background: rgba(8,8,15,0.8);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--land-border);
        }
        .land-logo {
          display: flex; align-items: center; gap: 0.6rem;
          font-family: 'Bricolage Grotesque', sans-serif;
          font-weight: 700; font-size: 1.1rem; color: var(--land-text);
          text-decoration: none;
        }
        .land-logo-dot {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, #836EF9, #6d28d9);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 800; color: white;
          box-shadow: 0 4px 20px rgba(131,110,249,0.4);
        }
        .btn-launch {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.5rem 1.25rem;
          background: linear-gradient(135deg, #836EF9, #6d28d9);
          color: white; font-weight: 600; font-size: 0.875rem;
          border-radius: 999px; text-decoration: none;
          border: none; cursor: pointer;
          box-shadow: 0 4px 20px rgba(131,110,249,0.35);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .btn-launch:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 30px rgba(131,110,249,0.5);
        }
        .btn-launch-outline {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.75rem 2rem;
          background: transparent;
          color: var(--land-text); font-weight: 500; font-size: 1rem;
          border-radius: 999px; text-decoration: none;
          border: 1px solid var(--land-border);
          transition: border-color 0.15s, background 0.15s;
        }
        .btn-launch-outline:hover {
          border-color: rgba(131,110,249,0.5);
          background: rgba(131,110,249,0.08);
        }
        .btn-launch-lg {
          padding: 0.875rem 2.5rem;
          font-size: 1.05rem;
        }

        /* Feature card */
        .feat-card {
          background: var(--land-card);
          border: 1px solid var(--land-border);
          border-radius: 16px;
          padding: 1.5rem;
          transition: border-color 0.2s, background 0.2s, transform 0.2s;
          position: relative; overflow: hidden;
        }
        .feat-card::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(131,110,249,0.4), transparent);
          opacity: 0; transition: opacity 0.3s;
        }
        .feat-card:hover {
          border-color: rgba(131,110,249,0.3);
          background: rgba(131,110,249,0.06);
          transform: translateY(-3px);
        }
        .feat-card:hover::before { opacity: 1; }

        /* Tag pill */
        .tag {
          display: inline-block;
          padding: 0.15rem 0.6rem;
          background: rgba(131,110,249,0.15);
          color: #a78bfa;
          font-size: 0.7rem; font-weight: 600;
          border-radius: 999px;
          letter-spacing: 0.04em; text-transform: uppercase;
        }

        /* Protocol pill */
        .proto-pill {
          display: inline-flex; align-items: center;
          padding: 0.4rem 0.9rem;
          background: var(--land-card);
          border: 1px solid var(--land-border);
          border-radius: 999px;
          font-size: 0.8rem; font-weight: 500; color: var(--land-muted);
          transition: border-color 0.2s, color 0.2s;
          white-space: nowrap;
        }
        .proto-pill:hover { border-color: rgba(131,110,249,0.4); color: var(--land-text); }

        /* Stats */
        .stat-card {
          text-align: center; padding: 1.5rem;
          background: var(--land-card);
          border: 1px solid var(--land-border);
          border-radius: 16px;
        }
        .stat-num {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: clamp(2rem, 5vw, 3rem);
          font-weight: 800; line-height: 1;
          background: linear-gradient(135deg, #a78bfa, #836EF9);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Section */
        .land-section { padding: 6rem 2rem; max-width: 1100px; margin: 0 auto; }

        /* Scrolling protocols ticker */
        .ticker-wrap { overflow: hidden; position: relative; }
        .ticker-wrap::before, .ticker-wrap::after {
          content: ''; position: absolute; top: 0; bottom: 0; width: 80px; z-index: 2;
        }
        .ticker-wrap::before { left: 0; background: linear-gradient(90deg, var(--land-bg), transparent); }
        .ticker-wrap::after  { right: 0; background: linear-gradient(-90deg, var(--land-bg), transparent); }
        .ticker {
          display: flex; gap: 0.75rem;
          animation: ticker 30s linear infinite;
          width: max-content;
        }
        .ticker:hover { animation-play-state: paused; }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }

        /* Divider */
        .land-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--land-border), transparent);
          margin: 0 2rem;
        }

        /* Footer */
        .land-footer {
          text-align: center; padding: 2.5rem 2rem;
          color: var(--land-muted); font-size: 0.85rem;
          border-top: 1px solid var(--land-border);
        }
        .land-footer a { color: var(--land-violet); text-decoration: none; }
        .land-footer a:hover { text-decoration: underline; }

        @media (max-width: 640px) {
          .land-header { padding: 0 1rem; }
          .land-section { padding: 4rem 1.25rem; }
        }
      `}} />

      <div className="land">

        {/* ── Fixed Header ── */}
        <header className="land-header">
          <a href="/landing" className="land-logo">
            <div className="land-logo-dot" style={{ padding: 0, overflow: 'hidden' }}>
              <img src="/monboard.png" alt="MonBoard" width={32} height={32} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div><span>Mon<span style={{ color: '#836EF9' }}>Board</span></span>
          </a>
          <Link href="/dashboard" className="btn-launch">
            Launch Dashboard <span>→</span>
          </Link>
        </header>

        {/* ── Hero ── */}
        <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '64px' }}>
          <div className="land-hero-bg">
            <div className="land-grid" />
            <div className="orb orb-1" />
            <div className="orb orb-2" />
            <div className="orb orb-3" />
          </div>

          <div style={{ position: 'relative', textAlign: 'center', maxWidth: '820px', margin: '0 auto', padding: '4rem 2rem' }}>
            <div className="reveal d1">
              <span className="tag" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem', marginBottom: '1.5rem', display: 'inline-block' }}>
                🟣 Built for Monad Ecosystem
              </span>
            </div>

            <h1 className="land-h1 reveal d2" style={{ marginBottom: '1.5rem' }}>
              Your Monad portfolio,{' '}
              <span className="grad-text">fully in view</span>
            </h1>

            <p className="reveal d3" style={{ fontSize: 'clamp(1rem, 2.5vw, 1.2rem)', color: 'var(--land-muted)', lineHeight: 1.7, maxWidth: '580px', margin: '0 auto 2.5rem' }}>
              Track tokens, DeFi positions, NFTs and transaction history across the entire Monad ecosystem in one clean, real-time dashboard.
            </p>

            <div className="reveal d4" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/dashboard" className="btn-launch btn-launch-lg">
                Launch Dashboard →
              </Link>
              <a href="#features" className="btn-launch-outline">
                Explore features
              </a>
            </div>

            {/* Hero mini-stat strip */}
            <div className="reveal d5" style={{ marginTop: '4rem', display: 'flex', justifyContent: 'center', gap: '2.5rem', flexWrap: 'wrap', opacity: 0.6, fontSize: '0.85rem' }}>
              {['14+ protocols', '10+ features', 'Practical to use', 'Live data'].map(s => (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ color: '#836EF9', fontSize: '1rem' }}>✦</span> {s}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Stats ── */}
        <div className="land-divider" />
        <section className="land-section" style={{ paddingTop: '4rem', paddingBottom: '4rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {STATS.map(({ label, value, suffix }) => (
              <div key={label} className="stat-card">
                <div className="stat-num">
                  <Counter to={value} suffix={suffix} />
                </div>
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--land-muted)' }}>{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ── */}
        <div className="land-divider" />
        <section className="land-section" id="features">
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <span className="tag" style={{ marginBottom: '1rem', display: 'inline-block' }}>Features</span>
            <h2 className="land-h2">Everything you need to navigate Monad</h2>
            <p style={{ color: 'var(--land-muted)', marginTop: '0.75rem', maxWidth: '520px', margin: '0.75rem auto 0' }}>
              From portfolio tracking to yield hunting, all your on-chain activity organized.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
            {FEATURES.map(({ icon, title, desc, tag }) => (
              <div key={title} className="feat-card">
                <div style={{ marginBottom: '1rem' }}>
                  <span className="tag">{tag}</span>
                </div>
                <img src={icon} alt={title} style={{ width: '100%', height: 'auto', objectFit: 'contain', borderRadius: '12px', marginBottom: '1.25rem', display: 'block' }} />
                <h3 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.5rem' }}>
                  {title}
                </h3>
                <p style={{ color: 'var(--land-muted)', fontSize: '0.875rem', lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Protocol integrations ── */}
        <div className="land-divider" />
        <section style={{ padding: '4rem 0' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem', padding: '0 2rem' }}>
            <span className="tag" style={{ marginBottom: '0.75rem', display: 'inline-block' }}>Integrations</span>
            <h2 className="land-h2">The whole Monad ecosystem, connected</h2>
            <p style={{ color: 'var(--land-muted)', marginTop: '0.5rem', fontSize: '0.95rem' }}>
              Live data from every major protocol.
            </p>
          </div>

          {/* Scrolling ticker — doubled for seamless loop */}
          <div className="ticker-wrap" style={{ padding: '0.5rem 0' }}>
            <div className="ticker">
              {[...PROTOCOLS, ...PROTOCOLS].map((p, i) => (
                <span key={i} className="proto-pill">{p}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why MonBoard ── */}
        <div className="land-divider" />
        <section className="land-section">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', alignItems: 'center' }}>
            <div>
              <span className="tag" style={{ marginBottom: '1rem', display: 'inline-block' }}>Why MonBoard</span>
              <h2 className="land-h2" style={{ marginBottom: '1rem' }}>
                Built for Monad.<br />
                <span className="grad-text">By Shinka Labs.</span>
              </h2>
              <p style={{ color: 'var(--land-muted)', lineHeight: 1.75, fontSize: '0.95rem' }}>
                MonBoard is crafted specifically for the Monad ecosystem, not a generic multi-chain dashboard with Monad added as an afterthought. Every integration is native, every data point is live, and every feature is designed around how Monad actually works.
              </p>
              <div style={{ marginTop: '1.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" className="btn-launch">Open dashboard →</Link>
                <a href="https://x.com/XShinkaLabsX" target="_blank" rel="noopener noreferrer" className="btn-launch-outline" style={{ fontSize: '0.9rem', padding: '0.6rem 1.25rem' }}>
                  Follow updates
                </a>
              </div>
            </div>

            {/* Checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                'Real-time data — no caching delays',
                '14+ native Monad protocol integrations',
                'Cross-chain swaps built in',
                'Security scanner for approvals',
                'Portfolio history up to 1 year',
                'The main DeFi tools in one place',
                'Dark mode & mobile responsive',
              ].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--land-card)', borderRadius: '10px', border: '1px solid var(--land-border)' }}>
                  <span style={{ color: '#836EF9', fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>✦</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--land-text)' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <div className="land-divider" />
        <section style={{ textAlign: 'center', padding: '7rem 2rem', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(131,110,249,0.12) 0%, transparent 70%)',
          }} />
          <span className="tag" style={{ marginBottom: '1.5rem', display: 'inline-block' }}>Get started</span>
          <h2 className="land-h2" style={{ marginBottom: '1rem', maxWidth: '600px', margin: '0 auto 1rem' }}>
            Start tracking your Monad portfolio today
          </h2>
          <p style={{ color: 'var(--land-muted)', marginBottom: '2.5rem', fontSize: '1rem' }}>
            No sign-up. Just connect your wallet.
          </p>
          <Link href="/dashboard" className="btn-launch btn-launch-lg">
            Launch Dashboard →
          </Link>
        </section>

        {/* ── Footer ── */}
        <footer className="land-footer">
          <p>
            Built by{' '}
            <a href="https://www.shinkalabs.tech/" target="_blank" rel="noopener noreferrer">Shinka Labs</a>
            {' '}· MonBoard ·{' '}
            <a href="https://t.me/ShinkaLabs" target="_blank" rel="noopener noreferrer">Telegram</a>
            {' '}·{' '}
            <a href="https://x.com/XShinkaLabsX" target="_blank" rel="noopener noreferrer">Twitter</a>
            {' '}·{' '}
            <a href="https://discord.gg/n6V8WV5ZN4" target="_blank" rel="noopener noreferrer">Discord</a>
          </p>
        </footer>

      </div>
    </>
  )
}
