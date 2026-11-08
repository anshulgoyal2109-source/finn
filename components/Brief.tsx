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

  const [allGlance, setAllGlance] = useState(false)
  return (
    <div>
      <header className="flex items-center justify-between pt-1">
        <p className="text-[13px] text-mute">{day(new Date(now).toISOString())}</p>
        <button onClick={listen} className="rounded-full border hair bg-sheet px-3 py-1 text-[12px] font-medium text-ink-2 hover:text-ink" aria-label="Read my brief aloud">▶ Listen</button>
      </header>

      {/* Hero: one statement, then the sieve that shows how much was filtered */}
      <section aria-label="Summary" className="mt-6">
        <h1 className="text-[34px] font-bold leading-[1.05] tracking-[-0.025em]">
          {needYou ? <><span className="text-signal">{needYou}</span> {needYou === 1 ? 'thing needs' : 'things need'} you</> : 'You’re all caught up'}
        </h1>
        <p className="mt-2 text-[15px] leading-snug text-ink-2">
          FINN read {view.inWin.length} filings from your {holdings.length} holdings in the last {w.label}
          {view.lastSession.length > 0 ? `, and ${view.lastSession.length === 1 ? 'one stock' : `${view.lastSession.length} stocks`} moved unusually.` : '.'}
        </p>
        <Sieve items={view.inWin} done={done} />
        <p className="mt-2 flex gap-4 text-[11px] text-mute">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-signal align-middle" />{view.act.length} material</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ink-2/55 align-middle" />{view.glance.length} worth a glance</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rule align-middle" />{view.routine.length} routine</span>
        </p>
        <div className="mt-5 grid grid-cols-4 rounded-xl bg-wash p-1" role="tablist" aria-label="Time window">
          {WINDOWS.map(x => (
            <button key={x.id} role="tab" aria-selected={x.id === w.id} onClick={() => setWin(x.id)}
              className={`rounded-lg py-1.5 text-[13px] ${x.id === w.id ? 'bg-sheet font-semibold text-ink shadow-[0_1px_2px_rgba(26,34,48,.08)]' : 'text-ink-2'}`}>{x.label}</button>
          ))}
        </div>
      </section>

      <section className="mt-9" aria-label="Needs you">
        <SectionTitle title="Needs you" sub={open.length ? 'Highest stakes first. Tap a card for details, ✓ when handled.' : undefined} />
        {open.length === 0 ? (
          <div className="sheet rounded-2xl px-4 py-7 text-center">
            <p className="text-[15px] font-semibold">{view.act.length ? 'Nothing material left to look at.' : `No material filings in the last ${w.label}.`}</p>
            <p className="mt-1 text-[13px] text-mute">
              {w.id !== '30d' ? <button className="text-signal" onClick={() => setWin(w.id === '24h' ? '7d' : '30d')}>Look back {w.id === '24h' ? '7 days' : '30 days'}</button> : 'FINN checks for new filings every hour on market days.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">{open.map(f => <ActCard key={f.id} f={f} name={name(f.ticker)} onDone={() => toggle(f.id)} />)}</div>
        )}
        {handled.length > 0 && (
          <button onClick={() => setShowDone(!showDone)} className="mt-3 px-1 text-[13px] text-mute hover:text-ink">{showDone ? 'Hide' : 'Show'} {handled.length} done</button>
        )}
        {showDone && <div className="mt-3 space-y-2.5 opacity-60">{handled.map(f => <ActCard key={f.id} f={f} name={name(f.ticker)} done onDone={() => toggle(f.id)} />)}</div>}
      </section>

      {view.moves.length > 0 && (
        <section className="mt-9" aria-label="Unusual moves">
          <SectionTitle title="Unusual moves" sub={`Beyond ±${th.priceMovePct}% or ${th.volumeMultiple}× normal volume`} href="/watch" link="Edit rule" />
          <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1">
            {view.moves.map(m => (
              <Link key={m.ticker + m.date} href={`/c/${m.ticker}`} className="sheet w-[138px] shrink-0 rounded-2xl p-3">
                <p className="text-[13px] font-semibold">{m.ticker}</p>
                <p className={`num mt-1 text-[22px] font-bold leading-none ${m.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pct(m.changePct)}</p>
                <p className="mt-2 text-[11px] leading-snug text-mute">{m.volMultiple.toFixed(1)}× volume<br />{new Date(m.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {view.glance.length > 0 && (
        <section className="mt-9" aria-label="Worth a glance">
          <SectionTitle title="Worth a glance" sub="Not urgent, but good to know" />
          <ul className="sheet rounded-2xl px-4">{view.glance.slice(0, allGlance ? 40 : 5).map(f => <GlanceRow key={f.id} f={f} />)}</ul>
          {view.glance.length > 5 && <button onClick={() => setAllGlance(!allGlance)} className="mt-2 px-1 text-[13px] text-signal">{allGlance ? 'Show fewer' : `Show all ${view.glance.length}`}</button>}
        </section>
      )}

      {view.routine.length > 0 && (
        <section className="mt-9" aria-label="Routine">
          <details className="rounded-2xl border border-dashed hair px-4 py-3">
            <summary className="flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="text-[14px] font-semibold text-ink-2">{view.routine.length} routine filings set aside</span><span className="block truncate text-[12px] text-mute">{view.groups.slice(0, 3).map(([g, l]) => `${g} ×${l.length}`).join(', ')}</span></span>
              <span className="shrink-0 text-[13px] text-signal">View</span>
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

      <footer className="mt-10 space-y-1 text-center text-[12px] text-mute">
        <p>Updated {updatedAt ? new Date(updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'} IST</p>
        <p><Link href="/engine" className="text-signal">How FINN decides, and what it cost</Link></p>
      </footer>
    </div>
  )
}

function SectionTitle({ title, sub, href, link }: { title: string; sub?: string; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <div><h2 className="text-[20px] font-bold tracking-[-0.015em]">{title}</h2>{sub && <p className="text-[12px] text-mute">{sub}</p>}</div>
      {href && <Link href={href} className="text-[13px] text-signal">{link}</Link>}
    </div>
  )
}

/** One tick per filing, oldest → newest. Height is how much the filing earned your attention. */
function Sieve({ items, done }: { items: Filing[]; done: string[] }) {
  const xs = [...items].sort((a, b) => a.ts.localeCompare(b.ts))
  if (!xs.length) return <div className="mt-5 h-12 rounded-lg bg-wash" />
  const n = xs.length
  const gap = n > 160 ? 0.5 : 1
  return (
    <div className="mt-5 flex h-12 items-end" style={{ gap }} role="img" aria-label={`${n} filings: ${xs.filter(x => x.tier === 'act').length} material, ${xs.filter(x => x.tier === 'glance').length} worth a glance, ${xs.filter(x => x.tier === 'routine').length} routine`}>
      {xs.map((f, i) => {
        const h = f.tier === 'act' ? 100 : f.tier === 'glance' ? 42 : 16
        const c = f.tier === 'act' ? (done.includes(f.id) ? 'bg-ink-2/40' : 'bg-signal') : f.tier === 'glance' ? 'bg-ink-2/55' : 'bg-rule'
        return <a key={f.id} href={f.tier === 'act' ? `#f-${f.id}` : undefined} title={`${f.ticker} · ${CATEGORY_LABEL[f.category]}`} className={`tick block flex-1 rounded-[1px] ${c}`} style={{ height: `${h}%`, minWidth: 1, maxWidth: 10, animationDelay: `${Math.min(600, (i / n) * 600)}ms` }} />
      })}
    </div>
  )
}
