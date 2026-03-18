import { NextRequest, NextResponse } from 'next/server'
import { KNOWN_TOKENS, rpcBatch, buildBalanceOfCall } from '@/lib/monad'
import { getAllPrices } from '@/lib/priceCache'

export const revalidate = 0

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    // ── 1. Fetch MON native balance + all ERC-20 balances (single RPC batch) ──
    const erc20Calls = KNOWN_TOKENS.map((t) => buildBalanceOfCall(t.contract, address))
    const nativeCall = {
      jsonrpc: '2.0',
      method:  'eth_getBalance',
      params:  [address, 'latest'],
      id:      'native',
    }

    // ── 2. Fetch prices from shared cache in parallel with RPC ────────────────
    // getAllPrices() reads the 5-minute shared cache — no CoinGecko call unless expired.
    const [allResults, priceData] = await Promise.all([
      rpcBatch([nativeCall, ...erc20Calls]),
      getAllPrices(),
    ])

    const nativeRes      = allResults[0]
    const erc20Responses = allResults.slice(1)

    // ── 3. Parse balances ─────────────────────────────────────────────────────
    const rawMON = nativeRes?.result
      ? Number(BigInt(nativeRes.result)) / 1e18
      : 0

    const tokenBalances = KNOWN_TOKENS.map((token, i) => {
      const raw = erc20Responses[i]?.result
      if (!raw || raw === '0x' || raw === '0x0') return { ...token, balance: 0 }
      const balance = Number(BigInt(raw)) / Math.pow(10, token.decimals)
      return { ...token, balance }
    })

    // ── 4. Build token list with USD values ───────────────────────────────────
    const { prices, images } = priceData
    const monPrice = prices['monad'] ?? 0
    const monValue = rawMON * monPrice

    const tokens: {
      symbol: string; name: string; balance: number
      price: number; value: number; color: string; imageUrl: string
    }[] = []

    if (rawMON > 0.0001) {
      tokens.push({
        symbol:   'MON',
        name:     'Monad',
        balance:  rawMON,
        price:    monPrice,
        value:    monValue,
        color:    '#836EF9',
        imageUrl: images['monad'] ?? '',
      })
    }

    for (const token of tokenBalances) {
      const price = prices[token.coingeckoId] ?? 0
      const value = token.balance * price
      if (token.balance > 0.0001 || value > 0.01) {
        tokens.push({
          symbol:   token.symbol,
          name:     token.name,
          balance:  token.balance,
          price,
          value,
          color:    token.color,
          imageUrl: images[token.coingeckoId] ?? '',
        })
      }
    }

    // ── 5. Sort + percentages ─────────────────────────────────────────────────
    tokens.sort((a, b) => b.value - a.value)
    const totalValue = tokens.reduce((sum, t) => sum + t.value, 0)

    return NextResponse.json({
      tokens: tokens.map(t => ({
        ...t,
        percentage: totalValue > 0 ? (t.value / totalValue) * 100 : 0,
      })),
      totalValue,
      address,
    })
  } catch (err) {
    console.error('[token-exposure] error:', err)
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }
}
