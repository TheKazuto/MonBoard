import { NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 3600_000 // 1 hour

export async function GET() {
  try {
    const data = await cached('fear-greed', async () => {
      const res = await fetch(
        'https://api.alternative.me/fng/?limit=30&format=json',
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error('Alternative.me error')
      const json = await res.json()
      const d = json.data
      if (!d || d.length === 0) throw new Error('empty data')

      const now      = d[0]
      const yesterday = d[1] ?? d[0]
      const weekAgo  = d[6] ?? d[0]
      const monthAgo = d[29] ?? d[0]

      return {
        now:       { value: parseInt(now.value),       label: now.value_classification },
        yesterday: { value: parseInt(yesterday.value), label: yesterday.value_classification },
        weekAgo:   { value: parseInt(weekAgo.value),   label: weekAgo.value_classification },
        monthAgo:  { value: parseInt(monthAgo.value),  label: monthAgo.value_classification },
      }
    }, CACHE_TTL)

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
