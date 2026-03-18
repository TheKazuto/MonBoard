'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ArrowLeftRight, ChevronDown, RefreshCw, Info,
  CheckCircle, XCircle, Loader, ExternalLink, Search, X
} from 'lucide-react'
import { useWallet } from '@/contexts/WalletContext'
import { useSendTransaction, useChainId, useSwitchChain } from 'wagmi'
import { encodeFunctionData } from 'viem'
import { SORA } from '@/lib/styles'

// ─── INTEGRATOR CONFIG ────────────────────────────────────────────────────────
// Set NEXT_PUBLIC_FEE_RECEIVER in .env.local to your wallet address to earn 0.2% swap fees
// Leave unset to disable fee collection (swap will still work normally)
// Fix #10 (MÉDIO): Removed the hardcoded fallback wallet address.
// When NEXT_PUBLIC_FEE_RECEIVER is not set, fee collection is simply disabled.
// This prevents the developer's wallet address from appearing in the public bundle.
const FEE_RECEIVER = process.env.NEXT_PUBLIC_FEE_RECEIVER ?? ''
const FEE_PERCENT  = 0.2
const REFERRER     = 'monboard'
const NATIVE       = '0x0000000000000000000000000000000000000000'

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Chain {
  id:   number
  name: string       // "ETH", "MONAD", etc — used in Rubic API
  type: string       // "EVM", "SOLANA", etc
}

interface Token {
  symbol:   string
  name:     string
  address:  string
  decimals: number
  logoURI:  string
  chainId?: number
}

// ─── CHAIN DISPLAY HELPERS ───────────────────────────────────────────────────
// Map Rubic chain name → CoinGecko token list platform slug
// tokens.coingecko.com/{platform}/all.json — free, no API key, logos included
const COINGECKO_PLATFORM: Record<string, string> = {
  ETH:       'ethereum',
  BSC:       'binance-smart-chain',
  POLYGON:   'polygon-pos',
  AVALANCHE: 'avalanche',
  ARBITRUM:  'arbitrum-one',
  OPTIMISM:  'optimistic-ethereum',
  BASE:      'base',
  SOLANA:    'solana',
  FANTOM:    'fantom',
  AURORA:    'aurora',
  CELO:      'celo',
  HARMONY:   'harmony-shard-0',
  MOONBEAM:  'moonbeam',
  MOONRIVER: 'moonriver',
  CRONOS:    'cronos',
  GNOSIS:    'xdai',
  KLAYTN:    'klay-token',
  BOBA:      'boba',
  OKT:       'okex-chain',
  TELOS:     'telos',
  FUSE:      'fuse',
  IOTEX:     'iotex',
  TRON:      'tron',
  NEAR:      'near-protocol',
  LINEA:     'linea',
  ZKSYNC:    'zksync',
  SCROLL:    'scroll',
  MANTLE:    'mantle',
  BLAST:     'blast',
  METIS:     'metis-andromeda',
  ZK_FAIR:   'zkfair',
  MONAD:     'monad',   // served via GeckoTerminal (not CoinGecko token list)
}

// ─── LOGO CDN SOURCES ────────────────────────────────────────────────────────
const TW_BASE  = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains'
const UNI_BASE = 'https://raw.githubusercontent.com/Uniswap/assets/master/blockchains'
const LLAMA    = 'https://icons.llamao.fi/icons/chains'

// DefiLlama slugs — 100% coverage confirmed (ETH, BSC, Monad, zkSync, Avalanche, all chains)
const LLAMA_SLUG: Record<string, string> = {
  ETH: 'ethereum',       BSC: 'binance',          POLYGON: 'polygon',
  ARBITRUM: 'arbitrum',  OPTIMISM: 'optimism',     BASE: 'base',
  AVALANCHE: 'avalanche', SOLANA: 'solana',        MONAD: 'monad',
  FANTOM: 'fantom',      CRONOS: 'cronos',         GNOSIS: 'gnosis',
  CELO: 'celo',          HARMONY: 'harmony',       MOONBEAM: 'moonbeam',
  MOONRIVER: 'moonriver', AURORA: 'aurora',        BOBA: 'boba',
  METIS: 'metis',        LINEA: 'linea',           ZKSYNC: 'zksync%20era',
  SCROLL: 'scroll',      MANTLE: 'mantle',         BLAST: 'blast',
  KLAYTN: 'klaytn',      KAVA: 'kava',             IOTEX: 'iotex',
  TON: 'ton',            NEAR: 'near',             TRON: 'tron',
  BITCOIN: 'bitcoin',    FUSE: 'fuse',             OKT: 'okexchain',
  ROOTSTOCK: 'rootstock', FLARE: 'flare',          TELOS: 'telos',
}

// TrustWallet slugs — fallback (AVALANCHE missing, ZKSYNC uses wrong slug)
const TW_CHAIN_SLUG: Record<string, string> = {
  ETH: 'ethereum',   BSC: 'smartchain', POLYGON: 'polygon',
  ARBITRUM: 'arbitrum', OPTIMISM: 'optimism', BASE: 'base',
  SOLANA: 'solana',  FANTOM: 'fantom',  CRONOS: 'cronos',
  GNOSIS: 'xdai',    CELO: 'celo',      HARMONY: 'harmony',
  MOONBEAM: 'moonbeam', MOONRIVER: 'moonriver', AURORA: 'aurora',
  BOBA: 'boba',      METIS: 'metis',    LINEA: 'linea',
  SCROLL: 'scroll',  MANTLE: 'mantle',  BLAST: 'blast',
  MONAD: 'monad',
}

