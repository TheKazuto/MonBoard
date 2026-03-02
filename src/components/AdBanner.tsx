'use client'

import { useEffect, useRef } from 'react'

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Set your AdSense publisher ID in .env.local:
//   NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
// Set the ad slot ID (from AdSense → Ads → By ad unit):
//   NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD=XXXXXXXXXX
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? ''
const ADSENSE_SLOT   = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD ?? ''
const IS_CONFIGURED  = !!ADSENSE_CLIENT && !!ADSENSE_SLOT

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function AdBanner({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!IS_CONFIGURED) return
    try {
      // Push ad after mount — required by AdSense
      ;(window as any).adsbygoogle = (window as any).adsbygoogle || []
      ;(window as any).adsbygoogle.push({})
    } catch { /* ignore */ }
  }, [])

  // ── Not configured yet — show a placeholder ───────────────────────────────
  if (!IS_CONFIGURED) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-violet-200 bg-violet-50/40 text-center p-4 ${className}`}
        style={{ minHeight: 80 }}
      >
        <p className="text-xs text-violet-400 font-medium">Content coming soon</p>
      </div>
    )
  }

  // ── AdSense responsive ad unit ────────────────────────────────────────────
  return (
    <div ref={ref} className={`overflow-hidden ${className}`} style={{ minHeight: 80 }}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', height: '100%' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
