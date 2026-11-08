'use client'
import Link from 'next/link'
import { useState } from 'react'
import type { Filing, ResultsCut, PeopleChange, MetricRow } from '@/lib/types'
import { CATEGORY_LABEL } from '@/lib/classify'
import { inr, pct, chg, tone, ago } from '@/lib/format'

export function cleanHeadline(h: string) {
  return h
    .replace(/^(company update|agm\/egm|board meeting|result|insider trading \/ sast|integrated filing|new listing)\s*-\s*[^-]*-\s*/i, '')
    .replace(/announcement under regulation 30 \(lodr\)\s*-\s*/ig, '')
    .replace(/^announcement under regulation 30 of sebi \(lodr\)[^-]*-\s*/i, '')
    .replace(/\s+/g, ' ').trim()
}

const Pill = ({ children, kind = 'plain' }: { children: React.ReactNode; kind?: 'plain' | 'signal' | 'good' | 'bad' | 'warn' }) => {
  const c = { plain: 'bg-wash text-ink-2', signal: 'bg-signal-wash text-signal', good: 'bg-up-wash text-up', bad: 'bg-down-wash text-down', warn: 'bg-warn-wash text-warn' }[kind]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>
}
export { Pill }

function MetricLine({ label, r, hint }: { label: string; r: MetricRow; hint?: string }) {
  const q = chg(r.cur, r.prev), y = chg(r.cur, r.yoy)
  return (
    <tr className="border-t hair">
      <th scope="row" className="py-2 pr-2 text-left text-[13px] font-normal text-ink-2">{label}{hint && <span className="block text-[11px] text-mute">{hint}</span>}</th>
      <td className="num py-2 text-right text-[15px] font-semibold">{inr(r.cur)}</td>
      <td className={`num py-2 pl-3 text-right text-[13px] font-medium ${tone(q)}`}>{pct(q)}</td>
      <td className={`num py-2 pl-3 text-right text-[13px] font-medium ${tone(y)}`}>{pct(y)}</td>
    </tr>
  )
}

export function ResultsBody({ r }: { r: ResultsCut }) {
  return (
    <div className="mt-3">
      <table className="w-full">
        <caption className="sr-only">Headline numbers</caption>
        <thead><tr className="text-[11px] text-mute"><th className="text-left font-normal">{r.period} · {r.unit}</th><th /><th className="pl-3 text-right font-normal">vs last qtr</th><th className="pl-3 text-right font-normal">vs year ago</th></tr></thead>
        <tbody>
          <MetricLine label="Revenue" r={r.revenue} />
          <MetricLine label={r.lender ? 'Net interest income' : 'EBITDA'} hint={r.lender ? 'Lenders: interest earned − expended' : undefined} r={r.ebitda} />
          <MetricLine label="Profit before tax" r={r.pbt} />
          <MetricLine label="Profit after tax" r={r.pat} />
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-mute">
        {r.source === 'filing'
          ? <>Read from the results filing{r.pages?.length ? `, p. ${r.pages.join(', ')}` : ''}, {r.basis}. {r.verified === 'match' ? <span className="text-up">Matches the standardised table.</span> : r.note}</>
          : <>{r.note || `Standardised ${r.basis} figures (filing not machine-readable).`}</>}
        {!r.lender && ' EBITDA = PBT + finance costs + D&A − other income.'}
      </p>
    </div>
  )
}