// CoinGecko CDN overrides for well-known tokens by symbol
const CG = 'https://assets.coingecko.com/coins/images'
const OVERRIDE_LOGOS: Record<string, string> = {
  ETH:  `${CG}/279/small/ethereum.png`,
  WETH: `${CG}/2518/small/weth.png`,
  USDC: `${CG}/6319/small/usdc.png`,
  USDT: `${CG}/325/small/tether.png`,
  WBTC: `${CG}/7598/small/wrapped_bitcoin_new.png`,
  BNB:  `${CG}/825/small/bnb-icon2_2x.png`,
  WBNB: `${CG}/825/small/bnb-icon2_2x.png`,
  POL:  `${CG}/4713/small/polygon-ecosystem-token.png`,
  MATIC:`${CG}/4713/small/polygon-ecosystem-token.png`,
  AVAX: `${CG}/12559/small/Avalanche_Circle_RedWhite_Trans.png`,
  SOL:  `${CG}/4128/small/solana.png`,
  // Monad - use the official purple M logo from their brand kit / TW chain logo
  MON:  `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/monad/info/logo.png`,
  WMON: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/monad/info/logo.png`,
  ARB:  `${CG}/16547/small/arb.jpg`,
  OP:   `${CG}/25244/small/Optimism.png`,
  FTM:  `${CG}/4001/small/fantom.png`,
  NEAR: `${CG}/10365/small/near.jpg`,
  ATOM: `${CG}/1481/small/cosmos_hub.png`,
  DAI:  `${CG}/9956/small/Badge_Dai.png`,
  LINK: `${CG}/877/small/chainlink-new-logo.png`,
  UNI:  `${CG}/12504/small/uniswap-logo.png`,
  AAVE: `${CG}/12645/small/AAVE.png`,
  CRV:  `${CG}/12124/small/Curve.png`,
  MKR:  `${CG}/1364/small/Mark_Maker.png`,
  SNX:  `${CG}/3408/small/SNX.png`,
  COMP: `${CG}/10775/small/COMP.png`,
  GRT:  `${CG}/13397/small/Graph_Token.png`,
  LDO:  `${CG}/13573/small/Lido_DAO.png`,
  RPL:  `${CG}/2090/small/rocket_pool__rpl_.png`,
  DOGE: `${CG}/5/small/dogecoin.png`,
  SHIB: `${CG}/11939/small/shiba.png`,
  PEPE: `${CG}/29850/small/pepe-token.jpeg`,
  TRX:  `${CG}/1094/small/tron-logo.png`,
  TON:  `${CG}/17980/small/ton_symbol.png`,
  SUI:  `${CG}/26375/small/sui_asset.jpeg`,
  APT:  `${CG}/26455/small/aptos_round.png`,
  INJ:  `${CG}/23182/small/injective.jpeg`,
  SEI:  `${CG}/28205/small/Sei_Logo_-_Transparent.png`,
  TIA:  `${CG}/31967/small/celestia.jpg`,
}

// Build ordered list of logo URLs to try for a token
function buildLogoUrls(token: Token, chainName: string): string[] {
  const urls: string[] = []
  const symUpper = token.symbol.toUpperCase()
  const addr = token.address
  const isNative = addr === NATIVE

  // 1. Symbol override (CoinGecko CDN for well-known tokens) — most reliable
  if (OVERRIDE_LOGOS[symUpper]) urls.push(OVERRIDE_LOGOS[symUpper])

  // 2. logoURI from the token list (CoinGecko token list or GeckoTerminal image_url)
  if (token.logoURI && token.logoURI !== '' && !token.logoURI.includes('missing')) {
    urls.push(token.logoURI)
  }

  // Skip address-based CDNs for native tokens (address is 0x000...000)
  if (!isNative && addr && addr.length === 42) {
    const twSlug = TW_CHAIN_SLUG[chainName]

    // 3. 1inch token logo CDN — covers ETH, BSC, Polygon, Arbitrum, Optimism, Base etc.
    // Massive coverage: ~100k tokens, just needs lowercase address
    urls.push(`https://tokens.1inch.io/${addr.toLowerCase()}.png`)

    // 4. TrustWallet by contract address
    if (twSlug) {
      urls.push(`${TW_BASE}/${twSlug}/assets/${addr}/logo.png`)
    }

    // 5. Uniswap assets repo
    if (twSlug) {
      urls.push(`${UNI_BASE}/${twSlug}/assets/${addr}/logo.png`)
    }
  }

  // Deduplicate while preserving order
  return [...new Set(urls.filter(Boolean))]
}

// Native tokens per chain
const NATIVE_TOKENS: Record<string, Token> = {
  ETH:       { symbol: 'ETH',  name: 'Ethereum',  address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.ETH },
  BSC:       { symbol: 'BNB',  name: 'BNB',       address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.BNB },
  POLYGON:   { symbol: 'POL',  name: 'Polygon',   address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.POL },
  AVALANCHE: { symbol: 'AVAX', name: 'Avalanche', address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.AVAX },
  ARBITRUM:  { symbol: 'ETH',  name: 'Ethereum',  address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.ETH },
  OPTIMISM:  { symbol: 'ETH',  name: 'Ethereum',  address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.ETH },
  BASE:      { symbol: 'ETH',  name: 'Ethereum',  address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.ETH },
  SOLANA:    { symbol: 'SOL',  name: 'Solana',    address: NATIVE, decimals: 9,  logoURI: OVERRIDE_LOGOS.SOL },
  MONAD:     { symbol: 'MON',  name: 'Monad',     address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.MON },
  FANTOM:    { symbol: 'FTM',  name: 'Fantom',    address: NATIVE, decimals: 18, logoURI: OVERRIDE_LOGOS.FTM },
}

// Returns ordered list of URLs to try for a chain logo
function chainLogoUrls(chainName: string): string[] {
  const urls: string[] = []
  const llamaSlug = LLAMA_SLUG[chainName]
  if (llamaSlug) urls.push(`${LLAMA}/rsz_${llamaSlug}.jpg`)
  const twSlug = TW_CHAIN_SLUG[chainName]
  if (twSlug) urls.push(`${TW_BASE}/${twSlug}/info/logo.png`)
  return urls
}
// Kept for chain selectors that pass src= directly (single URL compat)
function chainLogoUrl(chainName: string): string {
  return chainLogoUrls(chainName)[0] ?? ''
}

// ─── IMAGE WITH MULTI-SOURCE FALLBACK ────────────────────────────────────────
// Inner component — receives a fixed urls array and tries each in sequence
function TokenImageInner({ urls, symbol, size }: { urls: string[]; symbol: string; size: number }) {
  const [idx, setIdx] = useState(0)

  const avatar = (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{
        width: size, height: size,
        background: `hsl(${((([...symbol].reduce((h,c) => c.charCodeAt(0)+((h<<5)-h),0)) % 360)+360)%360}, 60%, 50%)`,
        fontSize: size * 0.38
      }}>
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  )

  if (idx >= urls.length || !urls[idx]) return avatar

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={urls[idx]}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
      onError={() => setIdx(i => i + 1)}
    />
  )
}

