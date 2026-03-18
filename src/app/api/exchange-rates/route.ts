import { NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 3600_000 // 1 hour

export async function GET() {
  try {
    const data = await cached('exchange-rates', async () => {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('fetch failed')
      const d = await res.json()
      if (d.result !== 'success') throw new Error('api error')
      return {
        rates: { USD: 1, EUR: d.rates.EUR, BRL: d.rates.BRL },
        updatedAt: d.time_last_update_utc,
      }
    }, CACHE_TTL)

    return NextResponse.json(data)
  } catch (e) {
    console.error('[exchange-rates] error:', e)
    return NextResponse.json({
      rates: { USD: 1, EUR: 0.92, BRL: 5.70 },
      updatedAt: null,
      fallback: true,
    })
  }
}
