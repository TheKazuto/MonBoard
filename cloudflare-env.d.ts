// Tipos do ambiente Cloudflare — usados por priceCache.ts e serverCache.ts
// KVNamespace não está disponível durante o build do Next.js, então usamos
// uma interface compatível definida inline.

interface CloudflareEnv {
  ASSETS: Fetcher
  WORKER_SELF_REFERENCE: Fetcher
  /** KV namespace compartilhado para cache de preços CoinGecko e dados de API. */
  PRICE_KV: {
    get(key: string): Promise<string | null>
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  }
}
