'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield, ShieldAlert, ShieldCheck, AlertTriangle, RefreshCw,
  ExternalLink, Loader, XCircle, CheckCircle, Search, Info,
  Coins, Image as ImageIcon, ArrowUpRight,
} from 'lucide-react'
import { useWallet } from '@/contexts/WalletContext'
import { useChainId, useSwitchChain, useSendTransaction } from 'wagmi'
import { createPublicClient, http, formatUnits, encodeFunctionData } from 'viem'
import { SORA } from '@/lib/styles'

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Approval {
  type:         'ERC-20' | 'NFT'
  token:        `0x${string}`
  tokenSymbol:  string
  tokenName:    string
  spender:      `0x${string}`
  spenderLabel: string | null
  amount:       string
  rawAllowance: bigint
  isUnlimited:  boolean
  risk:         'high' | 'medium'
  blockNumber:  bigint
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MONAD_CHAIN_ID = 143
const MONAD_EXPLORER = 'https://monadexplorer.com'
const MONAD_RPC      = 'https://rpc.monad.xyz'

const MONAD_VIEM_CHAIN = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
  blockExplorers: { default: { name: 'MonadExplorer', url: MONAD_EXPLORER } },
} as const

const TOPIC_ERC20_APPROVAL   = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' as `0x${string}`
const TOPIC_NFT_APPROVAL_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31' as `0x${string}`
const HALF_MAX = BigInt('0x8000000000000000000000000000000000000000000000000000000000000000')

const SPENDER_LABELS: Record<string, string> = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Uniswap Permit2',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap Universal Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3 Router 2',
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch V5',
  '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch V4',
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch V6',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Exchange Proxy',
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64': 'OpenOcean',
  '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506': 'SushiSwap Router',
  '0x74de5d4fcbf63e00296fd95d33236b9794016631': 'MetaMask Swap Router',
}

const ERC20_ABI = [
  { name: 'symbol',    type: 'function', inputs: [], outputs: [{ type: 'string'  }], stateMutability: 'view' },
  { name: 'name',      type: 'function', inputs: [], outputs: [{ type: 'string'  }], stateMutability: 'view' },
  { name: 'decimals',  type: 'function', inputs: [], outputs: [{ type: 'uint8'   }], stateMutability: 'view' },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'approve',   type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool'    }], stateMutability: 'nonpayable' },
] as const

const NFT_ABI = [
  { name: 'name',             type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'symbol',           type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'isApprovedForAll', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'setApprovalForAll',type: 'function', inputs: [{ type: 'address' }, { type: 'bool'    }], outputs: [], stateMutability: 'nonpayable' },
] as const

