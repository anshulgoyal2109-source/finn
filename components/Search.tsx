'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRecent } from '@/lib/prefs'

type Rec = { delivered: number; partly: number; missed: number; revised: number; pending: number }
export function Search({ holdings, picks, ready, record }: { holdings: { ticker: string; name: string; sector: string }[]; picks: string[]; ready: string[]; record: Record<string, Rec> }) {
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
      {!q && <p className="mt-2 px-1 text-[11px] text-mute"><span className="mr-1 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-up" />Already read: opens instantly. Others take about 20 seconds the first time.</p>}
      {!q && (
        <div className="mt-7">
          <h2 className="px-1 text-[18px] font-bold">Your portfolio</h2>
          <p className="px-1 text-[12px] text-mute">Management track record: promises from the last four calls, graded against reported numbers</p>
          <ul className="sheet mt-2 divide-y divide-rule rounded-2xl">
            {holdings.map(h => (
              <li key={h.ticker}><Link href={`/c/${h.ticker}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0"><span className="text-[14px] font-semibold">{h.name}</span><span className="block truncate text-[12px] text-mute">{h.ticker} · {h.sector}</span></span>
                <TrackRecord r={record[h.ticker]} />
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

function TrackRecord({ r }: { r?: Rec }) {
  const total = r ? r.delivered + r.partly + r.missed + r.revised + r.pending : 0
  if (!r || !total) return <span className="shrink-0 text-[11px] text-mute">No checkable guidance</span>
  const seg: [number, string][] = [[r.delivered, 'var(--color-up)'], [r.partly, 'var(--color-warn)'], [r.missed, 'var(--color-down)'], [r.revised, 'var(--color-signal)'], [r.pending, 'var(--color-rule)']]
  return (
    <span className="w-[92px] shrink-0 text-right">
      <span className="flex h-1.5 overflow-hidden rounded-full" aria-hidden>{seg.filter(([n]) => n).map(([n, c], i) => <span key={i} style={{ flex: n, background: c }} />)}</span>
      <span className="mt-1 block text-[11px] text-mute">{([[r.delivered, 'kept'], [r.missed, 'missed'], [r.partly, 'partly'], [r.revised, 'revised'], [r.pending, 'pending']] as [number, string][]).filter(([n]) => n).slice(0, 2).map(([n, l]) => `${n} ${l}`).join(' · ')}</span>
    </span>
  )
}
