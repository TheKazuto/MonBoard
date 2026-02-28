import { NextRequest, NextResponse } from 'next/server'

// Fix #15 (BAIXO): Simple in-memory rate limiter for API routes.
// Runs on the Edge runtime — no extra dependency needed.
// Limits: 60 requests / minute per IP across all /api/ routes.
// Stricter limits for expensive routes (approvals-logs, nfts, defi).
//
// NOTE: This in-memory store resets on cold start. For production deployments
// with multiple Vercel regions, use Upstash Redis for a persistent store:
// https://upstash.com/docs/redis/quickstarts/nextjs-edge

interface RateEntry { count: number; resetAt: number }
const store = new Map<string, RateEntry>()

const WINDOW_MS = 60_000  // 1-minute sliding window

// Per-route limits (requests per window per IP)
const ROUTE_LIMITS: Record<string, number> = {
  '/api/approvals-logs': 10,  // Etherscan paid API — strict
  '/api/nfts':           10,  // Etherscan + Magic Eden — strict
  '/api/defi':           15,  // many RPC calls per request
  '/api/best-aprs':      12,  // calls many external APIs
  '/api/transactions':   20,
  '/api/portfolio-history': 20,
  '/api/token-exposure': 30,
  default:               60,
}

function getLimit(pathname: string): number {
  for (const [route, limit] of Object.entries(ROUTE_LIMITS)) {
    if (route !== 'default' && pathname.startsWith(route)) return limit
  }
  return ROUTE_LIMITS.default
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only rate-limit API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const ip    = getClientIp(req)
  const key   = `${ip}::${pathname}`
  const now   = Date.now()
  const limit = getLimit(pathname)

  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return addRateLimitHeaders(NextResponse.next(), 1, limit, now + WINDOW_MS)
  }

  entry.count++
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests', retryAfter }),
      {
        status: 429,
        headers: {
          'Content-Type':    'application/json',
          'Retry-After':     String(retryAfter),
          'X-RateLimit-Limit':     String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(Math.floor(entry.resetAt / 1000)),
        },
      }
    )
  }

  return addRateLimitHeaders(NextResponse.next(), entry.count, limit, entry.resetAt)
}

function addRateLimitHeaders(
  res: NextResponse,
  count: number,
  limit: number,
  resetAt: number,
): NextResponse {
  res.headers.set('X-RateLimit-Limit',     String(limit))
  res.headers.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)))
  res.headers.set('X-RateLimit-Reset',     String(Math.floor(resetAt / 1000)))
  return res
}

export const config = {
  matcher: '/api/:path*',
}
