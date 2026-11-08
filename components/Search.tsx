'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRecent } from '@/lib/prefs'

export function Search({ holdings, picks, ready }: { holdings: { ticker: string; name: string; sector: string }[]; picks: string[]; ready: string[] }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ name: string; ticker: string }[]>([])
  const [recent] = useRecent()
  const router = useRouter()
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return }
    const c = new AbortController()
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: c.signal }).then(r => r.json()).then(setRes).catch(() => {}), 180)
    return () => { clearTimeout(t); c.abort() }
  }, [q])
  const go = (t: string) => router.push(`/c/${t.toUpperCase()}`)
  return (
    <div>
      <h1 className="pt-2 text-[28px] font-bold tracking-[-0.02em]">Research any company</h1>
      <p className="mt-1 text-[14px] leading-snug text-ink-2">FINN reads its last four earnings calls and latest annual report, then checks what management promised against what the numbers show.</p>
      <form onSubmit={e => { e.preventDefault(); if (res[0]) go(res[0].ticker); else if (/^[A-Za-z0-9&-]{2,20}$/.test(q.trim())) go(q.trim()) }} className="mt-4">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Company name or NSE symbol" aria-label="Search companies"
          className="w-full rounded-2xl border hair bg-sheet px-4 py-3.5 text-[16px] outline-none placeholder:text-mute focus:border-signal" />
      </form>
      {res.length > 0 && (
        <ul className="sheet mt-2 divide-y divide-rule rounded-2xl">
          {res.map(r => <li key={r.ticker}><Link href={`/c/${r.ticker}`} className="flex justify-between px-4 py-3 text-[14px]"><span>{r.name}</span><span className="text-mute">{r.ticker}</span></Link></li>)}
        </ul>
      )}
      {recent.length > 0 && !q && (
        <Group title="Recently opened">{recent.map(t => <Chip key={t} t={t} ready={ready.includes(t)} />)}</Group>
      )}
      {!q && <Group title="Suggested">{picks.map(t => <Chip key={t} t={t} ready={ready.includes(t)} />)}</Group>}
      {!q && (
        <div className="mt-7">
          <h2 className="px-1 text-[18px] font-bold">Your portfolio</h2>
          <ul className="sheet mt-2 divide-y divide-rule rounded-2xl">
            {holdings.map(h => (
              <li key={h.ticker}><Link href={`/c/${h.ticker}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0"><span className="text-[14px] font-semibold">{h.name}</span><span className="block truncate text-[12px] text-mute">{h.sector}</span></span>
                <span className="text-[12px] text-mute">{h.ticker}</span>
              </Link></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-6"><h2 className="px-1 text-[13px] text-mute">{title}</h2><div className="mt-2 flex flex-wrap gap-2">{children}</div></div>
)
const Chip = ({ t, ready }: { t: string; ready: boolean }) => (
  <Link href={`/c/${t}`} className="rounded-full border hair bg-sheet px-3.5 py-2 text-[14px] font-medium">{t}{ready && <span className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-up" aria-label="ready instantly" />}</Link>
)