// ─── SCAN ─────────────────────────────────────────────────────────────────────
async function scanMonadApprovals(
  address: `0x${string}`,
  onProgress: (msg: string) => void,
  signal: AbortSignal,
): Promise<Approval[]> {
  const client = createPublicClient({
    chain: MONAD_VIEM_CHAIN as any,
    transport: http(MONAD_RPC, { timeout: 30_000, retryCount: 3, retryDelay: 500 }),
    batch: { multicall: { wait: 16 } },
  })

  async function fetchLogs(topic0: `0x${string}`): Promise<any[]> {
    const paddedAddr = '0x000000000000000000000000' + address.toLowerCase().slice(2)
    const res  = await fetch(
      `/api/approvals-logs?chainId=143&topic0=${topic0}&topic1=${paddedAddr}&fromBlock=0&toBlock=latest`,
      { signal, cache: 'no-store' },
    )
    const data = await res.json()
    if (data.status === '1' && Array.isArray(data.result)) return data.result
    if (data.message === 'No records found') return []
    if (data.status === '0') { console.warn('[approvals]', data.message); return [] }
    throw new Error(data.message ?? 'Etherscan fetch failed')
  }

  onProgress('Fetching approval history from Monad explorer…')
  const [erc20Logs, nftLogs] = await Promise.all([
    fetchLogs(TOPIC_ERC20_APPROVAL),
    fetchLogs(TOPIC_NFT_APPROVAL_ALL),
  ])

  if (signal.aborted) return []
  onProgress(`Found ${erc20Logs.length} ERC-20 + ${nftLogs.length} NFT events. Verifying on-chain…`)

  function dedupe(logs: any[]) {
    const map = new Map<string, any>()
    for (const log of logs) {
      const addr = ('0x' + String(log.topics?.[2] ?? '').slice(-40)).toLowerCase()
      if (addr.length !== 42) continue
      const key  = `${String(log.address).toLowerCase()}:${addr}`
      const bn   = BigInt(log.blockNumber ?? 0)
      const prev = map.get(key)
      if (!prev || bn > BigInt(prev.blockNumber ?? 0)) map.set(key, log)
    }
    return [...map.values()]
  }

  const erc20List = dedupe(erc20Logs)
  const nftList   = dedupe(nftLogs)
  const results: Approval[] = []
  const BATCH = 5

  for (let i = 0; i < erc20List.length; i += BATCH) {
    if (signal.aborted) break
    onProgress(`Verifying ERC-20 approvals… ${Math.min(i + BATCH, erc20List.length)}/${erc20List.length}`)
    if (i > 0) await new Promise(r => setTimeout(r, 100))
    await Promise.all(erc20List.slice(i, i + BATCH).map(async (log) => {
      try {
        const token   = String(log.address).toLowerCase() as `0x${string}`
        const spender = ('0x' + String(log.topics[2]).slice(-40)).toLowerCase() as `0x${string}`
        const [allowRes, symRes, nameRes, decRes] = await Promise.allSettled([
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, spender] }),
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }),
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'name' }),
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
        ])
        const allow = allowRes.status === 'fulfilled' ? allowRes.value as bigint : 0n
        if (allow === 0n) return
        const sym  = symRes.status  === 'fulfilled' ? symRes.value  as string : token.slice(0, 8)
        const name = nameRes.status === 'fulfilled' ? nameRes.value as string : sym
        const dec  = decRes.status  === 'fulfilled' ? decRes.value  as number : 18
        const isUnlimited = allow >= HALF_MAX
        results.push({
          type: 'ERC-20', token,
          tokenSymbol: sym, tokenName: name,
          spender, spenderLabel: SPENDER_LABELS[spender] ?? null,
          amount: isUnlimited ? 'Unlimited' : Number(formatUnits(allow, dec)).toLocaleString('en-US', { maximumFractionDigits: 4 }),
          rawAllowance: allow, isUnlimited, risk: isUnlimited ? 'high' : 'medium',
          blockNumber: BigInt(log.blockNumber ?? 0),
        })
      } catch { /* skip */ }
    }))
  }

  for (let i = 0; i < nftList.length; i += BATCH) {
    if (signal.aborted) break
    onProgress(`Verifying NFT approvals… ${Math.min(i + BATCH, nftList.length)}/${nftList.length}`)
    if (i > 0) await new Promise(r => setTimeout(r, 100))
    await Promise.all(nftList.slice(i, i + BATCH).map(async (log) => {
      try {
        const contract = String(log.address).toLowerCase() as `0x${string}`
        const operator = ('0x' + String(log.topics[2]).slice(-40)).toLowerCase() as `0x${string}`
        const [approvedRes, nameRes, symRes] = await Promise.allSettled([
          client.readContract({ address: contract, abi: NFT_ABI, functionName: 'isApprovedForAll', args: [address, operator] }),
          client.readContract({ address: contract, abi: NFT_ABI, functionName: 'name' }),
          client.readContract({ address: contract, abi: NFT_ABI, functionName: 'symbol' }),
        ])
        if (approvedRes.status !== 'fulfilled' || !approvedRes.value) return
        results.push({
          type: 'NFT', token: contract,
          tokenName:   nameRes.status === 'fulfilled' ? nameRes.value as string : contract.slice(0, 10),
          tokenSymbol: symRes.status  === 'fulfilled' ? symRes.value  as string : '?',
          spender: operator, spenderLabel: SPENDER_LABELS[operator] ?? null,
          amount: 'All NFTs', rawAllowance: 1n, isUnlimited: true, risk: 'high',
          blockNumber: BigInt(log.blockNumber ?? 0),
        })
      } catch { /* skip */ }
    }))
  }

  return results.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1))
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function shortAddr(a: string) { return a.slice(0, 6) + '…' + a.slice(-4) }

