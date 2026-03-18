import { NextRequest, NextResponse } from 'next/server'

export const revalidate = 0

const SUPPORTED_CHAINS = new Set([143, 1, 56, 137, 42161, 10, 8453])

// Fix #2 (CRÍTICO): Strict validation for all parameters before forwarding to Etherscan.
// Previously, topic0/topic1/fromBlock/toBlock were passed without any format validation,
// allowing arbitrary values to reach the Etherscan API and potentially poison logs.

/** topic must be exactly 0x + 64 hex chars (a 32-byte keccak hash) */
const TOPIC_RE  = /^0x[0-9a-fA-F]{64}$/

/** block number: either a positive integer or the string "latest" */
const BLOCK_RE  = /^(0x[0-9a-fA-F]+|[0-9]+|latest)$/

function validateTopic(v: string | null): v is string {
  return !!v && TOPIC_RE.test(v)
}

function validateBlock(v: string): boolean {
  return BLOCK_RE.test(v)
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const chainId   = Number(searchParams.get('chainId'))
  const topic0    = searchParams.get('topic0') ?? ''
  const topic1    = searchParams.get('topic1') ?? ''
  const fromBlock = searchParams.get('fromBlock') ?? '0'
  const toBlock   = searchParams.get('toBlock')   ?? 'latest'

  // ── Chain validation (already existed) ────────────────────────────────────
  if (!SUPPORTED_CHAINS.has(chainId)) {
    return NextResponse.json({ status: '0', message: 'Unsupported chain', result: [] }, { status: 400 })
  }

  // ── Fix #2: Validate topic format (0x + 64 hex chars) ─────────────────────
  if (!validateTopic(topic0) || !validateTopic(topic1)) {
    return NextResponse.json({ status: '0', message: 'Invalid topic format', result: [] }, { status: 400 })
  }

  // ── Fix #2: Validate block numbers ────────────────────────────────────────
  if (!validateBlock(fromBlock) || !validateBlock(toBlock)) {
    return NextResponse.json({ status: '0', message: 'Invalid block parameter', result: [] }, { status: 400 })
  }

  const apiKey = process.env.ETHERSCAN_API_KEY
  if (!apiKey) {
    return NextResponse.json({ status: '0', message: 'Service not configured', result: [] }, { status: 500 })
  }

  // Etherscan V2 unified endpoint — one key works for all 60+ chains.
  // The API key is set via searchParams (query string) as required by Etherscan v2.
  const url = new URL('https://api.etherscan.io/v2/api')
  url.searchParams.set('chainid',      String(chainId))
  url.searchParams.set('apikey',       apiKey)
  url.searchParams.set('module',       'logs')
  url.searchParams.set('action',       'getLogs')
  url.searchParams.set('topic0',       topic0)
  url.searchParams.set('topic1',       topic1)
  url.searchParams.set('topic0_1_opr', 'and')
  url.searchParams.set('fromBlock',    fromBlock)
  url.searchParams.set('toBlock',      toBlock)
  url.searchParams.set('page',         '1')
  url.searchParams.set('offset',       '1000')

  try {
    const res  = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e: unknown) {
    // Fix #9: Never expose internal error messages to the client
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[approvals-logs] chainId:', chainId, 'error:', msg)
    return NextResponse.json({ status: '0', message: 'Upstream service error', result: [] }, { status: 502 })
  }
}
