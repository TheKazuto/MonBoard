'use client'

import { useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { usePortfolio } from '@/contexts/PortfolioContext'
import type { TokenData, NFTData } from '@/contexts/PortfolioContext'
import {
  Coins, Image as ImageIcon, RefreshCw, Wallet,
  ExternalLink, LayoutGrid, List,
} from 'lucide-react'
import PortfolioHistory from '@/components/PortfolioHistory'
import AdBanner from '@/components/AdBanner'
import { SORA } from '@/lib/styles'
import { fmtUSD } from '@/lib/format'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtBal(b: number) {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)}M`
  if (b >= 1_000)     return `${(b / 1_000).toFixed(2)}K`
  if (b >= 1)         return b.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return b.toFixed(6)
}

// Sanitize NFT/token image URLs before rendering in <img> tags.
// NFT metadata comes from arbitrary on-chain URIs — defense-in-depth against
// malicious javascript: or data: URIs injected via NFT metadata.
const SAFE_IMAGE_ORIGIN = /^https:\/\//i
function sanitizeImgSrc(url: string | null | undefined): string | null {
  if (!url) return null
  return SAFE_IMAGE_ORIGIN.test(url) ? url : null
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-xl ${className}`} />
}

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-gray-50">
          <div className="w-9 h-9 rounded-full bg-gray-100 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-gray-100 rounded w-28" />
            <div className="h-2.5 bg-gray-50 rounded w-16" />
          </div>
          <div className="h-3.5 w-20 bg-gray-100 rounded" />
          <div className="h-3.5 w-16 bg-gray-100 rounded hidden md:block" />
          <div className="h-3.5 w-14 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

function NFTGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden border border-gray-100">
          <div className="aspect-square bg-gray-100" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-gray-100 rounded w-3/4" />
            <div className="h-2.5 bg-gray-50 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center text-violet-300">{icon}</div>
      <p className="text-sm text-gray-400 font-medium">{title}</p>
      {subtitle && <p className="text-xs text-gray-300">{subtitle}</p>}
    </div>
  )
}

function TokenRow({ token }: { token: TokenData }) {
  return (
    <tr className="hover:bg-violet-50/40 transition-colors">
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden shadow-sm" style={{ background: token.color }}>
            {token.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={sanitizeImgSrc(token.imageUrl) ?? undefined} alt={token.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display='none' }} />
              : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">{token.symbol.slice(0,2)}</div>
            }
          </div>
          <div>
            <p className="font-semibold text-gray-800 text-sm">{token.symbol}</p>
            <p className="text-xs text-gray-400">{token.name}</p>
          </div>
        </div>
      </td>
      <td className="py-3.5 px-3 text-right font-mono text-sm text-gray-700">
        {token.price < 0.01 ? `$${token.price.toFixed(6)}` : token.price < 1 ? `$${token.price.toFixed(4)}` : `$${token.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </td>
      <td className="py-3.5 px-3 text-right text-sm text-gray-600 hidden md:table-cell">{fmtBal(token.balance)}</td>
      <td className="py-3.5 px-3 text-right font-semibold text-sm text-gray-800">{fmtUSD(token.value)}</td>
      <td className="py-3.5 px-3 hidden lg:table-cell">
        <div className="flex items-center gap-2 justify-end">
          <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(token.percentage, 100)}%`, background: token.color }} />
          </div>
          <span className="text-xs text-gray-400 w-10 text-right">{token.percentage.toFixed(1)}%</span>
        </div>
      </td>
    </tr>
  )
}

