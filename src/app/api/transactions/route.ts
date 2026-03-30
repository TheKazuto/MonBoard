import { NextRequest, NextResponse } from 'next/server'
import { MONAD_RPC as RPC, rpcBatch } from '@/lib/monad'

export const revalidate = 0

async function rpc(method: string, params: any[], id = 1) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  const d = await r.json()
  return d.result
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const addrLower = address.toLowerCase()
  const apiKey = process.env.ETHERSCAN_API_KEY

  // ── PATH 1: Etherscan V2 (if API key is set) ────────────────────────────────
  if (apiKey && apiKey !== 'YourApiKeyToken') {
    try {
      // Use URL object so apiKey is set via searchParams, not string interpolation.
      // This prevents the key from appearing in raw template-literal log output.
      const buildEtherscanUrl = (module: string, action: string) => {
        const u = new URL('https://api.etherscan.io/v2/api')
        u.searchParams.set('chainid',    '143')
        u.searchParams.set('apikey',     apiKey)
        u.searchParams.set('module',     module)
        u.searchParams.set('action',     action)
        u.searchParams.set('address',    address)
        u.searchParams.set('startblock', '0')
        u.searchParams.set('endblock',   '99999999')
        u.searchParams.set('page',       '1')
        u.searchParams.set('offset',     '100')
        u.searchParams.set('sort',       'desc')
        return u.toString()
      }
      const [txRes, tokenRes] = await Promise.all([
        fetch(buildEtherscanUrl('account', 'txlist'),  { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
        fetch(buildEtherscanUrl('account', 'tokentx'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      ])
      const [txData, tokenData] = await Promise.all([txRes.json(), tokenRes.json()])

      if (txData.status === '1' || tokenData.status === '1') {
        const normalTxs = Array.isArray(txData.result) ? txData.result.map((tx: any) => ({
          hash: tx.hash,
          type: tx.from?.toLowerCase() === addrLower ? 'send' : 'receive',
          from: tx.from, to: tx.to,
          valueNative: (Number(tx.value) / 1e18).toFixed(6),
          symbol: 'MON',
          timestamp: Number(tx.timeStamp),
          isError: tx.isError === '1',
          functionName: tx.functionName || '',
        })) : []

        // Fix #8 (MÉDIO): Clamp tokenDecimal to [0, 36] to prevent Math.pow(10, 999)
        // returning Infinity when a malicious or malformed API response is received.
        const tokenTxs = Array.isArray(tokenData.result) ? tokenData.result.map((tx: any) => {
          const dec = Math.min(Math.max(0, Number(tx.tokenDecimal || 18)), 36)
          return {
            hash: tx.hash,
            type: tx.from?.toLowerCase() === addrLower ? 'send' : 'receive',
            from: tx.from, to: tx.to,
            valueNative: (Number(tx.value) / Math.pow(10, dec)).toFixed(4),
            symbol: tx.tokenSymbol || '?',
            timestamp: Number(tx.timeStamp),
            isError: false, isToken: true, functionName: '',
          }
        }) : []

        const all = [...normalTxs, ...tokenTxs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 100)
        return NextResponse.json({ transactions: all, source: 'etherscan' })
      }
    } catch (e) {
      console.error('[tx] etherscan error:', e instanceof Error ? e.message : e)
    }
  }

  // ── PATH 2: RPC — scan recent blocks for native MON + ERC-20 transfers ──────
  try {
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const paddedAddr = '0x000000000000000000000000' + addrLower.slice(2)

    // Get latest block
    const latestHex: string = await rpc('eth_blockNumber', [])
    const latest = parseInt(latestHex, 16)
    const SCAN_BLOCKS = 2000
    const fromBlock = '0x' + Math.max(0, latest - SCAN_BLOCKS).toString(16)

    // Fetch ERC-20 logs and native txs in parallel
    const [logsFromRes, logsToRes, nativeTxsRes] = await Promise.all([
      // ERC-20 sent
      rpc('eth_getLogs', [{ fromBlock, toBlock: 'latest', topics: [TRANSFER_TOPIC, paddedAddr] }]),
      // ERC-20 received
      rpc('eth_getLogs', [{ fromBlock, toBlock: 'latest', topics: [TRANSFER_TOPIC, null, paddedAddr] }]),
      // Native MON: scan blocks for txs involving this address
      fetchNativeTxs(addrLower, fromBlock, latest),
    ])

    // Collect unique blocks for timestamp resolution
    const allLogs = [
      ...((logsFromRes || []).map((l: any) => ({ ...l, direction: 'send' }))),
      ...((logsToRes   || []).map((l: any) => ({ ...l, direction: 'receive' }))),
    ]

    const blockNums = [...new Set([
      ...allLogs.map((l: any) => l.blockNumber),
      ...nativeTxsRes.map((t: any) => t.blockNumber),
    ])] as string[]

    // Resolve timestamps in a single batch (max 30 blocks)
    const blockTimestamps: Record<string, number> = {}
    const batchBlocks = blockNums.slice(0, 30)
    if (batchBlocks.length > 0) {
      const batchCalls = batchBlocks.map((bn, i) => ({
        jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: [bn, false], id: i,
      }))
      const batchResults = await rpcBatch(batchCalls).catch(() => [] as any[])
      for (let i = 0; i < batchBlocks.length; i++) {
        const block = batchResults.find((r: any) => r.id === i)?.result
        if (block) blockTimestamps[batchBlocks[i]] = parseInt(block.timestamp, 16)
      }
    }

    // Build ERC-20 txs
    const erc20Txs = allLogs.map((log: any) => ({
      hash: log.transactionHash,
      type: log.direction as 'send' | 'receive',
      from: log.direction === 'send' ? address : '0x' + log.topics[1]?.slice(26),
      to:   log.direction === 'receive' ? address : '0x' + log.topics[2]?.slice(26),
      valueNative: log.data === '0x' ? '0' : (Number(BigInt(log.data)) / 1e18).toFixed(6),
      symbol: 'TOKEN',
      timestamp: blockTimestamps[log.blockNumber] || 0,
      isError: false, isToken: true, functionName: '',
    }))

    // Build native txs
    const nativeTxs = nativeTxsRes.map((t: any) => ({
      hash: t.hash,
      type: (t.from?.toLowerCase() === addrLower ? 'send' : 'receive') as 'send' | 'receive',
      from: t.from, to: t.to,
      valueNative: (Number(BigInt(t.value || '0x0')) / 1e18).toFixed(6),
      symbol: 'MON',
      timestamp: blockTimestamps[t.blockNumber] || 0,
      isError: false, isToken: false, functionName: t.input === '0x' ? '' : 'contract call',
    }))

    const all = [...nativeTxs, ...erc20Txs]
      .filter((t, i, arr) => arr.findIndex(x => x.hash === t.hash) === i) // dedupe
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100)

    if (all.length > 0) {
      return NextResponse.json({ transactions: all, source: 'rpc' })
    }
  } catch (e) {
    console.error('[tx] rpc error:', e)
  }

  // Nothing found — return empty (not an error, just no activity)
  return NextResponse.json({ transactions: [], source: 'rpc_empty' })
}

// Fetch native MON transactions by scanning recent block receipts
async function fetchNativeTxs(addrLower: string, fromBlockHex: string, latestBlock: number): Promise<any[]> {
  try {
    const from = parseInt(fromBlockHex, 16)
    // Sample at most 50 block numbers spread across the range to stay fast
    const total = latestBlock - from
    const step  = Math.max(1, Math.floor(total / 50))
    const blockNums: number[] = []
    for (let b = latestBlock; b >= from && blockNums.length < 50; b -= step) {
      blockNums.push(b)
    }

    const results: any[] = []
    // Batch all block fetches into a single RPC call (respects Cloudflare 6-subrequest limit)
    const batchCalls = blockNums.map((bn, i) => ({
      jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['0x' + bn.toString(16), true], id: i,
    }))
    const blockResponses = await rpcBatch(batchCalls).catch(() => [] as any[])
    for (const resp of blockResponses) {
      const block = resp?.result
      if (!block) continue
      const txs: any[] = block.transactions ?? []
      for (const tx of txs) {
        if (
          tx.value && tx.value !== '0x0' &&
          (tx.from?.toLowerCase() === addrLower || tx.to?.toLowerCase() === addrLower)
        ) {
          results.push({
            hash:        String(tx.hash   ?? ''),
            from:        String(tx.from   ?? ''),
            to:          String(tx.to     ?? ''),
            value:       String(tx.value  ?? '0x0'),
            input:       tx.input === '0x' ? '0x' : tx.input,
            blockNumber: String(block.number ?? ''),
          })
        }
      }
    }

    return results
  } catch {
    return []
  }
}
