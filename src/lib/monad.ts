/**
 * monad.ts — shared utilities for Monad Mainnet RPC.
 *
 * CoinGecko price fetching has been moved to lib/priceCache.ts.
 * getMonPrice() here is now a thin re-export that delegates to priceCache,
 * keeping backward compatibility with all existing call sites.
 */

// ─── RPC ─────────────────────────────────────────────────────────────────────

export const MONAD_RPC = 'https://rpc.monad.xyz'

/**
 * Send a JSON-RPC batch to the Monad node.
 * @param calls     Array of JSON-RPC call objects
 * @param timeoutMs AbortSignal timeout in ms (default 15 000)
 */
export async function rpcBatch(calls: object[], timeoutMs = 15_000): Promise<any[]> {
  if (!calls.length) return []
  const res = await fetch(MONAD_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(calls),
    cache:   'no-store',
    signal:  AbortSignal.timeout(timeoutMs),
  })
  const data = await res.json()
  return Array.isArray(data) ? data : [data]
}

// ─── balanceOf call builder ───────────────────────────────────────────────────

/** Build a JSON-RPC eth_call object for ERC-20 balanceOf(walletAddress). */
export function buildBalanceOfCall(
  tokenContract: string,
  walletAddress:  string,
  id:             string | number = tokenContract,
) {
  const paddedAddress = walletAddress.slice(2).toLowerCase().padStart(64, '0')
  return {
    jsonrpc: '2.0',
    method:  'eth_call',
    params:  [{ to: tokenContract, data: '0x70a08231' + paddedAddress }, 'latest'],
    id,
  }
}

// ─── KNOWN_TOKENS ─────────────────────────────────────────────────────────────

export interface KnownToken {
  symbol:      string
  name:        string
  contract:    string
  decimals:    number
  coingeckoId: string
  color:       string
}

export const KNOWN_TOKENS: KnownToken[] = [
  {
    symbol:      'USDC',
    name:        'USD Coin',
    contract:    '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    decimals:    6,
    coingeckoId: 'usd-coin',
    color:       '#2775CA',
  },
  {
    symbol:      'WETH',
    name:        'Wrapped ETH',
    contract:    '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242',
    decimals:    18,
    coingeckoId: 'ethereum',
    color:       '#627EEA',
  },
  {
    symbol:      'USDT',
    name:        'Tether USD',
    contract:    '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
    decimals:    6,
    coingeckoId: 'tether',
    color:       '#26A17B',
  },
  {
    symbol:      'WBTC',
    name:        'Wrapped BTC',
    contract:    '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
    decimals:    8,
    coingeckoId: 'wrapped-bitcoin',
    color:       '#F7931A',
  },
  {
    symbol:      'WMON',
    name:        'Wrapped MON',
    contract:    '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    decimals:    18,
    coingeckoId: 'monad',
    color:       '#836EF9',
  },
  {
    symbol:      'AUSD',
    name:        'Agora USD',
    contract:    '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    decimals:    6,
    coingeckoId: 'agora-dollar',
    color:       '#FF6B35',
  },
]

// ─── MON price ────────────────────────────────────────────────────────────────
// Delegated to lib/priceCache.ts — no longer calls CoinGecko directly.
// The shared 5-minute cache in priceCache eliminates duplicate calls from
// /api/defi, /api/nfts, /api/mon-price all firing concurrently.

export { getMonPrice } from '@/lib/priceCache'
