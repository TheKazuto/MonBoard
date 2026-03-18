// src/types/apr.ts
// Shared AprEntry type — used by both:
//   src/app/api/best-aprs/route.ts  (server)
//   src/app/best-aprs/page.tsx      (client)
// Previously duplicated with the comment "Duplicated from api/best-aprs/route.ts
// to avoid importing server-only module". Moving it here removes the duplication.

export interface AprEntry {
  protocol:   string
  logo:       string
  url:        string
  tokens:     string[]      // symbols involved
  label:      string        // human-readable name
  apr:        number        // annual percentage rate (e.g. 8.5 = 8.5%)
  tvl:        number        // total value locked in USD
  type:       'pool' | 'vault' | 'lend'
  isStable:   boolean       // true when ALL tokens are stablecoins
}
