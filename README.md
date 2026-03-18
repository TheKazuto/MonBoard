# MonBoard 🟣

> The ultimate portfolio dashboard for the Monad ecosystem.

MonBoard is a central dashboard for Monad users to track their wallet, DeFi positions, NFTs, and transaction history in real-time. Built with Next.js 14, deployed on Cloudflare Pages.

---

## Features

- **Portfolio Overview** — Total wallet value in USD (tokens + NFTs + DeFi), 24h change
- **Token Allocation** — Pie chart with % exposure per token
- **DeFi Positions** — Active positions across 14+ Monad protocols (liquidity pools, lending, staking)
- **Best APRs** — Top yield opportunities aggregated live from protocol APIs
- **Transaction History** — Full history with filtering by type (receive, send, swap, DeFi, NFT)
- **Portfolio History Chart** — Up to 1 year of historical portfolio value
- **Top Monad Tokens** — Top 10 by market cap
- **Fear & Greed Index** — Crypto market sentiment
- **Wallet Monitoring** — Watch other wallets and track their activity *(NFT gated)*
- **Telegram Bot Alerts** — Real-time notifications for wallet activity *(NFT gated)*
- **NFT Gating System** — Unlock premium features by holding a MonadBoard NFT
- **Swap / Bridge** — Integrated via Rubic SDK
- **Security** — Token approval scanner and revoke tool
- **Sponsors Area** — Partner/sponsor banners
- **Mobile Responsive** — Works on all screen sizes
- **Dark Mode** — Full dark theme support

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Deployment:** Cloudflare Pages via OpenNext
- **Styling:** Tailwind CSS + custom CSS variables
- **Charts:** Recharts
- **Wallet Connection:** RainbowKit + Wagmi + Viem
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Fonts:** Sora / DM Sans / Plus Jakarta Sans

---

## APIs Used

| Data | API |
|------|-----|
| Token prices & market data | [CoinGecko API](https://www.coingecko.com/api) |
| NFT floor prices & metadata | [OpenSea API](https://docs.opensea.io/reference/api-overview) |
| On-chain data (balances, txs) | Monad RPC (`https://rpc.monad.xyz`) |
| Fear & Greed Index | [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/) |
| Swap quotes | [Rubic SDK](https://docs.rubic.exchange) |
| DeFi TVL data | [DeFiLlama](https://defillama.com/docs/api) |
| Yield opportunities | Merkl, Morpho, Neverland, Kuru, Upshift, Euler, GearBox, Curve, Lagoon, Curvance, Magma, Kintsu, shMonad, Midas |
| Explorer transactions | [Etherscan V2 API](https://docs.etherscan.io/) |
| Ads | [AdsTerra](https://adsterra.com) |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm / yarn / pnpm

### Installation

```bash
git clone https://github.com/yourusername/monboard.git
cd monboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file at the root:

```env
# CoinGecko API (server-only — no NEXT_PUBLIC_ prefix)
COINGECKO_API_KEY=your_key_here

# OpenSea API — for NFT metadata and floor prices
OPENSEA_API_KEY=your_key_here

# Etherscan V2 API — for transaction history
ETHERSCAN_API_KEY=your_key_here

# WalletConnect Project ID — from cloud.walletconnect.com
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here

# Swap fee receiver address (optional) — earns 0.2% on swaps
NEXT_PUBLIC_FEE_RECEIVER=0x...

# MonBoard NFT Contract (fill when collection launches)
NEXT_PUBLIC_MONADBOARD_NFT_CONTRACT=0x...

# Telegram Bot (for wallet monitoring alerts feature)
TELEGRAM_BOT_TOKEN=your_token_here
```

---

## Deploying to Cloudflare Pages

1. Push this repo to GitHub
2. Go to [Cloudflare Pages](https://pages.cloudflare.com/) and import the repo
3. Set the build command to `npm run build` and output directory to `.open-next`
4. Add environment variables in the Cloudflare dashboard
5. Deploy!

> This project uses [OpenNext](https://opennext.js.org/cloudflare) for Cloudflare Pages compatibility.

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Dashboard (home)
│   ├── portfolio/page.tsx          # Full token + NFT portfolio
│   ├── defi/page.tsx               # DeFi positions
│   ├── best-aprs/page.tsx          # Best yield opportunities
│   ├── swap/page.tsx               # Swap / Bridge
│   ├── security/page.tsx           # Token approval scanner
│   ├── transactions/page.tsx       # Transaction history
│   ├── account/page.tsx            # User settings + NFT status
│   ├── layout.tsx                  # Root layout
│   └── api/                        # API routes (server-side)
│       ├── best-aprs/route.ts
│       ├── defi/route.ts
│       ├── nfts/route.ts
│       ├── token-exposure/route.ts
│       ├── portfolio-history/route.ts
│       ├── transactions/route.ts
│       ├── mon-price/route.ts
│       ├── top-tokens/route.ts
│       ├── exchange-rates/route.ts
│       └── ad-frame/route.ts
├── components/
│   ├── Navbar.tsx
│   ├── BottomBar.tsx
│   ├── AdBanner.tsx
│   └── ...
├── contexts/
│   ├── PortfolioContext.tsx
│   ├── WalletContext.tsx
│   ├── PreferencesContext.tsx
│   └── TransactionContext.tsx
├── hooks/
│   └── useMonadPrice.ts
├── lib/
│   ├── monad.ts        # Shared RPC utilities + getMonPrice
│   ├── styles.ts       # Shared style constants (SORA)
│   ├── format.ts       # Number formatting helpers
│   ├── dataCache.ts    # Client-side fetch cache
│   └── serverCache.ts  # Server-side in-memory cache
└── types/
    └── apr.ts          # Shared AprEntry type
```

---

## License

MIT — Built for the Monad ecosystem 🟣
