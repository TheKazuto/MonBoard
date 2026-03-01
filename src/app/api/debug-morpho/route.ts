import { NextResponse } from 'next/server'
export const revalidate = 0

export async function GET() {
  const results: any = {}

  // Try pagination wrappers: items, edges/node, nodes
  const queries: Record<string, string> = {
    items: `{ markets(where:{chainId_in:[143]}, first:3) { items { uniqueKey loanAsset{symbol} state{supplyApy} } } }`,
    items_vaults: `{ vaults(where:{chainId_in:[143]}, first:3) { items { address name asset{symbol} state{netApy} } } }`,
    edges: `{ markets(where:{chainId_in:[143]}, first:3) { edges { node { uniqueKey loanAsset{symbol} state{supplyApy} } } } }`,
    pageInfo: `{ markets(where:{chainId_in:[143]}, first:3) { pageInfo { count } items { uniqueKey } } }`,
  }

  for (const [key, query] of Object.entries(queries)) {
    try {
      const r = await fetch('https://api.morpho.org/graphql', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(8_000), cache: 'no-store',
      })
      const d = await r.json()
      results[key] = d.errors ? { error: d.errors[0].message } : d.data
    } catch(e: any) { results[key] = { fetch_error: e.message } }
  }

  return NextResponse.json(results)
}