// Outer wrapper — uses `key` to force full remount (and idx reset) when token changes
function TokenImage({
  token, chainName, src, symbol, size = 28
}: {
  token?: Token; chainName?: string; src?: string; symbol: string; size?: number
}) {
  const urls = token && chainName ? buildLogoUrls(token, chainName) : src ? [src] : []
  const stableKey = (token?.address ?? src ?? symbol) + (chainName ?? '')
  return <TokenImageInner key={stableKey} urls={urls} symbol={symbol} size={size} />
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────
// Cache for token lists with TTL — avoid re-fetching same chain within session
const TOKEN_CACHE_TTL = 5 * 60 * 1000  // 5 minutes
const tokenListCache: Record<string, { tokens: Token[]; ts: number }> = {}

async function loadTokensForChain(chainName: string): Promise<Token[]> {
  const cached = tokenListCache[chainName]
  if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL) return cached.tokens

  const native = NATIVE_TOKENS[chainName]
  const platform = COINGECKO_PLATFORM[chainName]

  if (!platform) {
    // Chain not mapped yet — return just native token
    const result = native ? [native] : []
    tokenListCache[chainName] = { tokens: result, ts: Date.now() }
    return result
  }

  try {
    const res = await fetch(`/api/token-list?platform=${platform}`)
    if (!res.ok) throw new Error('failed')
    const data: { tokens: Token[] } = await res.json()

    // Apply logo overrides for known tokens, add native first
    // Guard: skip tokens with missing symbol or address to prevent client-side crash
    const tokens = data.tokens
      .filter(t => t.address && t.symbol)
      .map(t => ({
        ...t,
        symbol:  t.symbol  ?? '',
        name:    t.name    ?? t.symbol ?? '',
        address: t.address ?? '',
        logoURI: OVERRIDE_LOGOS[(t.symbol ?? '').toUpperCase()] ?? t.logoURI ?? '',
      }))

    const result = native ? [native, ...tokens] : tokens
    tokenListCache[chainName] = { tokens: result, ts: Date.now() }
    return result
  } catch {
    const result = native ? [native] : []
    tokenListCache[chainName] = { tokens: result, ts: Date.now() }
    return result
  }
}

// Fetch all supported chains from Rubic
// Module-level cache — list is static per session, no need to re-fetch on navigation
let cachedChains: Chain[] | null = null

async function loadChains(): Promise<Chain[]> {
  if (cachedChains) return cachedChains
  try {
    const res = await fetch('https://api-v2.rubic.exchange/api/info/chains?includeTestnets=false')
    if (!res.ok) throw new Error('failed')
    const data: Chain[] = await res.json()
    // Filter to EVM + Solana, exclude testnets, sort by familiarity
    const priority = ['ETH','BSC','POLYGON','ARBITRUM','OPTIMISM','BASE','AVALANCHE','MONAD','SOLANA','FANTOM']
    cachedChains = data
      .filter(c => !c.name.includes('TEST') && ['EVM','SOLANA','TON','BITCOIN'].includes(c.type))
      .sort((a, b) => {
        const ai = priority.indexOf(a.name)
        const bi = priority.indexOf(b.name)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.name.localeCompare(b.name)
      })
    return cachedChains
  } catch {
    // Fallback to minimal list — do NOT cache fallback so next mount can retry
    return [
      { id: 1, name: 'ETH', type: 'EVM' },
      { id: 56, name: 'BSC', type: 'EVM' },
      { id: 137, name: 'POLYGON', type: 'EVM' },
      { id: 42161, name: 'ARBITRUM', type: 'EVM' },
      { id: 10, name: 'OPTIMISM', type: 'EVM' },
      { id: 8453, name: 'BASE', type: 'EVM' },
      { id: 43114, name: 'AVALANCHE', type: 'EVM' },
      { id: 143, name: 'MONAD', type: 'EVM' },
    ]
  }
}

// Default slippage tolerance per swap type (in %)
const SLIPPAGE_ON_CHAIN  = 1    // 1% for same-chain DEX swaps
const SLIPPAGE_CROSS     = 2    // 2% for cross-chain bridges

interface Quote {
  id: string
  estimate: {
    destinationTokenAmount: string   // may be human-readable OR wei — we handle both
    destinationUsdAmount: number
    durationInMinutes: number
    priceImpact: number | null
  }
  fees: { gasTokenFees: { protocol: { fixedUsdAmount: number } } }
  // Rubic v2 uses different field names depending on route type
  provider?:     string   // on-chain routes
  type?:         string   // alternative field name
  providerType?: string   // another alternative
  tradeType?:    string   // yet another alternative
}

// ── Shared fee payload — evaluated once at module load ───────────────────────
const FEE_PARTS = FEE_RECEIVER ? { fee: FEE_PERCENT, feeTarget: FEE_RECEIVER } : {}

// Builds the common fields shared by both quoteBest and swap endpoints
function buildRubicBody(
  srcChain: string, srcToken: Token, srcAmount: string,
  dstChain: string, dstToken: Token, slippageTolerance: number,
) {
  return {
    srcTokenAddress: srcToken.address, srcTokenBlockchain: srcChain,
    srcTokenAmount: srcAmount,
    dstTokenAddress: dstToken.address, dstTokenBlockchain: dstChain,
    referrer: REFERRER,
    ...FEE_PARTS,
    slippageTolerance,
  }
}

