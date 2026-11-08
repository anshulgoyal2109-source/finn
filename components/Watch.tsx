'use client'
import Link from 'next/link'
import { useMemo, useState, useEffect } from 'react'
import type { Holding, PriceBook } from '@/lib/types'
import { lastRegular, DEFAULT_THRESHOLDS, alertHistory, type FilingLite, type AlertEvent } from '@/lib/alerts'
import { CATEGORY_LABEL } from '@/lib/classify'
import { useThresholds } from '@/lib/prefs'
import { pct } from '@/lib/format'

const WATCHABLE = ['results', 'mna', 'management_change', 'fund_raise', 'litigation', 'pledging', 'credit_rating', 'insider_trading', 'capex', 'press_release', 'dividend', 'bonus_split'] as const

const CAUSE: Record<AlertEvent['cause'], { label: string; cls: string }> = {
  unexplained: { label: 'Unexplained', cls: 'bg-warn-wash text-warn' },
  filing: { label: 'Filing that day', cls: 'bg-signal-wash text-signal' },
  sector: { label: 'Sector move', cls: 'bg-wash text-ink-2' },
  market: { label: 'Market-wide', cls: 'bg-wash text-ink-2' },
}
const OUTCOMES = ['Explained', 'Watching', 'Dismissed'] as const

