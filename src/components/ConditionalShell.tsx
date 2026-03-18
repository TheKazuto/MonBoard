'use client'

import { usePathname } from 'next/navigation'
import Navbar from '@/components/Navbar'
import BottomBar from '@/components/BottomBar'

// Routes that should not display the Navbar or BottomBar
const BARE_ROUTES = ['/']

export default function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isBare = BARE_ROUTES.includes(pathname)

  if (isBare) {
    return <>{children}</>
  }

  return (
    <>
      <Navbar />
      <main className="page-content pt-16">
        {children}
      </main>
      <BottomBar />
    </>
  )
}