function NFTCard({ nft }: { nft: NFTData }) {
  const [imgErr, setImgErr] = useState(false)
  return (
    // Fix #1: was nft.magicEdenUrl — migrated to OpenSea
    <a href={nft.openSeaUrl} target="_blank" rel="noopener noreferrer"
      className="border border-violet-100 rounded-xl overflow-hidden hover:border-violet-300 hover:shadow-md transition-all group block">
      <div className="aspect-square bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center overflow-hidden">
        {nft.image && !imgErr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={sanitizeImgSrc(nft.image) ?? undefined} alt={nft.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={() => setImgErr(true)} />
          : <div className="flex flex-col items-center gap-1.5 text-violet-300"><ImageIcon size={28} /><span className="text-xs">{nft.symbol || '?'}</span></div>
        }
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-violet-700 transition-colors">{nft.name}</p>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-gray-400 truncate">{nft.collection}</p>
          <ExternalLink size={10} className="text-gray-300 group-hover:text-violet-400 shrink-0 ml-1" />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-50">
          {nft.floorUSD > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Floor</span>
              <div className="text-right">
                <span className="text-xs font-semibold text-violet-700">{fmtUSD(nft.floorUSD)}</span>
                {nft.floorMON > 0 && <p className="text-xs text-gray-400">{nft.floorMON.toFixed(2)} MON</p>}
              </div>
            </div>
          ) : (
            <span className="text-xs text-gray-300">No floor price</span>
          )}
        </div>
      </div>
    </a>
  )
}