export function Watch({ holdings, prices, filings, pushTopic }: { holdings: Holding[]; prices: PriceBook; filings: FilingLite[]; pushTopic?: string }) {
  const [t, setT] = useThresholds()
  const [filter, setFilter] = useState<'all' | AlertEvent['cause']>('all')
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})
  useEffect(() => { try { setOutcomes(JSON.parse(localStorage.getItem('finn.outcomes') || '{}')) } catch { /* ignore */ } }, [])
  const setOutcome = (id: string, o: string) => { const v = { ...outcomes, [id]: outcomes[id] === o ? '' : o }; setOutcomes(v); try { localStorage.setItem('finn.outcomes', JSON.stringify(v)) } catch { /* ignore */ } }
  const history = useMemo(() => alertHistory(holdings, prices, t, filings, 30), [holdings, prices, t, filings])
  const shown = history.filter(a => filter === 'all' || a.cause === filter)
  const muted = new Set(t.muted || [])
  const toggleMute = (tk: string) => setT({ ...t, muted: muted.has(tk) ? [...muted].filter(x => x !== tk) : [...muted, tk] })
  const rows = holdings.map(h => ({ h, m: lastRegular(h.ticker, prices[h.ticker], t) })).filter(x => x.m)
    .sort((a, b) => (b.m!.reasons.length - a.m!.reasons.length) || Math.abs(b.m!.changePct) - Math.abs(a.m!.changePct))
  const hits = rows.filter(r => r.m!.reasons.length)
  return (
    <div>
      <h1 className="pt-2 text-[28px] font-bold tracking-[-0.02em]">What counts as unusual</h1>
      <p className="mt-1 text-[14px] text-ink-2">You set the rules. FINN checks every holding after the close and flags anything that crosses them.</p>

      <section className="sheet mt-5 space-y-5 rounded-2xl p-4">
        <Slider label="Volume spike" value={t.volumeMultiple} min={1.5} max={5} step={0.5} fmt={v => `${v}× the 20-day average`} onChange={v => setT({ ...t, volumeMultiple: v })} />
        <Slider label="Price move in a day" value={t.priceMovePct} min={1} max={10} step={0.5} fmt={v => `±${v}%`} onChange={v => setT({ ...t, priceMovePct: v })} />
        <p className="text-[13px] text-mute">Last session: <b className="font-semibold text-ink">{hits.length}</b> of {rows.length} holdings cross these rules. Last 30 sessions: <b className="font-semibold text-ink">{history.length}</b> alerts, {history.filter(a => a.cause === 'unexplained').length} unexplained.</p>
      </section>

      <section className="mt-6">
        <h2 className="px-1 text-[18px] font-bold">Last session, against your rules</h2>
        <p className="px-1 text-[12px] text-mute">Tap the bell to mute a stock you don’t want alerts for.</p>
        <ul className="sheet mt-2 divide-y divide-rule rounded-2xl">
          {rows.map(({ h, m }) => (
            <li key={h.ticker} className="flex items-center"><button onClick={() => toggleMute(h.ticker)} aria-label={muted.has(h.ticker) ? `Unmute ${h.ticker}` : `Mute ${h.ticker}`} title={muted.has(h.ticker) ? 'Muted: tap to unmute' : 'Mute alerts for this stock'} className={`grid h-10 w-10 shrink-0 place-items-center pl-2 ${muted.has(h.ticker) ? 'text-down' : 'text-mute/50 hover:text-mute'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4h4" />{muted.has(h.ticker) && <path d="M4 4l16 16" />}</svg>
              </button><Link href={`/c/${h.ticker}`} className={`flex flex-1 items-center justify-between gap-3 py-2.5 pl-1 pr-4 ${muted.has(h.ticker) ? 'opacity-40' : ''}`}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${m!.reasons.length && !muted.has(h.ticker) ? 'bg-signal' : 'bg-rule'}`} aria-hidden />
                <span className="text-[14px] font-semibold">{h.ticker}</span>
              </span>
              <span className="num flex gap-4 text-[13px]">
                <span className={m!.reasons.includes('volume') ? 'font-semibold text-signal' : 'text-mute'}>{m!.volMultiple.toFixed(1)}×</span>
                <span className={`w-14 text-right ${m!.reasons.includes('price') ? 'font-semibold' : ''} ${m!.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pct(m!.changePct)}</span>
              </span>
            </Link></li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="px-1 text-[18px] font-bold">Alert history</h2>
        <p className="px-1 text-[12px] text-mute">Last 30 sessions under your current rules. Each alert says what triggered it and the likeliest reason.</p>
        <div className="scroll-x mt-2 flex gap-1.5">
          {(['all', 'unexplained', 'filing', 'sector', 'market'] as const).map(c => {
            const n = c === 'all' ? history.length : history.filter(a => a.cause === c).length
            return <button key={c} onClick={() => setFilter(c)} aria-pressed={filter === c} className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] ${filter === c ? 'bg-ink font-semibold text-paper' : 'border hair bg-sheet text-ink-2'}`}>{c === 'all' ? 'All' : CAUSE[c].label} {n}</button>
          })}
        </div>
        {shown.length === 0 ? <p className="sheet mt-2 rounded-2xl px-4 py-5 text-center text-[13px] text-mute">No alerts of this kind in the last 30 sessions.</p> : (
          <ul className="mt-2 space-y-2">
            {shown.slice(0, 40).map(a => {
              const id = a.ticker + a.date, o = outcomes[id]
              return (
                <li key={id} className={`sheet rounded-2xl p-3.5 ${o === 'Dismissed' ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                        <Link href={`/c/${a.ticker}`} className="text-[14px] font-semibold text-ink">{a.ticker}</Link>
                        <span>{new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAUSE[a.cause].cls}`}>{CAUSE[a.cause].label}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`num text-[16px] font-semibold ${a.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pct(a.changePct)}</p>
                      <p className="num text-[11px] text-mute">{a.volMultiple.toFixed(1)}× vol · {a.relative >= 0 ? '+' : '−'}{Math.abs(a.relative).toFixed(1)} vs portfolio</p>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{a.reason}</p>
                  {a.filings[0] && <a href={a.filings[0].url} target="_blank" rel="noreferrer" className="mt-1 block text-[12px] text-signal">Open the filing</a>}
                  <div className="mt-2 flex gap-1.5" role="group" aria-label="Your follow-up">
                    {OUTCOMES.map(x => <button key={x} onClick={() => setOutcome(id, x)} aria-pressed={o === x} className={`rounded-full px-2.5 py-0.5 text-[11px] ${o === x ? 'bg-ink text-paper' : 'border hair text-mute'}`}>{x}</button>)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="px-1 text-[18px] font-bold">Filings that should reach you</h2>
        <p className="px-1 text-[12px] text-mute">Unticked types still surface if FINN scores them as very material.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WATCHABLE.map(c => {
            const on = t.categories.includes(c)
            return <button key={c} aria-pressed={on} onClick={() => setT({ ...t, categories: on ? t.categories.filter(x => x !== c) : [...t.categories, c] })}
              className={`rounded-full border px-3 py-1.5 text-[13px] ${on ? 'border-ink bg-ink text-paper' : 'hair bg-sheet text-ink-2'}`}>{CATEGORY_LABEL[c]}</button>
          })}
        </div>
        <button onClick={() => setT(DEFAULT_THRESHOLDS)} className="mt-4 px-1 text-[13px] text-mute">Reset to defaults</button>
      </section>

      <section className="sheet mt-6 rounded-2xl p-4">
        <h2 className="text-[16px] font-bold">Phone alerts</h2>
        {pushTopic ? (
          <p className="mt-1 text-[13px] leading-snug text-ink-2">After each hourly check, FINN sends material filings and threshold crossings to the free ntfy app. Install ntfy and subscribe to <b className="font-semibold text-ink">{pushTopic}</b>.</p>
        ) : (
          <p className="mt-1 text-[13px] leading-snug text-ink-2">Not switched on for this deployment. The pipeline can push material filings and threshold crossings to the free ntfy app: set an <code className="rounded bg-wash px-1">NTFY_TOPIC</code> secret on the GitHub repo and subscribe to that topic in ntfy. Until then, alerts appear here and on Today.</p>
        )}
        <p className="mt-2 text-[12px] text-mute">Phone alerts use the default rule (±4%, 2× volume). The sliders above change what you see in the app.</p>
      </section>
    </div>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex justify-between text-[14px]"><span className="font-semibold">{label}</span><span className="num text-signal">{fmt(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-signal)]" />
    </label>
  )
}