export function PeopleBody({ p }: { p: PeopleChange }) {
  return (
    <div className="mt-2 space-y-3">
      <p className="text-[14px] leading-snug text-ink-2">{p.summary}</p>
      {p.people.filter(x => x.direction === 'in' || !p.people.some(y => y.direction === 'in')).map(x => (
        <div key={x.name + x.role} className="rounded-xl bg-wash p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold">{x.name}</p>
            <Pill kind={x.direction === 'in' ? 'good' : 'bad'}>{x.direction === 'in' ? 'Incoming' : 'Leaving'}</Pill>
          </div>
          <p className="text-[12px] text-mute">{x.role}</p>
          {x.bio ? <p className="mt-1.5 text-[13px] leading-snug">{x.bio}</p> : <p className="mt-1.5 text-[13px] text-mute">The filing carries no profile.</p>}
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {x.bioUnverified && <span className="text-warn">Background from model knowledge — verify</span>}
            {x.sources?.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-signal underline-offset-2 hover:underline">{s.title}</a>)}
          </p>
        </div>
      ))}
      {p.people.filter(x => x.direction === 'out').length > 0 && p.people.some(y => y.direction === 'in') && (
        <p className="text-[12px] text-mute">Leaving: {p.people.filter(x => x.direction === 'out').map(x => `${x.name} (${x.role})`).join('; ')}</p>
      )}
    </div>
  )
}

/** Compact by default: what happened + the one line that matters. Tap to open the full detail. */
export function ActCard({ f, name, onDone, done }: { f: Filing; name: string; onDone?: () => void; done?: boolean }) {
  const [open, setOpen] = useState(false)
  const e = f.enrichment
  const title = e?.kind === 'results' ? `${name}: ${e.data.period} results` : e?.kind === 'people' ? peopleTitle(e.data, name) : e?.kind === 'oneliner' ? e.data.text.split(' — ')[0] : cleanHeadline(f.headline)
  return (
    <article id={`f-${f.id}`} className="sheet rounded-2xl">
      <div className="flex items-start gap-3 p-4">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-[12px] text-mute">
            <span className="font-semibold text-ink">{f.ticker}</span>
            <span className="text-signal">{CATEGORY_LABEL[f.category]}</span>
            <span>{ago(f.ts)}</span>
            <span className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>⌄</span>
          </p>
          <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug">{title}</h3>
          <KeyLine f={f} />
        </button>
        {onDone && (
          <button onClick={onDone} aria-label={done ? 'Mark as not done' : 'Mark as done'}
            className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[14px] ${done ? 'border-up bg-up text-paper' : 'hair text-mute hover:border-ink hover:text-ink'}`}>✓</button>
        )}
      </div>
      {open && (
        <div className="border-t hair px-4 pb-4">
          {e?.kind === 'results' && <ResultsBody r={e.data} />}
          {e?.kind === 'people' && <PeopleBody p={e.data} />}
          {e?.kind === 'oneliner' && e.data.text.includes(' — ') && <p className="mt-3 text-[14px] leading-snug text-ink-2">{e.data.text.split(' — ').slice(1).join(' — ')}</p>}
          {!e && f.blurb && <p className="mt-3 text-[14px] leading-snug text-ink-2">{f.blurb}</p>}
          <p className="mt-3 flex items-center justify-between gap-3 text-[12px]">
            <span className="min-w-0 text-mute">{f.why}</span>
            <span className="flex shrink-0 gap-3"><a href={f.url} target="_blank" rel="noreferrer" className="text-signal">Open filing</a><Link href={`/c/${f.ticker}`} className="text-signal">Research</Link></span>
          </p>
        </div>
      )}
    </article>
  )
}

/** The single line that earns the card its place. */
function KeyLine({ f }: { f: Filing }) {
  const e = f.enrichment
  if (e?.kind === 'results') {
    const r = e.data
    const items: [string, number | null][] = [['Revenue', chg(r.revenue.cur, r.revenue.yoy)], ['Profit', chg(r.pat.cur, r.pat.yoy)]]
    return <p className="mt-1.5 flex gap-3 text-[13px]">{items.map(([k, v]) => <span key={k} className="text-ink-2">{k} <b className={`font-semibold ${tone(v)}`}>{pct(v, 0)}</b></span>)}<span className="text-mute">vs year ago</span></p>
  }
  if (e?.kind === 'people') {
    const inc = e.data.people.find(x => x.direction === 'in' && x.bio)
    return inc?.bio ? <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink-2">{inc.bio}</p> : null
  }
  if (e?.kind === 'oneliner' && e.data.text.includes(' — ')) return <p className="mt-1.5 line-clamp-1 text-[13px] text-ink-2">{e.data.text.split(' — ').slice(1).join(' — ')}</p>
  return f.blurb && !e ? <p className="mt-1.5 line-clamp-1 text-[13px] text-ink-2">{f.blurb}</p> : null
}

function peopleTitle(p: PeopleChange, name: string) {
  const inc = p.people.find(x => x.direction === 'in' && /ceo|md|managing|chief|chair|cfo|whole/i.test(x.role)) || p.people.find(x => x.direction === 'in')
  const out = p.people.find(x => x.direction === 'out')
  if (inc) return `${inc.name} in as ${shortRole(inc.role)}`
  if (out) return `${out.name} steps down as ${shortRole(out.role)}`
  return `${name}: leadership change`
}
const shortRole = (r: string) => r.replace(/Managing Director (and|&) Chief Executive Officer/i, 'MD & CEO').replace(/Chief Executive Officer/i, 'CEO').replace(/Chief Financial Officer/i, 'CFO').replace(/\s*\(.*?\)\s*/g, ' ').trim()

export function GlanceRow({ f }: { f: Filing }) {
  const text = f.enrichment?.kind === 'oneliner' ? f.enrichment.data.text : f.blurb || cleanHeadline(f.headline)
  return (
    <li className="flex gap-3 border-t hair py-3.5 first:border-t-0">
      <Link href={`/c/${f.ticker}`} className="w-[86px] shrink-0 text-[13px] font-semibold hover:text-signal">{f.ticker}<span className="block text-[11px] font-normal text-mute">{CATEGORY_LABEL[f.category]}</span></Link>
      <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2 hover:text-ink">
        <span className="line-clamp-2">{text}</span>
        <span className="mt-0.5 block text-[11px] text-mute">{ago(f.ts)}</span>
      </a>
    </li>
  )
}