function NFTListRow({ nft }: { nft: NFTData }) {
  const [imgErr, setImgErr] = useState(false)
  return (
    // Fix #1: was nft.magicEdenUrl — migrated to OpenSea
    <a href={nft.openSeaUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 hover:bg-violet-50/40 transition-all group">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center overflow-hidden shrink-0">
        {nft.image && !imgErr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={sanitizeImgSrc(nft.image) ?? undefined} alt={nft.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
          : <ImageIcon size={16} className="text-violet-300" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-violet-700">{nft.name}</p>
        <p className="text-xs text-gray-400">{nft.collection} · #{nft.tokenId}</p>
      </div>
      {nft.floorUSD > 0 && (
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-violet-700">{fmtUSD(nft.floorUSD)}</p>
          {nft.floorMON > 0 && <p className="text-xs text-gray-400">{nft.floorMON.toFixed(2)} MON</p>}
        </div>
      )}
      <ExternalLink size={13} className="text-gray-300 group-hover:text-violet-400 shrink-0" />
    </a>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PortfolioPage() {
  const { address, isConnected }                 = useWallet()
  const { totals, status, lastUpdated, refresh } = usePortfolio()
  const [nftView, setNftView]                    = useState<'grid' | 'list'>('grid')

  // Derive all data directly from context — no local fetching needed
  const tokens       = totals.tokens
  const tokenValue   = totals.tokenValueUSD
  const nfts         = totals.nfts
  const nftTotal     = totals.nftTotal
  const nftValue     = totals.nftValueUSD
  const nftsNoKey    = totals.nftsNoKey
  const totalValue   = totals.totalValueUSD
  const isLoading    = status === 'loading'

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-gray-900" style={SORA}>Portfolio</h1>
          <p className="text-gray-500 text-sm mt-1">All tokens and NFTs in your wallet</p>
        </div>
        {isConnected && lastUpdated && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-all disabled:opacity-40"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {!isConnected ? (
        <div className="card p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <Wallet size={28} className="text-violet-400" />
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2" style={SORA}>Connect your wallet</h2>
          <p className="text-gray-500 text-sm">Connect your wallet to see your token and NFT portfolio</p>
        </div>
      ) : (
        <>
          {/* ── Summary row ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Total Value */}
            <div className="card p-5 sm:col-span-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                  <Wallet size={14} className="text-violet-500" />
                </div>
                <p className="text-xs text-gray-400 font-medium">Total Value</p>
              </div>
              {isLoading && totalValue === 0
                ? <Skeleton className="h-7 w-28 mt-1" />
                : <p className="font-bold text-xl text-gray-800" style={SORA}>{fmtUSD(totalValue)}</p>
              }
            </div>

            {/* Token Value */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <Coins size={14} className="text-emerald-500" />
                </div>
                <p className="text-xs text-gray-400 font-medium">Token Value</p>
              </div>
              {isLoading && tokenValue === 0
                ? <Skeleton className="h-7 w-24 mt-1" />
                : <p className="font-bold text-xl text-gray-800" style={SORA}>{fmtUSD(tokenValue)}</p>
              }
              {tokens.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">{tokens.length} token{tokens.length !== 1 ? 's' : ''}</p>
              )}
            </div>

            {/* NFT Value */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <ImageIcon size={14} className="text-blue-500" />
                </div>
                <p className="text-xs text-gray-400 font-medium">NFT Value</p>
              </div>
              {isLoading && nftValue === 0
                ? <Skeleton className="h-7 w-24 mt-1" />
                : <p className="font-bold text-xl text-gray-800" style={SORA}>{fmtUSD(nftValue)}</p>
              }
              {nftTotal > 0 && (
                <p className="text-xs text-gray-400 mt-1">{nftTotal} NFT{nftTotal !== 1 ? 's' : ''} · floor price</p>
              )}
              {nftValue === 0 && !isLoading && nftTotal > 0 && (
                <p className="text-xs text-gray-300 mt-1">No floor prices available</p>
              )}
            </div>
          </div>

          {/* ── Portfolio History ─────────────────────────────────────────── */}
          <PortfolioHistory />

          {/* ── AdsTerra banner slot ──────────────────────────────────────── */}
          <AdBanner className="min-h-[120px]" />

          {/* ── Tokens table ─────────────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-violet-600" />
                <h2 className="font-semibold text-gray-800" style={SORA}>Tokens</h2>
                {tokens.length > 0 && (
                  <span className="text-xs bg-violet-100 text-violet-600 font-semibold px-2 py-0.5 rounded-full">{tokens.length}</span>
                )}
              </div>
              {address && (
                <a href={`https://monadscan.com/address/${address}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-violet-500 hover:text-violet-700 transition-colors">
                  View on explorer →
                </a>
              )}
            </div>

            {isLoading && tokens.length === 0 ? (
              <TableSkeleton />
            ) : tokens.length === 0 ? (
              <EmptyState icon={<Coins size={22} />} title="No tokens found" subtitle="Tokens in your wallet will appear here" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-50">
                      <th className="py-3 px-5 text-left font-medium">Token</th>
                      <th className="py-3 px-3 text-right font-medium">Price</th>
                      <th className="py-3 px-3 text-right font-medium hidden md:table-cell">Balance</th>
                      <th className="py-3 px-3 text-right font-medium">Value</th>
                      <th className="py-3 px-3 text-right font-medium hidden lg:table-cell">Allocation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tokens.map(token => <TokenRow key={token.symbol} token={token} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── NFTs ─────────────────────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-blue-500" />
                <h2 className="font-semibold text-gray-800" style={SORA}>NFTs</h2>
                {nftTotal > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full">{nftTotal}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setNftView('grid')} className={`p-1.5 rounded-lg transition-colors ${nftView === 'grid' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50'}`}><LayoutGrid size={14} /></button>
                <button onClick={() => setNftView('list')} className={`p-1.5 rounded-lg transition-colors ${nftView === 'list' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50'}`}><List size={14} /></button>
              </div>
            </div>

            <div className="p-5">
              {isLoading && nfts.length === 0 && <NFTGridSkeleton />}

              {/* Fix #14: was linking to etherscan.io/apis — now OpenSea API docs */}
              {!isLoading && nftsNoKey && (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <p className="text-sm text-gray-400">OpenSea API key not configured</p>
                  <p className="text-xs text-gray-300">Add <code className="bg-gray-100 px-1 rounded">OPENSEA_API_KEY</code> to your environment variables</p>
                  <a href="https://docs.opensea.io/reference/api-keys" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-violet-500 hover:text-violet-700 underline">Get an OpenSea API key →</a>
                </div>
              )}
              {!isLoading && !nftsNoKey && nfts.length === 0 && (
                <EmptyState icon={<ImageIcon size={22} />} title="No NFTs found" subtitle="NFTs you own on Monad will appear here" />
              )}

              {nfts.length > 0 && nftView === 'grid' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {nfts.map(nft => <NFTCard key={nft.id} nft={nft} />)}
                </div>
              )}

              {nfts.length > 0 && nftView === 'list' && (
                <div className="-mx-5 -mb-5">
                  {nfts.map(nft => <NFTListRow key={nft.id} nft={nft} />)}
                </div>
              )}

              {/* Fix #1: was magiceden.io/wallet — now OpenSea */}
              {nftTotal > 50 && (
                <p className="text-xs text-gray-400 text-center mt-4 pt-4 border-t border-gray-50">
                  Showing 50 of {nftTotal} NFTs ·{' '}
                  <a href={`https://opensea.io/account?chain=monad`} target="_blank" rel="noopener noreferrer"
                    className="text-violet-500 hover:text-violet-700">View all on OpenSea</a>
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
