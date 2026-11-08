import './globals.css'
import type { Metadata, Viewport } from 'next'
import { TabBar } from '@/components/TabBar'

export const metadata: Metadata = {
  title: 'FINN',
  description: 'Your portfolio, pre-read. FINN reads every filing and shows you only what matters.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'FINN', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F7F8F6' }

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh">
        <main className="mx-auto max-w-[460px] px-4 pb-28 pt-[max(env(safe-area-inset-top),14px)]">{children}</main>
        <TabBar />
      </body>
    </html>
  )
}
