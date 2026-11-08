'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/', label: 'Today', icon: (a: boolean) => <path d="M4 6h16M4 12h10M4 18h6" strokeWidth={a ? 2.4 : 1.8} /> },
  { href: '/research', label: 'Research', icon: (a: boolean) => <><circle cx="11" cy="11" r="6" strokeWidth={a ? 2.4 : 1.8} /><path d="m20 20-4.5-4.5" strokeWidth={a ? 2.4 : 1.8} /></> },
  { href: '/watch', label: 'Watch', icon: (a: boolean) => <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4h4" strokeWidth={a ? 2.2 : 1.7} /> },
]

export function TabBar() {
  const p = usePathname()
  const active = (h: string) => (h === '/' ? p === '/' : p.startsWith(h) || (h === '/research' && p.startsWith('/c/')))
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t hair bg-paper/92 backdrop-blur-md safe-b">
      <div className="mx-auto flex max-w-[460px] justify-around pt-2">
        {tabs.map(t => {
          const a = active(t.href)
          return (
            <Link key={t.href} href={t.href} className={`flex w-24 flex-col items-center gap-0.5 py-1 text-[11px] ${a ? 'text-ink font-semibold' : 'text-mute'}`} aria-current={a ? 'page' : undefined}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{t.icon(a)}</svg>
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
