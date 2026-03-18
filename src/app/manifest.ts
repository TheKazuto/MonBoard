import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MonBoard',
    short_name: 'MonBoard',
    description: 'Your Monad Portfolio Dashboard',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f3ff',
    theme_color: '#836EF9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