function RiskBadge({ isUnlimited, risk }: { isUnlimited: boolean; risk: string }) {
  if (risk === 'high') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
      <ShieldAlert size={10} />{isUnlimited ? 'Unlimited' : 'High'}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-600">
      <AlertTriangle size={10} />Medium
    </span>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function SecurityPage() {
  const { address, isConnected } = useWallet()
  const connectedChainId         = useChainId()
  const { switchChain }          = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()

  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading,   setLoading]   = useState(false)
  const [progress,  setProgress]  = useState('')
  const [error,     setError]     = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState<'all' | 'ERC-20' | 'NFT'>('all')
  const [revoking,  setRevoking]  = useState<string | null>(null)
  const [revoked,   setRevoked]   = useState<Set<string>>(new Set())
  const [txError,   setTxError]   = useState<string | null>(null)
  const [txSuccess, setTxSuccess] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const runScan = useCallback(async () => {
    if (!address) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null); setApprovals([]); setRevoked(new Set()); setProgress('')
    try {
      const list = await scanMonadApprovals(address as `0x${string}`, setProgress, ctrl.signal)
      if (!ctrl.signal.aborted) setApprovals(list)
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message ?? 'Scan failed')
    } finally { setLoading(false); setProgress('') }
  }, [address])

  useEffect(() => {
    if (isConnected && address) runScan()
    return () => abortRef.current?.abort()
  }, [isConnected, address]) // eslint-disable-line

  async function revokeApproval(a: Approval) {
    const key = `${a.token}:${a.spender}`
    setRevoking(key); setTxError(null); setTxSuccess(null)

    if (connectedChainId !== MONAD_CHAIN_ID) {
      try {
        await switchChain({ chainId: MONAD_CHAIN_ID })
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 300))
          try {
            const hex = await (window as any).ethereum?.request({ method: 'eth_chainId' })
            if (hex && parseInt(hex, 16) === MONAD_CHAIN_ID) break
          } catch { /* ignore */ }
        }
      } catch {
        setTxError('Please switch to Monad in your wallet')
        setRevoking(null); return
      }
    }

    try {
      if (a.type === 'ERC-20') {
        await sendTransactionAsync({
          to:   a.token,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [a.spender, 0n] }),
        })
      } else {
        await sendTransactionAsync({
          to:   a.token,
          data: encodeFunctionData({ abi: NFT_ABI, functionName: 'setApprovalForAll', args: [a.spender, false] }),
        })
      }
      setRevoked(prev => new Set([...prev, key]))
      setTxSuccess(`${a.tokenSymbol} approval revoked`)
    } catch (e: any) {
      setTxError(e.shortMessage ?? e.message ?? 'Transaction failed')
    } finally { setRevoking(null) }
  }

  const visible = approvals.filter(a => {
    if (revoked.has(`${a.token}:${a.spender}`)) return false
    if (filter !== 'all' && a.type !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return a.tokenSymbol.toLowerCase().includes(q) ||
             a.tokenName.toLowerCase().includes(q) ||
             a.spender.toLowerCase().includes(q) ||
             (a.spenderLabel ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const highCount  = visible.filter(a => a.risk === 'high').length
  const erc20Count = visible.filter(a => a.type === 'ERC-20').length
  const nftCount   = visible.filter(a => a.type === 'NFT').length

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center shadow-lg shadow-red-200 shrink-0">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-2xl text-gray-900" style={SORA}>Security</h1>
            <p className="text-sm text-gray-500">Review and revoke token approvals on Monad</p>
          </div>
        </div>
        <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-all shadow-sm whitespace-nowrap">
          <ArrowUpRight size={14} />
          Check other networks
        </a>
      </div>

      {/* Not connected */}
      {!isConnected && (
        <div className="card p-10 text-center">
          <Shield size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Connect your wallet to scan approvals</p>
          <p className="text-sm text-gray-400 mt-1">We'll scan full on-chain history for all token and NFT permissions on Monad</p>
        </div>
      )}

      {/* Loading */}
      {isConnected && loading && (
        <div className="card p-10 text-center space-y-3">
          <RefreshCw size={28} className="text-violet-400 mx-auto animate-spin" />
          <p className="text-gray-700 font-medium">{progress || 'Scanning Monad…'}</p>
          <p className="text-xs text-gray-400">Reading full approval history via Monad explorer</p>
          <button onClick={() => { abortRef.current?.abort(); setLoading(false) }}
            className="text-xs text-red-400 hover:text-red-600 underline">Cancel</button>
        </div>
      )}

      {/* Error */}
      {isConnected && !loading && error && (
        <div className="card p-6 text-center border-red-100 bg-red-50/50">
          <XCircle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-red-600 font-medium">{error}</p>
          <button onClick={runScan} className="mt-3 text-sm text-violet-600 hover:text-violet-800 underline font-medium">Try again</button>
        </div>
      )}

      {/* Results */}
      {isConnected && !loading && !error && (
        <>
          {approvals.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Active approvals', value: visible.length, warn: false },
                { label: 'High risk',        value: highCount,      warn: highCount > 0 },
                { label: 'ERC-20 approvals', value: erc20Count,     warn: false },
                { label: 'NFT approvals',    value: nftCount,       warn: false },
              ].map(s => (
                <div key={s.label} className={`card p-4 text-center ${s.warn ? 'border-red-200 bg-red-50/50' : ''}`}>
                  <p className={`text-2xl font-bold ${s.warn ? 'text-red-600' : 'text-gray-800'}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {txSuccess && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">
              <CheckCircle size={16} />{txSuccess}
              <button onClick={() => setTxSuccess(null)} className="ml-auto text-green-500"><XCircle size={14} /></button>
            </div>
          )}
          {txError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
              <XCircle size={16} />{txError}
              <button onClick={() => setTxError(null)} className="ml-auto"><XCircle size={14} /></button>
            </div>
          )}

          {approvals.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-gray-200 flex-1">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search token, spender…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400" />
              </div>
              <div className="flex gap-1">
                {(['all', 'ERC-20', 'NFT'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      filter === f ? 'bg-violet-100 text-violet-700' : 'bg-white border border-gray-200 text-gray-600 hover:bg-violet-50'
                    }`}>
                    {f === 'all' ? 'All' : f}
                    {f === 'ERC-20' && erc20Count > 0 && <span className="ml-1 text-xs opacity-60">{erc20Count}</span>}
                    {f === 'NFT'    && nftCount   > 0 && <span className="ml-1 text-xs opacity-60">{nftCount}</span>}
                  </button>
                ))}
              </div>
              <button onClick={runScan}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-600 hover:bg-violet-50 hover:border-violet-300 transition-colors">
                <RefreshCw size={13} />Refresh
              </button>
            </div>
          )}

          {approvals.length === 0 && (
            <div className="card p-10 text-center">
              <ShieldCheck size={40} className="text-green-400 mx-auto mb-3" />
              <p className="text-gray-700 font-semibold">No active approvals on Monad</p>
              <p className="text-sm text-gray-400 mt-1">Your wallet has no active token or NFT approvals</p>
            </div>
          )}

          {highCount > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
              <ShieldAlert size={16} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">
                <span className="font-semibold">{highCount} high-risk approval{highCount > 1 ? 's' : ''}</span>
                {' '}— unlimited approvals let contracts spend all your tokens. Revoke if no longer needed.
              </p>
            </div>
          )}

          {visible.length > 0 && (
            <div className="space-y-2">
              {visible.map(a => {
                const key   = `${a.token}:${a.spender}`
                const isRev = revoking === key
                return (
                  <div key={key} className={`card p-4 ${a.risk === 'high' ? 'border-red-100' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.type === 'NFT' ? 'bg-purple-100' : 'bg-blue-100'}`}>
                        {a.type === 'NFT' ? <ImageIcon size={18} className="text-purple-600" /> : <Coins size={18} className="text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-800">{a.tokenSymbol}</span>
                          <span className="text-xs text-gray-400 truncate max-w-[140px]">{a.tokenName}</span>
                          <RiskBadge risk={a.risk} isUnlimited={a.isUnlimited} />
                          {a.type === 'NFT' && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">NFT</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                          <span>Spender:</span>
                          {a.spenderLabel
                            ? <span className="text-violet-600 font-semibold">{a.spenderLabel}</span>
                            : <span className="font-mono">{shortAddr(a.spender)}</span>}
                          <span className="text-gray-300">·</span>
                          <span className={`font-medium ${a.isUnlimited ? 'text-red-500' : 'text-gray-700'}`}>{a.amount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <a href={`${MONAD_EXPLORER}/token/${a.token}`} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                          <ExternalLink size={14} />
                        </a>
                        <button onClick={() => revokeApproval(a)} disabled={isRev}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                          style={{ background: isRev ? '#9ca3af' : 'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow: isRev ? 'none' : '0 2px 8px rgba(239,68,68,.3)' }}>
                          {isRev ? <><Loader size={13} className="animate-spin" />Revoking…</> : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {approvals.length > 0 && visible.length === 0 && (
            <div className="card p-8 text-center">
              <Search size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500">No approvals match your search</p>
            </div>
          )}
        </>
      )}

      <div className="flex items-start gap-2 text-xs text-gray-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Approvals verified in real-time via on-chain calls. Revoking sends a transaction from your wallet — Monboard never holds your funds.</span>
      </div>
    </div>
  )
}
