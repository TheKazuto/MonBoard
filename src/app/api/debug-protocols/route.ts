import { NextRequest, NextResponse } from 'next/server'
import { rpcBatch } from '@/lib/monad'

export const revalidate = 0

function ethCall(to: string, data: string, id: number) {
  return { jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }
}
function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  try { return BigInt(hex.startsWith('0x') ? hex : '0x' + hex) } catch { return 0n }
}
function balanceOfData(addr: string) {
  return '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0')
}

const MGR   = '0x1310f352f1389969ece6741671c4b919523912ff'
const SEED  = [
  '0x1e240e30e51491546dec3af16b0b4eac8dd110d4',
  '0xd9e2025b907e95ecc963a5018f56b87575b4ab26',
  '0x926c101cf0a3de8725eb24a93e980f9fe34d6230',
  '0x494876051b0e85dce5ecd5822b1ad39b9660c928',
  '0x5ca6966543c0786f547446234492d2f11c82f11f',
]

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''
  if (!address) return NextResponse.json({ error: 'Pass ?address=0x...' })
  const userPadded = address.slice(2).toLowerCase().padStart(64, '0')
  const trace: any = {}

  // Step 1: market manager
  try {
    const mgrRes = await rpcBatch([{ jsonrpc: '2.0', id: 0, method: 'eth_call',
      params: [{ to: MGR, data: '0x53312723' + userPadded }, 'latest'] }])
    const raw = mgrRes[0]?.result ?? '0x'
    trace.step1_raw_len   = raw.length
    trace.step1_raw_start = raw.slice(0, 100)

    const entered: string[] = []
    if (raw && raw !== '0x' && raw.length >= 2 + 3 * 64) {
      const hex   = raw.slice(2)
      const count = parseInt(hex.slice(64, 128), 16)
      for (let i = 0; i < count; i++)
        entered.push(('0x' + hex.slice(128 + i * 64 + 24, 128 + i * 64 + 64)).toLowerCase())
    }
    trace.entered_count = entered.length
    trace.entered = entered

    const seen = new Set<string>()
    const all: string[] = []
    for (const a of [...SEED.map(x => x.toLowerCase()), ...entered]) {
      if (!seen.has(a)) { seen.add(a); all.push(a) }
    }
    trace.total_ctokens = all.length

    // Step 2: batch
    const calls: any[] = []
    all.forEach((addr, i) => {
      calls.push(ethCall(addr, balanceOfData(address), i * 4))
      calls.push(ethCall(addr, '0x95d89b41', i * 4 + 1))
      calls.push(ethCall(addr, '0x01e1d114', i * 4 + 2))
      calls.push(ethCall(addr, '0x18160ddd', i * 4 + 3))
    })
    trace.batch_calls = calls.length

    const results = await rpcBatch(calls)
    trace.results_count = results.length
    trace.id_type = typeof results[0]?.id

    const getR = (n: number) => results.find((r: any) => Number(r.id) === n)?.result ?? '0x'

    // Check cWMON specifically (index 0)
    const cwmon = all[0]
    trace.cwmon_address = cwmon
    trace.cwmon_balance_raw  = getR(0)
    trace.cwmon_assets_raw   = getR(2)
    trace.cwmon_supply_raw   = getR(3)

    const shares = decodeUint(getR(0))
    const assets = decodeUint(getR(2))
    const supply = decodeUint(getR(3))
    trace.cwmon_shares  = shares.toString()
    trace.cwmon_assets  = assets.toString()
    trace.cwmon_supply  = supply.toString()
    trace.cwmon_shares_zero  = shares === 0n
    trace.cwmon_assets_zero  = assets === 0n
    trace.cwmon_supply_zero  = supply === 0n

    if (shares > 0n && supply > 0n && assets > 0n) {
      const userAssets = Number(shares) / Number(supply) * Number(assets) / 1e18
      trace.cwmon_user_assets = userAssets
      trace.cwmon_usd_at_024 = userAssets * 0.024
    }

  } catch (e: any) {
    trace.error = e?.message ?? String(e)
    trace.stack = (e?.stack ?? '').slice(0, 500)
  }

  return NextResponse.json(trace)
}
