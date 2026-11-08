'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Filing, Holding, PriceBook } from '@/lib/types'
import { movesInWindow, lastRegular, type Move } from '@/lib/alerts'
import { routineGroup, CATEGORY_LABEL } from '@/lib/classify'
import { useDone, useThresholds, useWindow } from '@/lib/prefs'
import { ActCard, GlanceRow, cleanHeadline } from './cards'
import { pct, inr, day } from '@/lib/format'

const WINDOWS: { id: string; label: string; ms: number }[] = [
  { id: '24h', label: '24 hours', ms: 864e5 }, { id: '3d', label: '3 days', ms: 3 * 864e5 },
  { id: '7d', label: '7 days', ms: 7 * 864e5 }, { id: '30d', label: '30 days', ms: 30 * 864e5 },
]

export function Brief({ filings, prices, holdings, updatedAt, now }: { filings: Filing[]; prices: PriceBook; holdings: Holding[]; updatedAt: string; now: number }) {
  const [win, setWin] = useWindow()
  const [th] = useThresholds()
  const [done, setDone] = useDone()
  const [showDone, setShowDone] = useState(false)
  const w = WINDOWS.find(x => x.id === win) || WINDOWS[0]
  const since = new Date(now - w.ms).toISOString()
  const name = (t: string) => holdings.find(h => h.ticker === t)?.name || t

  const view = useMemo(() => {
    const inWin = filings.filter(f => f.ts >= since)
    // A category you don't watch can still reach you, but only if it scores very high.
    const act = inWin.filter(f => f.tier === 'act' && (th.categories.includes(f.category) || f.score >= 85)).sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts))
    const glance = inWin.filter(f => f.tier === 'glance' || (f.tier === 'act' && !act.includes(f))).sort((a, b) => b.ts.localeCompare(a.ts))
    const routine = inWin.filter(f => f.tier === 'routine')
    const groups = new Map<string, Filing[]>()
    for (const f of routine) { const g = routineGroup(f.category, f.headline); groups.set(g, [...(groups.get(g) || []), f]) }
    // one row per stock (its latest crossing in the window), most recent first
    const moves: Move[] = holdings.map(h => movesInWindow(h.ticker, prices[h.ticker], th, since)[0]).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.changePct) - Math.abs(a.changePct))
    const lastSession = holdings.map(h => lastRegular(h.ticker, prices[h.ticker], th)).filter(m => m && m.reasons.length) as Move[]
    return { inWin, act, glance, routine, groups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length), moves, lastSession }
  }, [filings, since, th, holdings, prices])

  const open = view.act.filter(f => !done.includes(f.id))
  const handled = view.act.filter(f => done.includes(f.id))
  const toggle = (id: string) => setDone(done.includes(id) ? done.filter(x => x !== id) : [...done, id])
  const needYou = open.length

  const listen = () => {
    if (!('speechSynthesis' in window)) return
    const lines = [
      `Good ${new Date(now).getHours() < 12 ? 'morning' : 'evening'}. In the last ${w.label}, FINN read ${view.inWin.length} filings across your ${holdings.length} holdings. ${open.length} need you.`,
      ...open.slice(0, 6).map(f => {
        const e = f.enrichment
        if (e?.kind === 'results') { const r = e.data; return `${name(f.ticker)} results: revenue ${pct(((r.revenue.cur ?? 0) - (r.revenue.yoy ?? 0)) / Math.abs(r.revenue.yoy || 1) * 100, 0).replace('−', 'minus ')} year on year, profit after tax ${pct(((r.pat.cur ?? 0) - (r.pat.yoy ?? 0)) / Math.abs(r.pat.yoy || 1) * 100, 0).replace('−', 'minus ')}.` }
        if (e?.kind === 'people') return `${name(f.ticker)}: ${e.data.summary}`
        return `${name(f.ticker)}: ${e?.kind === 'oneliner' ? e.data.text.split(' — ')[0] : cleanHeadline(f.headline)}.`
      }),
      ...view.moves.slice(0, 3).map(m => `${name(m.ticker)} moved ${pct(m.changePct, 1).replace('−', 'minus ')} on ${m.volMultiple.toFixed(1)} times normal volume.`),
      `${view.routine.length} routine filings were set aside.`,
    ]
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(lines.join(' ').replace(/%/g, ' percent').replace(/₹/g, 'rupees '))
    u.lang = 'en-IN'; u.rate = 1.04
    speechSynthesis.speak(u)
  }

  return (
    <div>
      <header className="flex items-center justify-between pt-1">
        <p className="text-[13px] text-mute">{day(new Date(now).toISOString())}</p>
        <button onClick={listen} className="rounded-full border hair bg-sheet px-3 py-1 text-[12px] font-medium text-ink-2 hover:text-ink" aria-label="Read my brief aloud">Listen · 1 min</button>
      </header>

      {/* The sieve */}
      <section aria-label="What FINN read" className="mt-5">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.02em]">
          FINN read <span className="num">{view.inWin.length}</span> filings.{' '}
          <span className={needYou ? 'text-signal' : 'text-ink-2'}>{needYou ? `${needYou} need${needYou === 1 ? 's' : ''} you.` : 'Nothing needs you.'}</span>
          {view.lastSession.length > 0 && <span className="text-ink-2"> {view.lastSession.length === 1 ? 'One stock' : `${view.lastSession.length} stocks`} moved unusually last session.</span>}
        </h1>
        <Sieve items={view.inWin} done={done} />
        <div className="mt-3 flex items-center justify-between">
          <div className="scroll-x -mx-1 flex gap-1 px-1" role="tablist" aria-label="Time window">
            {WINDOWS.map(x => (
              <button key={x.id} role="tab" aria-selected={x.id === w.id} onClick={() => setWin(x.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] ${x.id === w.id ? 'bg-ink font-semibold text-paper' : 'text-ink-2 hover:bg-wash'}`}>{x.label}</button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-mute">
          {view.act.length} material · {view.glance.length} worth a glance · {view.routine.length} routine, set aside
        </p>
      </section>

      {view.moves.length > 0 && (
        <section className="mt-7" aria-label="Unusual moves">
          <SectionTitle title="Unusual moves" sub={`Your rule: ±${th.priceMovePct}% or ${th.volumeMultiple}× volume · latest crossing per stock`} href="/watch" link="Change" />
          <ul className="sheet divide-y divide-rule rounded-2xl">
            {view.moves.slice(0, 6).map(m => (
              <li key={m.ticker + m.date}>
                <Link href={`/c/${m.ticker}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold">{m.ticker} <span className="font-normal text-mute">{new Date(m.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></p>
                    <p className="text-[12px] text-mute">
                      {m.reasons.includes('volume') ? `${m.volMultiple.toFixed(1)}× usual volume` : `Volume ${m.volMultiple.toFixed(1)}× usual`}
                      {m.delivery != null && m.avgDelivery != null ? ` · ${m.delivery}% delivered vs ${m.avgDelivery.toFixed(0)}% usual` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`num text-[16px] font-semibold ${m.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pct(m.changePct)}</p>
                    <p className="num text-[12px] text-mute">₹{inr(m.close, 1)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7" aria-label="Needs you">
        <SectionTitle title="Needs you" sub={open.length ? `${open.length} open, highest stakes first` : undefined} />
        {open.length === 0 ? (
          <div className="sheet rounded-2xl px-4 py-6 text-center">
            <p className="text-[15px] font-semibold">{view.act.length ? 'You’re through everything material.' : `No material filings in the last ${w.label}.`}</p>
            <p className="mt-1 text-[13px] text-mute">
              {w.id !== '30d' ? <button className="text-signal" onClick={() => setWin(w.id === '24h' ? '7d' : '30d')}>Look back {w.id === '24h' ? '7 days' : '30 days'}</button> : 'FINN checks for new filings every hour on market days.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">{open.map(f => <ActCard key={f.id} f={f} name={name(f.ticker)} onDone={() => toggle(f.id)} />)}</div>
        )}
        {handled.length > 0 && (
          <button onClick={() => setShowDone(!showDone)} className="mt-3 text-[13px] text-mute hover:text-ink">{showDone ? 'Hide' : 'Show'} {handled.length} done</button>
        )}
        {showDone && <div className="mt-3 space-y-3 opacity-70">{handled.map(f => <ActCard key={f.id} f={f} name={name(f.ticker)} done onDone={() => toggle(f.id)} />)}</div>}
      </section>

      {view.glance.length > 0 && (
        <section className="mt-7" aria-label="Worth a glance">
          <SectionTitle title="Worth a glance" sub="The exchange's one-line summary is enough here" />
          <ul className="sheet rounded-2xl px-4">{view.glance.slice(0, 25).map(f => <GlanceRow key={f.id} f={f} />)}</ul>
        </section>
      )}

      {view.routine.length > 0 && (
        <section className="mt-7" aria-label="Routine">
          <details className="sheet rounded-2xl px-4 py-3">
            <summary className="flex items-center justify-between">
              <span><span className="text-[15px] font-semibold">{view.routine.length} routine filings</span><span className="block text-[12px] text-mute">{view.groups.slice(0, 3).map(([g, l]) => `${g} ×${l.length}`).join(', ')}</span></span>
              <span className="text-[13px] text-signal">Show</span>
            </summary>
            <div className="mt-2">
              {view.groups.map(([g, list]) => (
                <details key={g} className="border-t hair py-2">
                  <summary className="flex justify-between text-[13px]"><span>{g}</span><span className="num text-mute">{list.length}</span></summary>
                  <ul className="mt-1">{list.map(f => (
                    <li key={f.id} className="py-1 text-[12px] text-mute"><a href={f.url} target="_blank" rel="noreferrer" className="hover:text-ink"><b className="font-semibold text-ink-2">{f.ticker}</b> {cleanHeadline(f.headline)}</a></li>
                  ))}</ul>
                </details>
              ))}
            </div>
          </details>
        </section>
      )}

      <footer className="mt-8 space-y-1 text-center text-[12px] text-mute">
        <p>Filings and prices refreshed {updatedAt ? new Date(updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'} IST</p>
        <p><Link href="/engine" className="text-signal">How FINN decides, and what it cost</Link></p>
      </footer>
    </div>
  )
}

function SectionTitle({ title, sub, href, link }: { title: string; sub?: string; href?: string; link?: string }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-1">
      <div><h2 className="text-[18px] font-bold tracking-[-0.01em]">{title}</h2>{sub && <p className="text-[12px] text-mute">{sub}</p>}</div>
      {href && <Link href={href} className="text-[13px] text-signal">{link}</Link>}
    </div>
  )
}

/** One tick per filing, oldest → newest. Height is how much the filing earned your attention. */
function Sieve({ items, done }: { items: Filing[]; done: string[] }) {
  const xs = [...items].sort((a, b) => a.ts.localeCompare(b.ts))
  if (!xs.length) return <div className="mt-4 h-14 rounded-lg bg-wash" />
  const n = xs.length
  const gap = n > 160 ? 0.5 : 1
  return (
    <div className="mt-4 flex h-14 items-end" style={{ gap }} role="img" aria-label={`${n} filings: ${xs.filter(x => x.tier === 'act').length} material, ${xs.filter(x => x.tier === 'glance').length} worth a glance, ${xs.filter(x => x.tier === 'routine').length} routine`}>
      {xs.map((f, i) => {
        const h = f.tier === 'act' ? 100 : f.tier === 'glance' ? 42 : 16
        const c = f.tier === 'act' ? (done.includes(f.id) ? 'bg-ink-2/40' : 'bg-signal') : f.tier === 'glance' ? 'bg-ink-2/55' : 'bg-rule'
        return <a key={f.id} href={f.tier === 'act' ? `#f-${f.id}` : undefined} title={`${f.ticker} · ${CATEGORY_LABEL[f.category]}`} className={`tick block flex-1 rounded-[1px] ${c}`} style={{ height: `${h}%`, minWidth: 1, maxWidth: 10, animationDelay: `${Math.min(600, (i / n) * 600)}ms` }} />
      })}
    </div>
  )
}
