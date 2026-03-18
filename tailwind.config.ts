import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        lilac: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        monad: {
          purple: '#836EF9',
          light: '#B9AEFC',
          dark: '#200052',
          bg: '#FBFAFF',
        }
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
        display: ['var(--font-sora)', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px rgba(131, 110, 249, 0.08), 0 4px 16px rgba(131, 110, 249, 0.06)',
        'card-hover': '0 4px 12px rgba(131, 110, 249, 0.16), 0 8px 32px rgba(131, 110, 249, 0.12)',
        'glow': '0 0 20px rgba(131, 110, 249, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(135deg, #836EF9 0%, #B9AEFC 50%, #f5f3ff 100%)',
        'card-gradient': 'linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%)',
        'purple-gradient': 'linear-gradient(135deg, #836EF9 0%, #6d28d9 100%)',
      }
    },
  },
  plugins: [],
}
export default config
