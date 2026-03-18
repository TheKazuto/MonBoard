/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.coingecko.com' },
      { protocol: 'https', hostname: 'coin-images.coingecko.com' },
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'api.geckoterminal.com' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: 'icons.llamao.fi' },
    ],
  },

  async headers() {
    // ─────────────────────────────────────────────────────────────────────────
    // CSP DA APP — aplicada a TODAS as rotas via '/(.*)'
    //
    // Directiva por directiva:
    //
    // default-src 'self'
    //   Tudo o que não esteja coberto pelas directivas específicas abaixo
    //   só pode vir do próprio domínio. Serve de fallback seguro.
    //
    // script-src 'self' 'unsafe-inline'
    //   'unsafe-inline' é necessário porque:
    //   1. layout.tsx usa <script dangerouslySetInnerHTML> para o tema escuro
    //   2. Next.js injeta scripts de hidratação inline no HTML gerado
    //   Sem nonces (que exigiriam refactoring profundo do layout), 'unsafe-inline'
    //   é inevitável. A protecção real contra XSS vem do connect-src abaixo.
    //
    // style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
    //   'unsafe-inline' necessário para RainbowKit, Tailwind e o bloco
    //   <style dangerouslySetInnerHTML> da landing page.
    //   fonts.googleapis.com para o @import de Google Fonts na landing.
    //
    // font-src 'self' data: https://fonts.gstatic.com
    //   fonts.gstatic.com serve os ficheiros de fonte do Google Fonts.
    //   data: cobre fontes embutidas como data URIs usadas pelo RainbowKit.
    //
    // img-src 'self' data: blob: https:
    //   https: abre todas as origens HTTPS para imagens.
    //   Imagens de NFT e logos de tokens podem vir de qualquer CDN —
    //   não é possível enumerar todos os domínios antecipadamente.
    //   Imagens não executam código, por isso este nível é aceitável.
    //   data: e blob: necessários para ícones de wallets do RainbowKit.
    //
    // connect-src 'self' [APIs client-side]
    //   A directiva mais valiosa da CSP: mesmo que ocorra XSS, o atacante
    //   não consegue exfiltrar dados para domínios fora desta lista.
    //   Nota: CoinGecko, OpenSea, Etherscan, Zerion, Morpho, etc. são
    //   fetches server-side nas API routes — nunca chegam ao browser,
    //   por isso não precisam de estar aqui.
    //
    // frame-src 'self' [Transak]
    //   'self' cobre o iframe do AdBanner (/api/ad-frame é same-origin).
    //   Transak é carregado em iframe na página de onramp — ambos os
    //   ambientes (staging e produção) são listados.
    //
    // frame-ancestors 'self'
    //   Impede que as páginas da app sejam embutidas em iframes de sites
    //   externos (anti-clickjacking). Complementa X-Frame-Options: SAMEORIGIN.
    //
    // object-src 'none'
    //   Bloqueia Flash e outros plugins — não são usados e nunca devem ser.
    //
    // base-uri 'self'
    //   Impede injecção de tag <base> que poderia redirigir todos os URLs
    //   relativos para um domínio controlado por um atacante.
    //
    // form-action 'self'
    //   Formulários só podem submeter para o próprio domínio, impedindo
    //   ataques de phishing via sequestro de form action.
    //
    // upgrade-insecure-requests
    //   Promove automaticamente pedidos HTTP para HTTPS.
    // ─────────────────────────────────────────────────────────────────────────
    const APP_CSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      [
        "connect-src 'self'",
        // Monad RPC — wagmi/viem (security page, on-chain reads no browser)
        "https://rpc.monad.xyz",
        // Rubic — cotações de swap, execução de tx, lista de chains
        "https://api-v2.rubic.exchange",
        // WalletConnect — relay HTTP e WebSocket
        "https://*.walletconnect.com",
        "wss://*.walletconnect.com",
        "https://*.walletconnect.org",
        "wss://*.walletconnect.org",
        // Coinbase Wallet — incluído automaticamente pelo RainbowKit
        "https://www.walletlink.org",
        "wss://www.walletlink.org",
      ].join(' '),
      // frame-src: 'self' cobre o iframe do AdBanner (/api/ad-frame é same-origin)
      "frame-src 'self' https://global-stg.transak.com https://global.transak.com",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; ')

    // ─────────────────────────────────────────────────────────────────────────
    // CSP PERMISSIVA — sobrescreve apenas para /api/ad-frame
    //
    // Por que esta rota precisa de CSP separada:
    //   A AdsTerra usa RTB (Real-Time Bidding). O script invoke.js da AdsTerra
    //   conecta-se a domínios de ad exchanges e SSPs que variam por leilão
    //   em tempo real — é impossível enumerá-los antecipadamente.
    //   A APP_CSP bloquearia essas ligações e os anúncios não apareceriam.
    //
    // Segurança desta abordagem:
    //   1. O conteúdo permissivo está confinado ao iframe do AdBanner.
    //   2. O iframe tem sandbox="allow-scripts allow-same-origin allow-popups"
    //      (definido no AdBanner.tsx), que já limita o que os anúncios podem
    //      fazer independentemente da CSP desta rota.
    //   3. As páginas da app que carregam o iframe continuam com APP_CSP.
    //   4. Esta CSP permissiva nunca é enviada ao browser do utilizador
    //      directamente — só é carregada dentro do contexto isolado do iframe.
    //
    // Em Next.js, quando múltiplos blocos de headers() correspondem à mesma
    // rota, o ÚLTIMO bloco com a mesma chave vence. Por isso este bloco
    // sobrescreve apenas o Content-Security-Policy para /api/ad-frame,
    // mantendo todos os outros headers de segurança (HSTS, X-Content-Type,
    // etc.) herdados da regra '/(.*)'  acima.
    // ─────────────────────────────────────────────────────────────────────────
    const AD_FRAME_CSP = [
      "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
      "script-src * 'unsafe-inline' 'unsafe-eval'",
      "connect-src *",
      "img-src * data: blob:",
      "frame-src *",
    ].join('; ')

    return [
      {
        // Headers de segurança + CSP para todas as rotas da app
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'X-XSS-Protection',          value: '0' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          // SAMEORIGIN: impede clickjacking nas páginas da app.
          // /api/ad-frame é same-origin (carregado pelo nosso próprio AdBanner),
          // por isso SAMEORIGIN é correcto e suficiente para essa rota também.
          { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy',   value: APP_CSP },
        ],
      },
      {
        // Sobrescreve APENAS o Content-Security-Policy para /api/ad-frame.
        // Todos os outros headers de segurança (HSTS, X-Content-Type-Options,
        // X-Frame-Options, etc.) são herdados da regra '/(.*)'  acima.
        source: '/api/ad-frame',
        headers: [
          { key: 'Content-Security-Policy', value: AD_FRAME_CSP },
        ],
      },
    ]
  },
}

module.exports = nextConfig
