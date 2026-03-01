import { NextResponse } from 'next/server'

export const revalidate = 0

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeFetch(url: string, opts?: RequestInit): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      ...opts,
    })
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, text }
  } catch (e: any) {
    return { ok: false, status: 0, text: '', error: e.message }
  }
}

// Extract all <script src="..."> from HTML
function extractScriptUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const urls: string[] = []
  const srcRe = /<script[^>]+src=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = srcRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base.origin)
      urls.push(u.href)
    } catch { /* skip */ }
  }
  return [...new Set(urls)]
}

// Extract API patterns from JS bundle text
function extractApiPatterns(js: string, sourceUrl: string): DiscoveredEndpoint[] {
  const found: DiscoveredEndpoint[] = []
  const seen = new Set<string>()

  function add(url: string, kind: string, context: string) {
    const key = `${kind}::${url}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ url, kind, context: context.slice(0, 120).trim(), source: sourceUrl })
  }

  // 1. Full HTTPS URLs that look like APIs
  const httpsRe = /["'`](https?:\/\/[a-z0-9._\-\/]+(?:api|graphql|gql|rpc|v\d)[a-z0-9._\-\/]*(?:\?[^"'`\s]{0,100})?)["'`]/gi
  let m: RegExpExecArray | null
  while ((m = httpsRe.exec(js)) !== null) {
    const url = m[1]
    if (url.length > 10 && url.length < 300) {
      const ctx = js.slice(Math.max(0, m.index - 40), m.index + url.length + 40)
      add(url, 'https-api', ctx)
    }
  }

  // 2. Relative /api/... paths
  const relApiRe = /["'`](\/api\/[a-z0-9._\-\/]+)["'`]/gi
  while ((m = relApiRe.exec(js)) !== null) {
    const ctx = js.slice(Math.max(0, m.index - 40), m.index + m[1].length + 40)
    add(m[1], 'relative-api', ctx)
  }

  // 3. fetch( or axios.get( calls with URL
  const fetchRe = /(?:fetch|axios\.(?:get|post|put))\(\s*["'`]([^"'`\s]{5,200})["'`]/g
  while ((m = fetchRe.exec(js)) !== null) {
    const url = m[1]
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      const ctx = js.slice(Math.max(0, m.index - 20), m.index + url.length + 20)
      add(url, 'fetch-call', ctx)
    }
  }

  // 4. GraphQL endpoint patterns
  const gqlRe = /["'`]([^"'`\s]*graphql[^"'`\s]*)["'`]/gi
  while ((m = gqlRe.exec(js)) !== null) {
    const ctx = js.slice(Math.max(0, m.index - 40), m.index + m[1].length + 40)
    add(m[1], 'graphql', ctx)
  }

  // 5. WebSocket / WSS endpoints (for live price feeds)
  const wsRe = /["'`](wss?:\/\/[^"'`\s]{5,200})["'`]/g
  while ((m = wsRe.exec(js)) !== null) {
    const ctx = js.slice(Math.max(0, m.index - 40), m.index + m[1].length + 40)
    add(m[1], 'websocket', ctx)
  }

  // 6. Base URL variables: baseURL, apiUrl, API_URL, BASE_URL patterns
  const baseVarRe = /(?:baseURL|apiUrl|API_URL|BASE_URL|baseUrl|apiBase|API_BASE)\s*[:=]\s*["'`]([^"'`\s]{5,200})["'`]/g
  while ((m = baseVarRe.exec(js)) !== null) {
    const ctx = js.slice(Math.max(0, m.index - 20), m.index + m[1].length + 40)
    add(m[1], 'base-url-var', ctx)
  }

  // 7. Ethereum/EVM contract addresses (0x + 40 hex chars)
  const addrRe = /["'`](0x[a-fA-F0-9]{40})["'`]/g
  const addrs = new Set<string>()
  while ((m = addrRe.exec(js)) !== null) addrs.add(m[1].toLowerCase())
  if (addrs.size > 0 && addrs.size < 100) {
    for (const addr of addrs) {
      if (!seen.has(`contract::${addr}`)) {
        seen.add(`contract::${addr}`)
        found.push({ url: addr, kind: 'contract-address', context: '', source: sourceUrl })
      }
    }
  }

  return found
}

// Deduplicate and rank results
function deduplicate(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  const seen = new Set<string>()
  return endpoints.filter(e => {
    const key = e.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoveredEndpoint {
  url: string
  kind: string
  context: string
  source: string
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const params  = new URL(req.url).searchParams
  const target  = params.get('url')

  if (!target) {
    return NextResponse.json({
      error: 'Missing ?url= parameter',
      example: '/api/scan-protocol?url=https://app.curvance.com',
    }, { status: 400 })
  }

  let targetUrl: URL
  try { targetUrl = new URL(target) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const log: string[] = []
  const allEndpoints: DiscoveredEndpoint[] = []

  // Step 1: Fetch the main page HTML
  log.push(`Fetching ${targetUrl.href}...`)
  const page = await safeFetch(targetUrl.href)
  if (!page.ok) {
    return NextResponse.json({
      error: `Could not fetch page: HTTP ${page.status} — ${page.error ?? 'unknown'}`,
      url: targetUrl.href,
    }, { status: 502 })
  }
  log.push(`Page fetched — ${page.text.length} chars`)

  // Step 2: Extract API patterns directly from HTML (Next.js __NEXT_DATA__ etc.)
  if (page.text.includes('__NEXT_DATA__')) {
    log.push('Detected Next.js — extracting __NEXT_DATA__')
    const ndMatch = page.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (ndMatch) {
      const nextPatterns = extractApiPatterns(ndMatch[1], targetUrl.href + '#__NEXT_DATA__')
      allEndpoints.push(...nextPatterns)
      log.push(`__NEXT_DATA__: ${nextPatterns.length} patterns found`)
    }
  }

  // Also scan inline scripts
  const inlineRe = /<script(?:\s[^>]*)?>(?!.*src=)([\s\S]*?)<\/script>/gi
  let im: RegExpExecArray | null
  let inlineCount = 0
  while ((im = inlineRe.exec(page.text)) !== null) {
    const patterns = extractApiPatterns(im[1], targetUrl.href + '#inline')
    allEndpoints.push(...patterns)
    inlineCount += patterns.length
  }
  if (inlineCount > 0) log.push(`Inline scripts: ${inlineCount} patterns found`)

  // Step 3: Find all external JS bundle URLs
  const scriptUrls = extractScriptUrls(page.text, targetUrl.href)
  log.push(`Found ${scriptUrls.length} script tags`)

  // Prioritize JS files that are likely app bundles (not analytics/tracking)
  const appBundles = scriptUrls.filter(u => {
    const lower = u.toLowerCase()
    return !lower.includes('gtag') && !lower.includes('analytics') &&
           !lower.includes('intercom') && !lower.includes('hotjar') &&
           !lower.includes('sentry') && !lower.includes('crisp')
  }).slice(0, 12) // limit to 12 bundles to keep response time reasonable

  log.push(`Scanning ${appBundles.length} app bundles...`)

  // Step 4: Fetch and scan each bundle in parallel
  const bundleResults = await Promise.allSettled(
    appBundles.map(async (scriptUrl) => {
      const res = await safeFetch(scriptUrl)
      if (!res.ok || res.text.length < 100) return []
      const patterns = extractApiPatterns(res.text, scriptUrl)
      log.push(`  ${scriptUrl.split('/').pop()}: ${patterns.length} patterns`)
      return patterns
    })
  )

  for (const r of bundleResults) {
    if (r.status === 'fulfilled') allEndpoints.push(...r.value)
  }

  // Step 5: Deduplicate and categorize
  const deduped = deduplicate(allEndpoints)

  const apis       = deduped.filter(e => e.kind !== 'contract-address').sort((a, b) => a.url.localeCompare(b.url))
  const contracts  = deduped.filter(e => e.kind === 'contract-address')

  // Filter noise: skip RPC nodes, block explorers, and unrelated infra
  const NOISE_DOMAINS = [
    'etherscan.io', 'arbiscan.io', 'bscscan.com', 'polygonscan.com', 'snowtrace.io',
    'ftmscan.com', 'celoscan.io', 'basescan.org', 'fraxscan.com', 'gnosisscan.io',
    'moonscan.io', 'aurorascan.dev', 'mantlescan.xyz', 'routescan.io', 'oklink.com',
    'drpc.org', 'thirdweb.com', 'blastapi.io', 'nodies.app', 'ankr.com',
    'arbitrum.io', 'avax.network', 'polygon.technology', 'zksync.io', 'moonbeam.network',
    'plume.org', 'taiko.xyz', 'inkonchain.com', 'megaeth.com', 'tac.build', 'corn-rpc.com',
    'xdcrpc.com', 'xinfin.network', 'gnosischain.com', 'expchain.ai', 'stratareth',
    'era.zksync.io', '1rpc.io', 'kavascan.com', 'freshping.io', 'governance.aave.com',
  ]
  const NOISE_PATTERNS = ['/rpc', '.rpc.', 'rpc.', '/etherscan', 'gasstation', 'blockexplorer']

  function isNoise(url: string): boolean {
    try {
      const u = new URL(url.startsWith('/') ? targetUrl.origin + url : url)
      if (NOISE_DOMAINS.some(d => u.hostname.endsWith(d))) return true
      if (NOISE_PATTERNS.some(p => url.includes(p))) return true
      // Skip pure RPC endpoints (no path beyond /rpc or empty)
      if (u.pathname === '/rpc' || u.pathname === '' || u.pathname === '/') return true
    } catch { /* keep */ }
    return false
  }

  const relevantApis = apis.filter(e => !isNoise(e.url))

  // Group APIs by base domain for readability
  const byDomain: Record<string, DiscoveredEndpoint[]> = {}
  for (const e of relevantApis) {
    let domain: string
    try { domain = new URL(e.url.startsWith('/') ? targetUrl.origin + e.url : e.url).hostname } catch { domain = 'relative' }
    if (!byDomain[domain]) byDomain[domain] = []
    byDomain[domain].push(e)
  }

  return NextResponse.json({
    scanned: targetUrl.href,
    summary: {
      bundlesScanned: appBundles.length,
      totalEndpointsRaw: apis.length,
      totalEndpointsFiltered: relevantApis.length,
      contractAddresses: contracts.length,
    },
    apiEndpoints: byDomain,
    contractAddresses: contracts.map(c => c.url),
    log,
  })
}
