import { NextResponse } from 'next/server'
import { cached } from '@/lib/serverCache'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 3600_000 // 1 hour

export async function GET() {
  try {
    const data = await cached('fear-greed', async () => {
      const res = await fetch(
        'https://api.alternative.me/fng/?limit=30&format=json',
        { cache: 'no-store', signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) throw new Error('Alternative.me error')
      const json = await res.json()
      const d: any[] = json?.data
      if (!Array.isArray(d) || d.length === 0) throw new Error('empty data')

      function parseEntry(entry: any): { value: number; label: string } {
        const value = parseInt(entry?.value, 10)
        const label = typeof entry?.value_classification === 'string' ? entry.value_classification : ''
        if (isNaN(value) || value < 0 || value > 100) throw new Error('invalid fear-greed value')
        return { value, label }
      }

      return {
        now:       parseEntry(d[0]),
        yesterday: parseEntry(d[1] ?? d[0]),
        weekAgo:   parseEntry(d[6] ?? d[0]),
        monthAgo:  parseEntry(d[29] ?? d[0]),
      }
    }, CACHE_TTL)

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
