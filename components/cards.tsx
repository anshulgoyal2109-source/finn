'use client'
import Link from 'next/link'
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

export function ActCard({ f, name, onDone, done }: { f: Filing; name: string; onDone?: () => void; done?: boolean }) {
  const e = f.enrichment
  return (
    <article id={`f-${f.id}`} className="sheet rounded-2xl p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] text-mute">
            <Link href={`/c/${f.ticker}`} className="font-semibold text-ink hover:text-signal">{f.ticker}</Link>
            <Pill kind="signal">{CATEGORY_LABEL[f.category]}</Pill>
            <span>{ago(f.ts)}</span>
          </p>
          <h3 className="mt-1.5 text-[16px] font-semibold leading-snug">
            {e?.kind === 'results' ? `${name}: ${e.data.period} results` : e?.kind === 'people' ? peopleTitle(e.data, name) : e?.kind === 'oneliner' ? e.data.text.split(' — ')[0] : cleanHeadline(f.headline)}
          </h3>
        </div>
      </header>
      {e?.kind === 'results' && <ResultsBody r={e.data} />}
      {e?.kind === 'people' && <PeopleBody p={e.data} />}
      {e?.kind === 'oneliner' && e.data.text.includes(' — ') && <p className="mt-2 text-[14px] leading-snug text-ink-2">{e.data.text.split(' — ').slice(1).join(' — ')}</p>}
      {!e && f.blurb && <p className="mt-2 text-[14px] leading-snug text-ink-2">{f.blurb}</p>}
      <footer className="mt-3 flex items-center justify-between gap-2 border-t hair pt-3">
        <p className="min-w-0 truncate text-[12px] text-mute" title={f.why}>{f.why}</p>
        <div className="flex shrink-0 items-center gap-1">
          <a href={f.url} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-wash">Filing</a>
          {onDone && <button onClick={onDone} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${done ? 'bg-wash text-ink-2' : 'bg-ink text-paper'}`}>{done ? 'Undo' : 'Done'}</button>}
        </div>
      </footer>
    </article>
  )
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
    <li className="flex gap-3 border-t hair py-3 first:border-t-0">
      <Link href={`/c/${f.ticker}`} className="w-[86px] shrink-0 text-[13px] font-semibold hover:text-signal">{f.ticker}<span className="block text-[11px] font-normal text-mute">{CATEGORY_LABEL[f.category]}</span></Link>
      <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2 hover:text-ink">
        {text}
        <span className="mt-0.5 block text-[11px] text-mute">{ago(f.ts)}{f.why ? ` · ${f.why}` : ''}</span>
      </a>
    </li>
  )
}
