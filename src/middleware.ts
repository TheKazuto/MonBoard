import { NextRequest, NextResponse } from 'next/server'

// ─── CORS allowed origins ─────────────────────────────────────────────────────
// API routes are called only by the MonBoard frontend.
// Requests from any other origin are blocked at the CORS layer.
const ALLOWED_ORIGINS = new Set([
  'https://monboard.pro',
  'https://www.monboard.pro',
])

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true  // same-origin requests (no Origin header) are allowed
  if (ALLOWED_ORIGINS.has(origin)) return true
  // Allow localhost in non-production for local development
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true
  return false
}

// Simple in-memory rate limiter for API routes.
// Runs on the Edge runtime — no extra dependency needed.
// Limits: 60 requests / minute per IP across all /api/ routes.
// Stricter limits for expensive routes (approvals-logs, nfts, defi).
//
// NOTE: This in-memory store resets on cold start. For production deployments
// with multiple Cloudflare Workers instances, use Durable Objects or KV for
// a persistent store shared across instances.

interface RateEntry { count: number; resetAt: number }
const store = new Map<string, RateEntry>()

const WINDOW_MS = 60_000  // 1-minute sliding window

// Per-route limits (requests per window per IP)
const ROUTE_LIMITS: Record<string, number> = {
  '/api/approvals-logs':   10,  // Etherscan paid API — strict
  '/api/nfts':             10,  // OpenSea API — strict
  '/api/defi':             15,  // many RPC calls per request
  '/api/best-aprs':        12,  // calls many external APIs
  '/api/transactions':     20,
  '/api/portfolio-history': 20,
  '/api/token-exposure':   30,
  // Debug/internal routes — very strict, should be removed before final deploy
  '/api/debug-protocols':  3,
  '/api/debug-kuru':       3,
  '/api/debug-upshift':    3,
  '/api/scan-protocol':    3,
  default:                 60,
}

function getLimit(pathname: string): number {
  for (const [route, limit] of Object.entries(ROUTE_LIMITS)) {
    if (route !== 'default' && pathname.startsWith(route)) return limit
  }
  return ROUTE_LIMITS.default
}

// Fix #3 (ALTO): Prioritise cf-connecting-ip (Cloudflare's authoritative header)
// to prevent IP spoofing via x-forwarded-for manipulation.
// cf-connecting-ip is set by Cloudflare itself and cannot be spoofed by clients.
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only apply to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) {
      return new NextResponse(null, { status: 403 })
    }
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  origin ?? '',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age':       '86400',
      },
    })
  }

  // Block cross-origin GET requests from untrusted origins
  if (origin && !isAllowedOrigin(origin)) {
    return new NextResponse(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const ip    = getClientIp(req)
  const key   = `${ip}::${pathname}`
  const now   = Date.now()
  const limit = getLimit(pathname)

  // Fix #10 (BAIXO): Evict expired entries when store grows too large to prevent
  // unbounded memory growth in long-lived Worker instances.
  if (store.size > 10_000) {
    for (const [k, v] of store) {
      if (now > v.resetAt) store.delete(k)
    }
  }

  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return addCorsAndRateLimitHeaders(NextResponse.next(), 1, limit, now + WINDOW_MS, origin)
  }

  entry.count++
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    const res = new NextResponse(
      JSON.stringify({ error: 'Too many requests', retryAfter }),
      {
        status: 429,
        headers: {
          'Content-Type':          'application/json',
          'Retry-After':           String(retryAfter),
          'X-RateLimit-Limit':     String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(Math.floor(entry.resetAt / 1000)),
        },
      }
    )
    if (origin && isAllowedOrigin(origin)) res.headers.set('Access-Control-Allow-Origin', origin)
    return res
  }

  return addCorsAndRateLimitHeaders(NextResponse.next(), entry.count, limit, entry.resetAt, origin)
}

function addCorsAndRateLimitHeaders(
  res: NextResponse,
  count: number,
  limit: number,
  resetAt: number,
  origin: string | null,
): NextResponse {
  res.headers.set('X-RateLimit-Limit',     String(limit))
  res.headers.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)))
  res.headers.set('X-RateLimit-Reset',     String(Math.floor(resetAt / 1000)))
  if (origin && isAllowedOrigin(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin)
  }
  return res
}

export const config = {
  matcher: '/api/:path*',
}