async function fetchQuote(
  srcChain: string, srcToken: Token, srcAmount: string,
  dstChain: string, dstToken: Token, slippageTolerance: number,
): Promise<Quote> {
  const res = await fetch('https://api-v2.rubic.exchange/api/routes/quoteBest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRubicBody(srcChain, srcToken, srcAmount, dstChain, dstToken, slippageTolerance)),
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function fetchSwapTx(
  srcChain: string, srcToken: Token, srcAmount: string,
  dstChain: string, dstToken: Token,
  fromAddress: string, quoteId: string, receiver: string,
  slippageTolerance: number,
) {
  const res = await fetch('https://api-v2.rubic.exchange/api/routes/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...buildRubicBody(srcChain, srcToken, srcAmount, dstChain, dstToken, slippageTolerance),
      fromAddress, id: quoteId, receiver,
    }),
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<{ transaction: { to: string; data: string; value: string; approvalAddress?: string } }>
}

const ERC20_APPROVE_ABI = [{
  name: 'approve', type: 'function',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

type TxStatus = 'idle' | 'approving' | 'swapping' | 'pending' | 'success' | 'error'

const QUOTE_EXPIRY = 60  // seconds before a quote is considered stale

// ─── CHAIN SELECTOR MODAL ─────────────────────────────────────────────────────
function ChainModal({ chains, onSelect, onClose }: {
  chains: Chain[]; onSelect: (c: Chain) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = chains.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-semibold text-gray-800" style={SORA}>Select Network</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
            <Search size={14} className="text-gray-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search network…"
              className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400" />
          </div>
        </div>
        <div className="overflow-y-auto max-h-72 px-3 pb-4">
          {filtered.map(c => (
            <button key={c.name} onClick={() => { onSelect(c); onClose() }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-violet-50 transition-colors text-left">
              <TokenImageInner urls={chainLogoUrls(c.name)} symbol={c.name} size={32} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{c.name}</p>
                <p className="text-xs text-gray-400">{c.type}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── TOKEN SELECTOR MODAL ─────────────────────────────────────────────────────
function TokenModal({ chainName, onSelect, onClose }: {
  chainName: string; onSelect: (t: Token) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTokensForChain(chainName).then(t => { setTokens(t); setLoading(false) })
  }, [chainName])

  // Guard: null-safe toLowerCase — tokens from API may have missing fields
  const ql = q.toLowerCase()
  const filtered = tokens.filter(t =>
    (t.symbol  ?? '').toLowerCase().includes(ql) ||
    (t.name    ?? '').toLowerCase().includes(ql) ||
    (t.address ?? '').toLowerCase() === ql
  ).slice(0, 80) // cap for performance

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="font-semibold text-gray-800" style={SORA}>Select Token</h3>
            <p className="text-xs text-gray-400">{chainName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
            <Search size={14} className="text-gray-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search by name, symbol or address…"
              className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400" />
          </div>
        </div>
        <div className="overflow-y-auto max-h-72 px-3 pb-4">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
              <Loader size={14} className="animate-spin" /> Loading tokens…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No tokens found</p>
          )}
          {!loading && filtered.map(token => (
            <button key={token.address} onClick={() => { onSelect(token); onClose() }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-violet-50 transition-colors text-left">
              <TokenImage token={token} chainName={chainName} symbol={token.symbol} size={36} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{token.symbol}</p>
                <p className="text-xs text-gray-400 truncate">{token.name}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
// Public RPC endpoints per Rubic chain name (client-side balance fetching)
// Gas buffer per chain for MAX button (in native token units)
// Conservative estimate based on typical gas cost at normal gas prices
const CHAIN_GAS_BUFFER: Record<string, number> = {
  ETH:       0.003,   // ~$9 @ $3000 ETH — covers complex DEX swaps
  ARBITRUM:  0.001,   // ~$3 — L2, cheaper
  OPTIMISM:  0.001,
  BASE:      0.001,
  ZKSYNC:    0.001,
  LINEA:     0.001,
  SCROLL:    0.001,
  BLAST:     0.001,
  MANTLE:    0.5,     // MNT is cheap
  BSC:       0.003,   // BNB ~$0.90
  POLYGON:   0.5,     // POL/MATIC is cheap
  AVALANCHE: 0.01,    // AVAX ~$0.40
  FANTOM:    1.0,     // FTM is cheap
  CRONOS:    0.5,
  GNOSIS:    0.1,
  CELO:      0.05,
  MOONBEAM:  0.05,
  MOONRIVER: 0.05,
  METIS:     0.005,
  MONAD:     0.01,    // MON — conservative
  SOLANA:    0.01,    // SOL — ~$0.002 fees
}

const CHAIN_RPC: Record<string, string> = {
  ETH:       'https://ethereum-rpc.publicnode.com',
  BSC:       'https://bsc-rpc.publicnode.com',
  POLYGON:   'https://polygon-rpc.com',
  ARBITRUM:  'https://arb1.arbitrum.io/rpc',
  OPTIMISM:  'https://mainnet.optimism.io',
  BASE:      'https://mainnet.base.org',
  AVALANCHE: 'https://api.avax.network/ext/bc/C/rpc',
  MONAD:     'https://rpc.monad.xyz',
  FANTOM:    'https://rpc.ftm.tools',
  GNOSIS:    'https://rpc.gnosischain.com',
  CELO:      'https://forno.celo.org',
  LINEA:     'https://rpc.linea.build',
  SCROLL:    'https://rpc.scroll.io',
  MANTLE:    'https://rpc.mantle.xyz',
  BLAST:     'https://rpc.blast.io',
  ZKSYNC:    'https://mainnet.era.zksync.io',
  CRONOS:    'https://evm.cronos.org',
  MOONBEAM:  'https://rpc.api.moonbeam.network',
  MOONRIVER: 'https://rpc.api.moonriver.moonbeam.network',
  METIS:     'https://andromeda.metis.io/?owner=1088',
  KLAYTN:    'https://public-en-baobab.klaytn.net',
  FUSE:      'https://rpc.fuse.io',
  KAVA:      'https://evm.kava.io',
}

// Block explorer tx URL per chain
const CHAIN_EXPLORER: Record<string, string> = {
  ETH:       'https://etherscan.io/tx',
  BSC:       'https://bscscan.com/tx',
  POLYGON:   'https://polygonscan.com/tx',
  ARBITRUM:  'https://arbiscan.io/tx',
  OPTIMISM:  'https://optimistic.etherscan.io/tx',
  BASE:      'https://basescan.org/tx',
  AVALANCHE: 'https://snowtrace.io/tx',
  MONAD:     'https://monadexplorer.com/tx',
  SOLANA:    'https://solscan.io/tx',
  FANTOM:    'https://ftmscan.com/tx',
  GNOSIS:    'https://gnosisscan.io/tx',
  LINEA:     'https://lineascan.build/tx',
  SCROLL:    'https://scrollscan.com/tx',
  MANTLE:    'https://explorer.mantle.xyz/tx',
  BLAST:     'https://blastscan.io/tx',
  ZKSYNC:    'https://explorer.zksync.io/tx',
  CRONOS:    'https://cronoscan.com/tx',
  METIS:     'https://andromeda-explorer.metis.io/tx',
  CELO:      'https://celoscan.io/tx',
  MOONBEAM:  'https://moonscan.io/tx',
  MOONRIVER: 'https://moonriver.moonscan.io/tx',
  FUSE:      'https://explorer.fuse.io/tx',
  KAVA:      'https://explorer.kava.io/tx',
}

// Rubic chain name → EVM chain ID (for wagmi chain switching)
const CHAIN_ID: Record<string, number> = {
  ETH: 1, BSC: 56, POLYGON: 137, ARBITRUM: 42161, OPTIMISM: 10,
  BASE: 8453, AVALANCHE: 43114, MONAD: 143, FANTOM: 250,
  GNOSIS: 100, CELO: 42220, LINEA: 59144, SCROLL: 534352,
  MANTLE: 5000, BLAST: 81457, ZKSYNC: 324, CRONOS: 25,
  MOONBEAM: 1284, MOONRIVER: 1285, METIS: 1088, FUSE: 122, KAVA: 2222,
}

const USDC_MONAD: Token = {
  symbol: 'USDC', name: 'USD Coin', decimals: 6,
  address: '0x754704bc059f8c67012fed69bc8a327a5aafb603',
  logoURI: OVERRIDE_LOGOS.USDC,
}

const ETH_CHAIN: Chain = { id: 1, name: 'ETH', type: 'EVM' }
const MONAD_CHAIN: Chain = { id: 143, name: 'MONAD', type: 'EVM' }

export default function SwapPage() {
  const { address, isConnected } = useWallet()
  const connectedChainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [chains, setChains] = useState<Chain[]>([])
  const [fromChain, setFromChain] = useState<Chain>(MONAD_CHAIN)
  const [toChain,   setToChain]   = useState<Chain>(MONAD_CHAIN)
  const [fromToken, setFromToken] = useState<Token>(NATIVE_TOKENS.MONAD)
  const [toToken,   setToToken]   = useState<Token>(USDC_MONAD)
  const [amount,    setAmount]    = useState('')
  const [receiver,  setReceiver]  = useState('')
  const [slippage,  setSlippage]  = useState(SLIPPAGE_ON_CHAIN) // user-configurable
  const [showSlippage, setShowSlippage] = useState(false)

  const [quote,        setQuote]        = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError,   setQuoteError]   = useState<string | null>(null)

  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txHash,   setTxHash]   = useState<string | null>(null)
  const [txError,  setTxError]  = useState<string | null>(null)

  const [modal, setModal] = useState<'fromToken' | 'toToken' | 'fromChain' | 'toChain' | null>(null)
  const [quoteAge,   setQuoteAge]   = useState(0)   // seconds since last quote
  const [receiverError, setReceiverError] = useState<string | null>(null)

  const validateReceiver = useCallback((val: string): boolean => {
    if (!val.trim()) return true  // empty = use sender wallet, always valid
    // EVM address: 0x + 40 hex chars. Solana: base58 32-44 chars (handled loosely)
    const isEVM = /^0x[0-9a-fA-F]{40}$/.test(val.trim())
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val.trim())
    const valid = isEVM || (toChain.type === 'SOLANA' ? isSol : false)
    setReceiverError(valid ? null : 'Invalid address format')
    return valid
  }, [toChain.type])
  const quoteAgeRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCleanupRef = useRef<(() => void) | null>(null)

  // ── Token balance via RPC (works for any chain, no wagmi dependency) ────────
  const [fromBalance, setFromBalance] = useState<number | null>(null)

  useEffect(() => {
    setFromBalance(null)
    if (!address || !isConnected) return
    const rpc = CHAIN_RPC[fromChain.name]
    if (!rpc) return

    const controller = new AbortController()
    const isNative = fromToken.address === NATIVE

    async function fetchBal() {
      try {
        let raw: bigint
        if (isNative) {
          const res = await fetch(rpc, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
          })
          const d = await res.json()
          raw = BigInt(d.result ?? '0x0')
        } else {
          // balanceOf(address) — selector 0x70a08231
          const padded = address!.replace('0x', '').padStart(64, '0')
          const res = await fetch(rpc, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'eth_call',
              params: [{ to: fromToken.address, data: '0x70a08231' + padded }, 'latest'],
            }),
          })
          const d = await res.json()
          raw = BigInt(d.result && d.result !== '0x' ? d.result : '0x0')
        }
        const decimals = fromToken.decimals ?? 18
        setFromBalance(Number(raw) / Math.pow(10, decimals))
      } catch { /* aborted or network error — leave null */ }
    }

    fetchBal()
    return () => controller.abort()
  }, [address, isConnected, fromChain.name, fromToken.address, fromToken.decimals])

  const fromBalanceDisplay = fromBalance !== null
    ? fromBalance < 0.0001 && fromBalance > 0
      ? '<0.0001'
      : fromBalance.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : null

  function handleMax() {
    if (fromBalance === null) return
    const isNative = fromToken.address === NATIVE
    const buffer = isNative ? (CHAIN_GAS_BUFFER[fromChain.name] ?? 0.002) : 0
    const maxAmt = Math.max(0, fromBalance - buffer)
    if (maxAmt <= 0) { setAmount(''); return }
    // Truncate to token decimals (avoid float precision exceeding real balance)
    const dec = Math.min(fromToken.decimals ?? 18, 8) // cap display at 8 decimals
    const truncated = Math.floor(maxAmt * Math.pow(10, dec)) / Math.pow(10, dec)
    setAmount(truncated > 0 ? truncated.toString() : '')
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { sendTransactionAsync } = useSendTransaction()

  // Load chain list on mount
  useEffect(() => { loadChains().then(setChains) }, [])

  // Cancel any in-flight status poll when component unmounts
  useEffect(() => {
    return () => { pollCleanupRef.current?.() }
  }, [])

  // Quote age ticker — runs while a quote is active
  useEffect(() => {
    if (quote) {
      setQuoteAge(0)
      quoteAgeRef.current = setInterval(() => setQuoteAge(a => a + 1), 1000)
    } else {
      if (quoteAgeRef.current) clearInterval(quoteAgeRef.current)
      setQuoteAge(0)
    }
    return () => { if (quoteAgeRef.current) clearInterval(quoteAgeRef.current) }
  }, [quote])

  const quoteExpired = quoteAge >= QUOTE_EXPIRY

  // Quote with debounce
  const getQuote = useCallback(async (amt: string) => {
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) { setQuote(null); return }
    setQuoteLoading(true); setQuoteError(null)
    try {
      setQuote(await fetchQuote(fromChain.name, fromToken, amt, toChain.name, toToken, slippage))
    } catch {
      setQuoteError('No route found for this pair')
      setQuote(null)
    } finally { setQuoteLoading(false) }
  }, [fromChain, fromToken, toChain, toToken, slippage])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => getQuote(amount), 700)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [amount, getQuote])

  function flipDirection() {
    setFromChain(toChain); setToChain(fromChain)
    setFromToken(toToken); setToToken(fromToken)
    setAmount(''); setQuote(null)
  }

  // Fix #6: Parse swap amount into raw bigint for exact ERC-20 approval
  function parseSwapAmount(amt: string, decimals: number): bigint {
    try {
      const parsed = parseFloat(amt)
      if (isNaN(parsed) || parsed <= 0) return 0n
      // Add 0.5% buffer to handle minor rounding between quote and execution
      const withBuffer = parsed * 1.005
      return BigInt(Math.floor(withBuffer * Math.pow(10, decimals)))
    } catch { return 0n }
  }

  // Fix #7: Validate the transaction object returned by Rubic before signing.
  // Checks: (1) `to` is a valid EVM address, (2) `data` starts with 0x,
  // (3) `value` is not astronomically larger than the expected swap value.
  function validateRubicTransaction(
    tx: { to: string; data: string; value?: string; approvalAddress?: string },
    swapAmount: string,
    decimals: number,
  ): boolean {
    const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/
    const HEX_DATA = /^0x[0-9a-fA-F]*$/

    if (!EVM_ADDR.test(tx.to))   return false
    if (!HEX_DATA.test(tx.data)) return false

    // approvalAddress, if present, must also be a valid address
    if (tx.approvalAddress && !EVM_ADDR.test(tx.approvalAddress)) return false

    // The native value sent must not exceed the swap amount by more than 5x
    // (accounts for bridge fees, gas topups, etc.)
    if (tx.value && tx.value !== '0') {
      try {
        const valueBig   = BigInt(tx.value)
        const amountBig  = parseSwapAmount(swapAmount, decimals)
        const maxAllowed = amountBig * 5n
        if (amountBig > 0n && valueBig > maxAllowed) return false
      } catch { return false }
    }

    return true
  }

  async function executeSwap() {
    if (!address || !quote || !amount || quoteExpired) return
    if (receiver.trim() && !validateReceiver(receiver)) return
    setTxStatus('idle'); setTxError(null)
    try {
      const recv = receiver.trim() || address

      // Step 1: For ERC-20 tokens, check and approve allowance BEFORE calling Rubic swap
      // Rubic validates allowance server-side — if insufficient it returns 400 (code 3001)
      if (fromToken.address !== NATIVE) {
        setTxStatus('approving')
        // Read on-chain allowance for the Rubic router
        const RUBIC_ROUTER = '0x3335733c454805df6a77f825f266e136FB4a3333'
        const allowanceData = encodeFunctionData({
          abi: [{
            name: 'allowance', type: 'function', stateMutability: 'view',
            inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          }] as const,
          functionName: 'allowance',
          args: [address as `0x${string}`, RUBIC_ROUTER as `0x${string}`],
        })
        const requiredAmount = parseSwapAmount(amount, fromToken.decimals)

        // Fetch allowance via RPC
        let currentAllowance = 0n
        try {
          const rpcUrl = CHAIN_RPC[fromChain.name] ?? 'https://rpc.monad.xyz'
          const rpcRes = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'eth_call',
              params: [{ to: fromToken.address, data: allowanceData }, 'latest'],
            }),
          })
          const rpcJson = await rpcRes.json()
          if (rpcJson.result && rpcJson.result !== '0x') {
            currentAllowance = BigInt(rpcJson.result)
          }
        } catch { /* assume 0 allowance */ }

        if (currentAllowance < requiredAmount) {
          await sendTransactionAsync({
            to: fromToken.address as `0x${string}`,
            data: encodeFunctionData({
              abi: ERC20_APPROVE_ABI, functionName: 'approve',
              args: [RUBIC_ROUTER as `0x${string}`, requiredAmount],
            }),
          })
          // Wait a moment for the approval to propagate
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      // Step 2: Now fetch swap tx (Rubic will see the allowance)
      setTxStatus('swapping')
      const { transaction } = await fetchSwapTx(
        fromChain.name, fromToken, amount,
        toChain.name, toToken,
        address, quote.id, recv, slippage,
      )
      // Approval already handled above — validate and execute swap tx
      if (!validateRubicTransaction(transaction, amount, fromToken.decimals)) {
        throw new Error('Suspicious transaction — rejected for your safety')
      }
      const hash = await sendTransactionAsync({
        to:    transaction.to as `0x${string}`,
        data:  transaction.data as `0x${string}`,
        value: transaction.value ? BigInt(transaction.value) : 0n,
      })
      setTxHash(hash); setTxStatus('pending')
      let attempts = 0
      let pollTimer: ReturnType<typeof setTimeout> | null = null
      let cancelled = false
      const stopPoll = () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer) }
      pollCleanupRef.current = stopPoll

      const checkReceipt = async (): Promise<'success' | 'reverted' | null> => {
        try {
          const rpcUrl = CHAIN_RPC[fromChain.name] ?? 'https://rpc.monad.xyz'
          const r = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt',
              params: [hash],
            }),
          })
          const json = await r.json()
          const receipt = json?.result
          if (!receipt) return null // not mined yet
          // status "0x1" = success, "0x0" = reverted
          return receipt.status === '0x1' ? 'success' : 'reverted'
        } catch { return null }
      }

      const poll = async () => {
        if (cancelled) return
        try {
          // For same-chain swaps, check receipt directly (Rubic status API doesn't track these reliably)
          const receiptStatus = await checkReceipt()
          if (receiptStatus === 'success') { setTxStatus('success'); return }
          if (receiptStatus === 'reverted') {
            setTxStatus('error'); setTxError('Transaction reverted on-chain'); return
          }

          // Also check Rubic status (mainly useful for cross-chain)
          const isCross = fromChain.name !== toChain.name
          if (isCross) {
            const r = await fetch(`https://api-v2.rubic.exchange/api/info/status?srcTxHash=${hash}`)
            const d = await r.json()
            if (d.status === 'SUCCESS') { setTxStatus('success'); return }
            if (['FAIL','REVERT','REVERTED'].includes(d.status)) {
              setTxStatus('error'); setTxError('Transaction reverted on-chain'); return
            }
          }
        } catch {}
        if (!cancelled && attempts++ < 60) pollTimer = setTimeout(poll, 3000)
        else if (!cancelled) {
          // After max attempts, check receipt one last time
          const finalStatus = await checkReceipt()
          if (finalStatus === 'success') setTxStatus('success')
          else setTxStatus('error')
        }
      }
      poll()
    } catch (e: any) {
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed')
      setTxStatus('error')
    }
  }

  const dstAmount = useMemo(() => {
    if (!quote) return ''
    const raw = Number(quote.estimate.destinationTokenAmount)
    if (isNaN(raw) || raw === 0) return '0'
    const decimals = toToken.decimals ?? 18
    // Use BigInt for wei values to avoid JS Number precision loss (> 2^53)
    // Detect wei: if string has no decimal point AND integer value > 10^(dec-8)
    const rawStr = String(quote.estimate.destinationTokenAmount).trim()
    const isWei = !rawStr.includes('.') && raw > Math.pow(10, Math.max(0, decimals - 8))
    let human: number
    if (isWei) {
      // Safe BigInt division preserving up to 8 significant decimal places
      const bigRaw  = BigInt(rawStr)
      const bigDiv  = BigInt(10 ** Math.max(0, decimals - 8))
      const shifted = Number(bigRaw / bigDiv)
      human = shifted / 1e8
    } else {
      human = raw
    }
    // Format nicely: fewer decimals for large values, more for small
    if (human >= 1000)  return human.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (human >= 1)     return human.toFixed(4)
    if (human >= 0.001) return human.toFixed(6)
    return human.toExponential(4)
  }, [quote, toToken.decimals])
  const isCrossChain   = fromChain.name !== toChain.name
  const expectedChainId = CHAIN_ID[fromChain.name]
  const wrongChain = isConnected && !!expectedChainId && connectedChainId !== expectedChainId
  const canSwap = isConnected && !!quote && !quoteExpired && !!amount && txStatus === 'idle' && !wrongChain

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-200">
            <ArrowLeftRight size={17} className="text-white" />
          </div>
          <h1 className="font-bold text-2xl text-gray-900" style={SORA}>Cross-chain Swap</h1>
        </div>
        <p className="text-sm text-gray-500 ml-12">
          Cross-chain swaps across {chains.length > 0 ? `${chains.length}+` : '70+'} chains · Best rate from 360+ DEXes &amp; bridges
        </p>
      </div>

      <div className="card p-5 space-y-3">

        {/* FROM */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">From</span>
            <button onClick={() => setModal('fromChain')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors text-xs font-medium text-gray-700">
              <TokenImageInner urls={chainLogoUrls(fromChain.name)} symbol={fromChain.name} size={16} />
              {fromChain.name}
              <ChevronDown size={11} className="text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setModal('fromToken')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors shrink-0">
              <TokenImage token={fromToken} chainName={fromChain.name} symbol={fromToken.symbol} size={24} />
              <span className="font-semibold text-gray-800 text-sm">{fromToken.symbol}</span>
              <ChevronDown size={13} className="text-gray-400" />
            </button>
            <div className="flex-1 flex flex-col items-end gap-1 min-w-0">
              <input type="number" min="0" placeholder="0.00" value={amount}
                onChange={e => {
                  const v = e.target.value
                  if (v === '' || Number(v) > 0) setAmount(v)
                }}
                className="w-full bg-transparent text-right text-2xl font-semibold text-gray-800 outline-none placeholder-gray-300" />
              {isConnected && fromBalanceDisplay !== null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">
                    Balance: <span className="text-gray-500 font-medium">{fromBalanceDisplay} {fromToken.symbol}</span>
                  </span>
                  <button
                    onClick={handleMax}
                    className="text-xs font-semibold text-violet-500 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 px-1.5 py-0.5 rounded transition-colors"
                  >
                    MAX
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-1">
          <button onClick={flipDirection}
            className="w-9 h-9 rounded-xl bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50 flex items-center justify-center transition-all hover:rotate-180 duration-300 shadow-sm">
            <ArrowLeftRight size={15} className="text-violet-500" />
          </button>
        </div>

        {/* TO */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">To</span>
            <button onClick={() => setModal('toChain')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors text-xs font-medium text-gray-700">
              <TokenImageInner urls={chainLogoUrls(toChain.name)} symbol={toChain.name} size={16} />
              {toChain.name}
              <ChevronDown size={11} className="text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setModal('toToken')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors shrink-0">
              <TokenImage token={toToken} chainName={toChain.name} symbol={toToken.symbol} size={24} />
              <span className="font-semibold text-gray-800 text-sm">{toToken.symbol}</span>
              <ChevronDown size={13} className="text-gray-400" />
            </button>
            <div className="flex-1 text-right">
              {quoteLoading ? (
                <div className="flex items-center justify-end gap-1.5 text-gray-400">
                  <RefreshCw size={13} className="animate-spin" />
                  <span className="text-sm">Finding route…</span>
                </div>
              ) : dstAmount ? (
                <>
                  <span className="text-2xl font-semibold text-gray-800">{dstAmount}</span>
                  {quote && <p className="text-xs text-gray-400 mt-0.5">≈ ${(quote.estimate.destinationUsdAmount ?? 0).toFixed(2)}</p>}
                </>
              ) : (
                <span className="text-2xl font-semibold text-gray-300">0.00</span>
              )}
            </div>
          </div>
        </div>

        {/* Receiver (cross-chain) */}
        {isCrossChain && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide block mb-1.5">
              Receiver <span className="normal-case text-gray-300">(optional, defaults to your wallet)</span>
            </label>
            <input type="text" value={receiver}
              onChange={e => { setReceiver(e.target.value); setReceiverError(null) }}
              onBlur={e => { if (e.target.value.trim()) validateReceiver(e.target.value) }}
              placeholder={address ?? '0x…'}
              className={`w-full bg-transparent text-sm outline-none placeholder-gray-300 font-mono ${receiverError ? 'text-red-500' : 'text-gray-700'}`} />
            {receiverError && <p className="text-xs text-red-400 mt-1">{receiverError}</p>}
          </div>
        )}

        {/* Route details */}
        {quote && !quoteLoading && (
          <div className={`rounded-xl border divide-y text-sm ${quoteExpired ? 'border-amber-200 bg-amber-50/60 divide-amber-100/60' : 'border-violet-100 bg-violet-50/50 divide-violet-100/60'}`}>
            {quoteExpired && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-amber-600 font-medium text-xs">Quote expired — refresh before swapping</span>
                <button
                  onClick={() => getQuote(amount)}
                  className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 bg-white border border-violet-200 px-2 py-1 rounded-lg transition-colors">
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>
            )}
            {!quoteExpired && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-gray-400">Quote valid for</span>
                <span className={`text-xs font-medium ${quoteAge > 45 ? 'text-amber-500' : 'text-gray-500'}`}>{Math.max(0, 60 - quoteAge)}s</span>
              </div>
            )}
            {quote.estimate.priceImpact !== null && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Price impact</span>
                <span className={`font-medium ${Math.abs(quote.estimate.priceImpact ?? 0) > 3 ? 'text-red-500' : 'text-gray-700'}`}>
                  {(quote.estimate.priceImpact ?? 0).toFixed(2)}%
                </span>
              </div>
            )}
            {isCrossChain && (quote.fees?.gasTokenFees?.protocol?.fixedUsdAmount ?? 0) > 0 && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-gray-500">Protocol fee</span>
                <span className="font-medium text-gray-700">${(quote.fees?.gasTokenFees?.protocol?.fixedUsdAmount ?? 0).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center px-4 py-2.5 relative">
              <span className="text-gray-500">Slippage tolerance</span>
              <button
                onClick={() => setShowSlippage(s => !s)}
                className="font-medium text-violet-600 hover:text-violet-800 underline decoration-dotted underline-offset-2 transition-colors"
              >
                {slippage}%
              </button>
              {showSlippage && (
                <div className="absolute right-4 top-10 z-20 bg-white border border-violet-200 rounded-xl shadow-lg p-3 flex flex-col gap-2 min-w-[180px]">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Set slippage</p>
                  <div className="flex gap-1.5">
                    {[0.5, 1, 2, 3, 5].map(v => (
                      <button
                        key={v}
                        onClick={() => { setSlippage(v); setShowSlippage(false) }}
                        className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-all ${
                          slippage === v
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-violet-300'
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={slippage}
                      onChange={e => {
                        const v = parseFloat(e.target.value)
                        if (!isNaN(v) && v > 0 && v <= 50) setSlippage(v)
                      }}
                      className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-center focus:outline-none focus:border-violet-300"
                    />
                    <span className="text-xs text-gray-400">%</span>
                    <button
                      onClick={() => setShowSlippage(false)}
                      className="text-xs font-semibold text-violet-600 hover:text-violet-800"
                    >
                      Done
                    </button>
                  </div>
                  {slippage > 5 && (
                    <p className="text-xs text-amber-500 mt-0.5">High slippage may result in unfavorable rates</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-gray-500">Route</span>
              <span className="font-medium text-violet-600 capitalize">
                {(quote.provider ?? quote.type ?? quote.providerType ?? quote.tradeType ?? '—')
                  .replace(/_/g, ' ').replace(/-/g, ' ').toLowerCase()}
              </span>
            </div>
          </div>
        )}

        {/* Quote error */}
        {quoteError && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-500">
            <XCircle size={14} /> {quoteError}
          </div>
        )}

        {/* CTA */}
        {!isConnected ? (
          <div className="text-center py-2"><p className="text-sm text-gray-400">Connect your wallet to swap</p></div>
        ) : wrongChain ? (
          <button
            onClick={() => expectedChainId && switchChain({ chainId: expectedChainId })}
            className="w-full py-3.5 rounded-xl font-semibold text-white transition-all duration-200 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', boxShadow: '0 4px 16px rgba(245,158,11,0.35)' }}>
            Switch to {fromChain.name} network
          </button>
        ) : txStatus === 'success' ? (
          <div className="flex flex-col items-center gap-2 py-3">
            <div className="flex items-center gap-2 text-emerald-600 font-medium">
              <CheckCircle size={18} /> Swap successful!
            </div>
            {txHash && (
              <a href={`${CHAIN_EXPLORER[fromChain.name] ?? 'https://monadexplorer.com/tx'}/${txHash}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-1">
                View on {fromChain.name} explorer <ExternalLink size={11} />
              </a>
            )}
            <button onClick={() => { setTxStatus('idle'); setTxHash(null); setAmount(''); setQuote(null) }}
              className="mt-1 text-sm text-gray-500 hover:text-gray-700 underline">New swap</button>
          </div>
        ) : txStatus === 'error' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-500">
              <XCircle size={14} /> {txError ?? 'Transaction failed'}
            </div>
            <button onClick={() => { setTxStatus('idle'); setTxError(null) }}
              className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Try again
            </button>
          </div>
        ) : (
          <button onClick={executeSwap} disabled={!canSwap || txStatus !== 'idle'}
            className="w-full py-3.5 rounded-xl font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: canSwap ? 'linear-gradient(135deg, #836EF9 0%, #6d28d9 100%)' : '#e5e7eb',
              color: canSwap ? 'white' : '#9ca3af',
              boxShadow: canSwap ? '0 4px 16px rgba(131,110,249,0.35)' : 'none',
            }}>
            {txStatus === 'approving' && <><Loader size={16} className="animate-spin" /> Approving…</>}
            {txStatus === 'swapping'  && <><Loader size={16} className="animate-spin" /> Sending…</>}
            {txStatus === 'pending'   && <><Loader size={16} className="animate-spin" /> Confirming…</>}
            {txStatus === 'idle' && (quoteLoading ? 'Finding best route…' : !amount ? 'Enter an amount' : !quote ? 'No route found' : quoteExpired ? 'Quote expired — refresh' : 'Swap')}
          </button>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Swaps execute directly on-chain via{' '}
          <a href="https://rubic.exchange" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-600">Rubic</a>
          {' '}— MonBoard never holds your funds.
        </span>
      </div>

      {/* Modals */}
      {modal === 'fromChain' && (
        <ChainModal chains={chains} onSelect={c => {
          setFromChain(c)
          setFromToken(NATIVE_TOKENS[c.name] ?? { symbol: c.name, name: c.name, address: NATIVE, decimals: 18, logoURI: chainLogoUrl(c.name) })
          setQuote(null)
        }} onClose={() => setModal(null)} />
      )}
      {modal === 'toChain' && (
        <ChainModal chains={chains} onSelect={c => {
          setToChain(c)
          setToToken(NATIVE_TOKENS[c.name] ?? { symbol: c.name, name: c.name, address: NATIVE, decimals: 18, logoURI: chainLogoUrl(c.name) })
          setQuote(null)
        }} onClose={() => setModal(null)} />
      )}
      {modal === 'fromToken' && (
        <TokenModal chainName={fromChain.name} onSelect={t => { setFromToken(t); setQuote(null) }} onClose={() => setModal(null)} />
      )}
      {modal === 'toToken' && (
        <TokenModal chainName={toChain.name} onSelect={t => { setToToken(t); setQuote(null) }} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
