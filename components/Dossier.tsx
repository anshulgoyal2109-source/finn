'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Dossier as D, Filing, GuidanceItem, Verdict } from '@/lib/types'
import { Spark, Columns, PairColumns } from './charts'
import { GlanceRow, Pill } from './cards'
import { inr, pct, ago } from '@/lib/format'
import { ThesisPanel } from './ThesisPanel'

type Live = D & { prices?: { d: string; c: number }[] }
const STATUS: Record<Verdict['status'], { label: string; glyph: string; cls: string }> = {
  delivered: { label: 'Delivered', glyph: '✓', cls: 'bg-up-wash text-up' },
  missed: { label: 'Missed', glyph: '✕', cls: 'bg-down-wash text-down' },
  partly: { label: 'Partly', glyph: '≈', cls: 'bg-warn-wash text-warn' },
  revised: { label: 'Revised', glyph: '↺', cls: 'bg-signal-wash text-signal' },
  pending: { label: 'Pending', glyph: '…', cls: 'bg-wash text-ink-2' },
}

export function Dossier({ ticker, initial, filings, prices, holding }: { ticker: string; initial: D | null; filings: Filing[]; prices: { d: string; c: number }[]; holding: boolean }) {
  const [d, setD] = useState<Live | null>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [livePrices, setLivePrices] = useState(prices)
  const [askQ, setAskQ] = useState<{ q: string; n: number } | null>(null)

  useEffect(() => {
    try { const r = JSON.parse(localStorage.getItem('finn.recent') || '[]').filter((x: string) => x !== ticker); localStorage.setItem('finn.recent', JSON.stringify([ticker, ...r].slice(0, 8))) } catch { /* ignore */ }
    let gone = false
    if (initial?.narrative) {
      if (!prices.length) fetch(`/api/research/${ticker}`).then(r => r.json()).then(j => { if (!gone && j.prices?.length) setLivePrices(j.prices) }).catch(() => {})
      return () => { gone = true }
    }
    ;(async () => {
      if (!initial) {
        const r = await fetch(`/api/research/${ticker}`); const j = await r.json()
        if (gone) return
        if (!r.ok) { setErr(j.error); return }
        setD(j); if (j.prices?.length) setLivePrices(j.prices)
      }
      const msgs = ['Reading the last four earnings-call transcripts', 'Reading the latest annual report', 'Checking each promise against reported numbers']
      let k = 0; setStage(msgs[0])
      const timer = setInterval(() => { k = Math.min(k + 1, msgs.length - 1); setStage(msgs[k]) }, 6000)
      const r = await fetch(`/api/narrative/${ticker}`); const j = await r.json()
      clearInterval(timer)
      if (gone) return
      setStage(null)
      if (!r.ok) { setErr(j.error); return }
      setD(prev => ({ ...(prev || j), narrative: j.narrative, ledger: j.ledger }))
    })().catch(e => { setStage(null); setErr(String(e)) })
    return () => { gone = true }
  }, [ticker, initial])

  if (err && !d) return <p className="mt-10 text-center text-[15px]">{err} <Link href="/research" className="text-signal">Search again</Link></p>
  if (!d) return <Loading text="Pulling reported financials" />
  const f = d.facts, n: any = d.narrative
  // drop weekend special sessions (e.g. Diwali muhurat) so 'day change' means the last full session
  const px = livePrices.filter(p => ![0, 6].includes(new Date(p.d + 'T12:00:00Z').getUTCDay())).map(p => p.c)
  const dayChg = px.length > 1 ? ((px[px.length - 1] - px[px.length - 2]) / px[px.length - 2]) * 100 : null
  const yrChg = px.length > 240 ? ((px[px.length - 1] - px[px.length - 248 < 0 ? 0 : px.length - 248]) / px[Math.max(0, px.length - 248)]) * 100 : null
  const gIndex = new Map<string, any>([...(n?.guidance || []), ...(n?.claims || [])].map((g: any) => [g.id, g]))

  return (
    <div className="pb-24">
      <header className="pt-1">
        <Link href={holding ? '/' : '/research'} className="text-[13px] text-mute">‹ {holding ? 'Today' : 'Research'}</Link>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-mute">{ticker}{holding && <> · <span className="text-signal">In your portfolio</span></>}</p>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{d.name.replace(/ Ltd\.?$/, '')}</h1>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-[20px] font-semibold">₹{inr(f.price ?? px.at(-1) ?? null, f.price && f.price < 100 ? 2 : 0)}</p>
            <p className="num text-[12px]"><span className={dayChg != null && dayChg >= 0 ? 'text-up' : 'text-down'}>{pct(dayChg)}</span>{yrChg != null && <span className="text-mute"> · {pct(yrChg, 0)} 1y</span>}</p>
          </div>
        </div>
        {px.length > 10 && <Spark values={px} w={428} h={44} className="mt-3 h-11 w-full" />}
      </header>

      <ThesisPanel ticker={ticker} facts={f} onAsk={q => setAskQ({ q, n: Date.now() })} />

      <nav className="scroll-x sticky top-0 z-30 -mx-4 mt-4 flex gap-1 bg-paper/95 px-4 py-2 backdrop-blur" aria-label="Sections">
        {[['thesis', 'Your thesis'], ['scorecard', 'Promised vs delivered'], ['guidance', 'Guidance'], ['numbers', 'Numbers'], ['cash', 'Cash & balance sheet'], ['business', 'Business'], ['case', 'Bull & bear'], ['filings', 'Filings']].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full border hair bg-sheet px-3 py-1 text-[12px] text-ink-2">{l}</a>
        ))}
      </nav>

      {/* Promised vs delivered */}
      <section id="scorecard" className="mt-4 scroll-mt-14">
        {!n && stage && <Loading text={stage} small />}
        {!n && err && <p className="sheet rounded-2xl p-4 text-[14px] text-ink-2">{err}</p>}
        {n && (
          <>
            <p className="text-[12px] text-mute">Management’s word vs the reported numbers, last {n.calls?.filter((c: any) => !c.duplicate).length || 4} earnings calls</p>
            {n.scoreline && <h2 className="mt-1 text-[20px] font-semibold leading-snug tracking-[-0.01em]">{n.scoreline}</h2>}
            <Tally rows={n.scorecard} />
            <ul className="mt-3 space-y-2">{n.scorecard.map((v: Verdict, i: number) => <VerdictRow key={i} v={v} g={gIndex} />)}</ul>
            {n.scorecard.length === 0 && <p className="mt-3 text-[14px] text-mute">{n.calls?.length ? 'Management gave no explicit numeric guidance in these calls that FINN could verify against the transcript text.' : 'This company publishes no earnings-call transcripts, so there are no promises to check. The numbers and annual report below still apply.'}</p>}
            {n.narrativeVsNumbers?.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[16px] font-bold">Story vs numbers</h3>
                <ul className="mt-2 space-y-2">
                  {n.narrativeVsNumbers.map((x: any, i: number) => (
                    <li key={i} className="sheet rounded-xl p-3">
                      <p className="flex gap-2 text-[13px]"><span className={x.agrees ? 'text-up' : 'text-down'} aria-label={x.agrees ? 'agrees' : 'diverges'}>{x.agrees ? '●' : '○'}</span><span><span className="text-ink-2">They said:</span> {x.claim}</span></p>
                      <p className="mt-1 pl-5 text-[13px]"><span className="text-ink-2">Numbers:</span> {x.reality}</p>
                      <Cites ids={x.cites} g={gIndex} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* Guidance: what management has explicitly guided, newest call first */}
      {n?.guidance?.length > 0 && (
        <section id="guidance" className="mt-9 scroll-mt-14">
          <H2 title="What management has guided" sub="Explicit forward statements on headline numbers, newest call first. Each quote is verified against the transcript." />
          <ul className="sheet divide-y divide-rule rounded-2xl">
            {(n.guidance as GuidanceItem[]).slice(0, 10).map(g => (
              <li key={g.id} className="px-4 py-3">
                <p className="flex items-baseline justify-between gap-3"><span className="text-[14px] font-semibold">{g.metric.charAt(0).toUpperCase() + g.metric.slice(1)}</span><span className="shrink-0 text-[11px] text-mute">for {g.horizon}</span></p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{g.statement}</p>
                <a href={`${g.url}#page=${g.page}`} target="_blank" rel="noreferrer" className="mt-1 block text-[12px] text-signal">{g.call} call, p.{g.page}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Numbers */}
      <section id="numbers" className="mt-9 scroll-mt-14">
        <H2 title="Numbers" sub={`${f.basis === 'consolidated' ? 'Consolidated' : 'Standalone'}, as reported`} />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hair bg-rule">
          {f.headline.map(h => (
            <div key={h.label} className="bg-sheet p-3">
              <dt className="text-[12px] text-mute">{h.label}</dt>
              <dd className="num mt-0.5 text-[18px] font-semibold">{h.value}</dd>
              {h.sub && <dd className={`num text-[11px] ${h.tone === 'down' ? 'text-down' : h.tone === 'up' ? 'text-up' : 'text-mute'}`}>{h.sub}</dd>}
            </div>
          ))}
        </dl>
        {f.flags.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {f.flags.map((x, i) => <li key={i} className="flex gap-2 text-[13px] leading-snug"><span className={x.tone === 'good' ? 'text-up' : x.tone === 'bad' ? 'text-down' : 'text-mute'}>{x.tone === 'good' ? '▲' : x.tone === 'bad' ? '▼' : '•'}</span>{x.text}</li>)}
          </ul>
        )}
        <div className="sheet mt-4 rounded-2xl p-4">
          <p className="text-[13px] font-semibold">Quarterly revenue <span className="font-normal text-mute">₹ cr</span></p>
          <div className="mt-2"><Columns labels={f.quarterly.cols} values={f.quarterly.revenue} /></div>
          <p className="num mt-2 text-[12px] text-mute">YoY growth: {f.quarterly.revYoY.slice(-5).map((x, i) => <span key={i} className={`mr-2 ${x == null ? '' : x >= 0 ? 'text-up' : 'text-down'}`}>{pct(x, 0)}</span>)}</p>
        </div>
        <div className="mt-3 grid gap-3">
          {f.trajectory.map(t => (
            <div key={t.label} className="sheet rounded-2xl p-4">
              <p className="text-[13px] font-semibold">{t.label} <span className="font-normal text-mute">{t.unit}, by fiscal year</span></p>
              <div className="mt-2"><Columns labels={t.years} values={t.values} unit={t.unit} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* Cash & balance sheet */}
      <section id="cash" className="mt-9 scroll-mt-14">
        <H2 title="Do profits turn into cash?" sub={f.cash.conversion != null && !f.lender ? `5-year operating cash = ${Math.round(f.cash.conversion * 100)}% of profit` : undefined} />
        <div className="sheet rounded-2xl p-4"><PairColumns labels={f.cash.years} a={f.cash.cfo} b={f.cash.pat} aLabel="Cash from operations" bLabel="Net profit" /></div>
        <H2 title="Balance sheet" className="mt-6" />
        <ul className="sheet divide-y divide-rule rounded-2xl">
          {f.balance.map(b => (
            <li key={b.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-[13px] text-ink-2">{b.label}{b.note && <span className="block text-[11px] text-mute">{b.note}</span>}</span>
              <span className={`num text-[15px] font-semibold ${b.tone === 'bad' ? 'text-down' : b.tone === 'good' ? 'text-up' : ''}`}>{b.value}</span>
            </li>
          ))}
        </ul>
        {n?.risks?.length > 0 && (
          <div className="mt-3 rounded-2xl bg-warn-wash/60 p-4">
            <p className="text-[13px] font-semibold text-warn">From the annual report’s notes</p>
            <ul className="mt-1 space-y-1">{n.risks.slice(0, 4).map((r: any, i: number) => <li key={i} className="text-[13px] leading-snug">{r.text} {f.docs.annualReports[0] && <a className="text-signal" href={`${f.docs.annualReports[0].url}#page=${r.page}`} target="_blank" rel="noreferrer">p.{r.page}</a>}</li>)}</ul>
          </div>
        )}
      </section>

      {/* Business */}
      <section id="business" className="mt-9 scroll-mt-14">
        <H2 title="What the business is" />
        <p className="text-[14px] leading-relaxed text-ink-2">{n?.business?.summary || f.about}</p>
        {n?.business?.segments?.length > 0 && (
          <ul className="mt-3 space-y-2">
            {n.business.segments.map((s: any, i: number) => {
              const share = parseFloat(String(s.share).replace('%', ''))
              return (
                <li key={i}>
                  <div className="flex justify-between text-[13px]"><span className="font-semibold">{s.name}</span><span className="num text-mute">{s.share}</span></div>
                  {isFinite(share) && <div className="mt-1 h-1.5 rounded-full bg-wash"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.min(100, share)}%` }} /></div>}
                  <p className="mt-0.5 text-[12px] text-mute">{s.note}{f.docs.annualReports[0] && <> · <a className="text-signal" href={`${f.docs.annualReports[0].url}#page=${s.page}`} target="_blank" rel="noreferrer">AR p.{s.page}</a></>}</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Bull & bear */}
      {n && (
        <section id="case" className="mt-9 scroll-mt-14">
          <H2 title="The case each way" />
          <div className="grid gap-3">
            <div className="rounded-2xl bg-up-wash/70 p-4"><p className="text-[13px] font-bold text-up">Bull</p><ul className="mt-1 space-y-1.5">{n.bull.map((x: string, i: number) => <li key={i} className="text-[14px] leading-snug">{x}</li>)}</ul></div>
            <div className="rounded-2xl bg-down-wash/70 p-4"><p className="text-[13px] font-bold text-down">Bear</p><ul className="mt-1 space-y-1.5">{n.bear.map((x: string, i: number) => <li key={i} className="text-[14px] leading-snug">{x}</li>)}</ul></div>
          </div>
          {n.watch?.length > 0 && (
            <div className="sheet mt-3 rounded-2xl p-4">
              <p className="text-[13px] font-bold">Check next quarter</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[14px] leading-snug">{n.watch.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {/* Filings */}
      <section id="filings" className="mt-9 scroll-mt-14">
        <H2 title="Recent filings" />
        {filings.length ? <ul className="sheet rounded-2xl px-4">{filings.slice(0, 12).map(x => <GlanceRow key={x.id} f={x} />)}</ul>
          : <p className="text-[13px] text-mute">FINN only tracks filings for portfolio companies. <a className="text-signal" href={`https://www.bseindia.com`} target="_blank" rel="noreferrer">BSE</a> has the full list.</p>}
      </section>

      <footer className="mt-8 text-[11px] leading-relaxed text-mute">
        <p>Sources, all primary: {f.docs.transcripts.slice(0, 4).map((t, i) => <a key={t.url} href={t.url} target="_blank" rel="noreferrer" className="text-signal">{i ? ', ' : ''}{t.label}</a>)}{f.docs.annualReports[0] && <>, <a href={f.docs.annualReports[0].url} target="_blank" rel="noreferrer" className="text-signal">{f.docs.annualReports[0].label}</a></>}; financials as reported to the exchanges via screener.in. No news, broker notes or model memory.</p>
        {d.ledger.length > 0 && <p className="mt-1">Built {ago(d.generatedAt)} with {d.ledger.map(l => `${l.calls + l.cached} × ${l.model}`).join(', ')} · {Math.round(d.ledger.reduce((a, l) => a + l.inTok + l.outTok, 0) / 1000)}k tokens.</p>}
      </footer>

      <Ask ticker={ticker} ready={!!n} trigger={askQ} />
    </div>
  )
}

function Tally({ rows }: { rows: Verdict[] }) {
  const c = (s: Verdict['status']) => rows.filter(r => r.status === s).length
  const parts = (['delivered', 'partly', 'missed', 'revised', 'pending'] as const).filter(s => c(s))
  if (!rows.length) return null
  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full">{parts.map(s => <div key={s} className={STATUS[s].cls.split(' ')[0].replace('-wash', '')} style={{ flex: c(s), background: `var(--color-${s === 'delivered' ? 'up' : s === 'missed' ? 'down' : s === 'partly' ? 'warn' : s === 'revised' ? 'signal' : 'rule'})` }} />)}</div>
      <p className="mt-1.5 text-[12px] text-mute">{parts.map(s => `${c(s)} ${STATUS[s].label.toLowerCase()}`).join(' · ')}</p>
    </div>
  )
}

/** Evidence-based confidence: how many verified quotes, across how many calls, and whether the grade rests on numbers. */
export function verdictConfidence(v: Verdict, g: Map<string, any>) {
  const quotes = v.cites.map(id => g.get(id)).filter(x => x && /g\d+$/.test(x.id))
  const calls = new Set(quotes.map(q => q.call)).size
  const numeric = /\d/.test(`${v.delivered} ${v.evidence}`)
  let level: 'High' | 'Medium' | 'Low' = 'Low'
  if (v.status === 'pending') level = numeric && quotes.length ? 'Medium' : 'Low'
  else if (quotes.length >= 2 && calls >= 2 && numeric) level = 'High'
  else if (quotes.length >= 1 && numeric) level = 'Medium'
  const why = `${quotes.length} verified quote${quotes.length === 1 ? '' : 's'} from ${calls} call${calls === 1 ? '' : 's'}${numeric ? ', graded against reported numbers' : ', no number to grade against'}${v.status === 'pending' ? '; target period not over yet' : ''}`
  return { level, why }
}

function VerdictRow({ v, g }: { v: Verdict; g: Map<string, any> }) {
  const [open, setOpen] = useState(false)
  const s = STATUS[v.status]
  const conf = verdictConfidence(v, g)
  return (
    <li className="sheet rounded-2xl">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-3.5 text-left">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${s.cls}`} aria-label={s.label}>{s.glyph}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-semibold leading-snug">{v.metric.charAt(0).toUpperCase() + v.metric.slice(1)}</span><span className={`shrink-0 text-[11px] ${conf.level === 'High' ? 'text-up' : conf.level === 'Medium' ? 'text-ink-2' : 'text-warn'}`}>{conf.level} confidence</span></span>
          <span className="mt-1 block text-[13px] leading-snug"><span className="text-mute">Promised </span>{v.promised}</span>
          <span className="mt-0.5 block text-[13px] leading-snug"><span className="text-mute">Delivered </span>{v.delivered}</span>
        </span>
        <span className="text-[12px] text-mute">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t hair px-3.5 pb-3.5 pt-2">
          <p className="text-[13px] leading-snug text-ink-2">{v.evidence}</p>
          <p className="mt-1 text-[11px] text-mute">Confidence {conf.level.toLowerCase()}: {conf.why}.</p>
          <Cites ids={v.cites} g={g} quotes />
        </div>
      )}
    </li>
  )
}

function Cites({ ids, g, quotes }: { ids: string[]; g: Map<string, any>; quotes?: boolean }) {
  const xs = ids.map(id => g.get(id)).filter(Boolean)
  if (!xs.length) return null
  return (
    <div className="mt-2 space-y-2 pl-0">
      {xs.map((x: GuidanceItem) => quotes ? (
        <blockquote key={x.id} className="border-l-2 border-ink-2/30 pl-3 text-[13px] italic leading-snug text-ink-2">
          “{x.quote}”
          <a href={`${x.url}#page=${x.page}`} target="_blank" rel="noreferrer" className="mt-0.5 block not-italic text-[12px] text-signal">{x.call} call, p.{x.page}</a>
        </blockquote>
      ) : <a key={x.id} href={`${x.url}#page=${x.page}`} target="_blank" rel="noreferrer" className="mr-3 inline-block pl-5 text-[12px] text-signal">{x.call} call, p.{x.page}</a>)}
    </div>
  )
}

function Ask({ ticker, ready, trigger }: { ticker: string; ready: boolean; trigger: { q: string; n: number } | null }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [a, setA] = useState<{ q: string; answer?: string; error?: string; confidence?: string; sources?: { label: string; url: string }[] } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const ask = async (question: string) => {
    if (!question.trim()) return
    setBusy(true); setA({ q: question })
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticker, question }) })
    const j = await r.json(); setBusy(false)
    setA({ q: question, ...(r.ok ? j : { error: j.error }) }); setQ('')
  }
  useEffect(() => { if (trigger && ready) ask(trigger.q) }, [trigger]) // eslint-disable-line react-hooks/exhaustive-deps
  const sugg = ['Why are margins moving?', 'What are the biggest risks?', 'Is profit turning into cash?', 'What contradicts the bull case?', 'What changed in working capital?']
  return (
    <div className="fixed inset-x-0 bottom-[64px] z-30 px-3 pb-2">
      <div className="mx-auto max-w-[440px]">
        {a && (
          <div className="sheet mb-2 max-h-[45vh] overflow-y-auto rounded-2xl p-4 shadow-[0_8px_30px_rgba(26,34,48,.12)]">
            <div className="flex justify-between gap-3"><p className="line-clamp-2 text-[12px] text-mute">{a.q}</p><button onClick={() => setA(null)} className="text-[12px] text-mute" aria-label="Close answer">Close</button></div>
            {busy ? <p className="mt-2 text-[14px] text-ink-2">Reading the two latest call transcripts…</p> : a.error ? <p className="mt-2 text-[14px] text-down">{a.error}</p> : (
              <><p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed">{a.answer}</p>
                <p className="mt-1.5 flex flex-wrap gap-x-3 text-[12px]">{a.sources?.slice(0, 4).map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-signal">{s.label}</a>)}</p>
                {a.confidence && <p className="mt-1 text-[11px] text-mute">Confidence {a.confidence} · answered from the transcripts and reported numbers only</p>}</>
            )}
          </div>
        )}
        {!a && ready && <div className="scroll-x mb-2 flex gap-1.5">{sugg.map(s => <button key={s} onClick={() => ask(s)} className="whitespace-nowrap rounded-full border hair bg-sheet px-3 py-1 text-[12px] text-ink-2">{s}</button>)}</div>}
        <form onSubmit={e => { e.preventDefault(); ask(q) }} className="flex gap-2 rounded-2xl border hair bg-sheet p-1.5 shadow-[0_4px_20px_rgba(26,34,48,.08)]">
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder={ready ? `Ask about ${ticker}…` : 'Ask once the dossier is ready'} disabled={!ready || busy} className="min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none placeholder:text-mute" aria-label={`Ask a question about ${ticker}`} />
          <button disabled={!ready || busy || !q.trim()} className="rounded-xl bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper disabled:opacity-30">Ask</button>
        </form>
      </div>
    </div>
  )
}

const H2 = ({ title, sub, className = '' }: { title: string; sub?: string; className?: string }) => (
  <div className={`mb-2 ${className}`}><h2 className="text-[18px] font-bold tracking-[-0.01em]">{title}</h2>{sub && <p className="text-[12px] text-mute">{sub}</p>}</div>
)

function Loading({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className={`sheet rounded-2xl p-4 ${small ? '' : 'mt-10'}`} role="status" aria-live="polite">
      <p className="text-[14px] font-medium">{text}…</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-wash"><div className="h-1 w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-signal" /></div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      {small && <p className="mt-2 text-[12px] text-mute">Usually 15–30 seconds for a company FINN hasn’t read before. The numbers below are ready now.</p>}
    </div>
  )
}
