'use client'
import { useEffect, useState } from 'react'
import type { Facts } from '@/lib/types'
import { metricsFromFacts, runChecks, fmtMetric, suggestedCheck, type Thesis, type Check } from '@/lib/thesis'

const key = (t: string) => `finn.thesis.${t}`
export const loadThesis = (t: string): Thesis | null => { try { return JSON.parse(localStorage.getItem(key(t)) || 'null') } catch { return null } }

const PROMPTS: [keyof Thesis, string, string][] = [
  ['why', 'Why am I interested?', 'e.g. Market leader compounding at 20%+ with rising margins'],
  ['assumptions', 'Key assumptions', 'e.g. Volume growth stays above 8%; input costs stabilise'],
  ['breaks', 'What would invalidate it?', 'e.g. Two quarters of margin below 18%; promoter selling'],
  ['changeView', 'What would change my view?', 'e.g. A large debt-funded acquisition; loss of market share'],
]

export function ThesisPanel({ ticker, facts, onAsk }: { ticker: string; facts: Facts; onAsk: (q: string) => void }) {
  const [t, setT] = useState<Thesis | null>(null)
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<Thesis | null>(null)
  useEffect(() => { setT(loadThesis(ticker)) }, [ticker])
  const metrics = metricsFromFacts(facts)
  const results = runChecks(t, metrics)
  const breached = results.filter(r => r.status === 'breached')

  const start = () => {
    setDraft(t || { why: '', assumptions: '', breaks: '', changeView: '', updatedAt: '', checks: ['margin', 'revYoY', facts.lender ? 'roce' : 'cashConv'].filter(k => metrics[k]?.value != null).map(k => suggestedCheck(metrics[k])) })
    setEdit(true)
  }
  const save = () => {
    if (!draft) return
    const v = { ...draft, updatedAt: new Date().toISOString() }
    try { localStorage.setItem(key(ticker), JSON.stringify(v)) } catch { /* ignore */ }
    setT(v); setEdit(false)
  }
  const remove = () => { try { localStorage.removeItem(key(ticker)) } catch { /* ignore */ } setT(null); setEdit(false) }
  const setCheck = (i: number, c: Partial<Check>) => draft && setDraft({ ...draft, checks: draft.checks.map((x, j) => j === i ? { ...x, ...c } : x) })

  if (edit && draft) return (
    <section id="thesis" className="sheet mt-5 scroll-mt-14 rounded-2xl p-4">
      <h2 className="text-[17px] font-bold">Your thesis on {ticker}</h2>
      <p className="text-[12px] text-mute">Saved on this device. FINN checks the numbers; the reasoning is yours.</p>
      <div className="mt-3 space-y-3">
        {PROMPTS.map(([k, label, ph]) => (
          <label key={k} className="block">
            <span className="text-[13px] font-semibold">{label}</span>
            <textarea value={draft[k] as string} onChange={e => setDraft({ ...draft, [k]: e.target.value })} placeholder={ph} rows={2}
              className="mt-1 w-full resize-none rounded-xl border hair bg-paper px-3 py-2 text-[14px] outline-none placeholder:text-mute focus:border-signal" />
          </label>
        ))}
      </div>
      <h3 className="mt-4 text-[13px] font-semibold">Numbers to monitor</h3>
      <p className="text-[12px] text-mute">Starting values sit a little below today’s figures. Adjust them to your own limits.</p>
      <ul className="mt-2 space-y-2">
        {draft.checks.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            <select value={c.key} onChange={e => setCheck(i, suggestedCheck(metrics[e.target.value]))} className="min-w-0 flex-1 rounded-lg border hair bg-paper px-2 py-1.5 text-[13px]" aria-label="Indicator">
              {Object.values(metrics).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={c.op} onChange={e => setCheck(i, { op: e.target.value as Check['op'] })} className="rounded-lg border hair bg-paper px-1.5 py-1.5 text-[13px]" aria-label="Condition">
              <option value=">=">at least</option><option value="<=">at most</option>
            </select>
            <input type="number" value={c.value} onChange={e => setCheck(i, { value: Number(e.target.value) })} className="w-16 rounded-lg border hair bg-paper px-2 py-1.5 text-right text-[13px]" aria-label="Limit" />
            <button onClick={() => setDraft({ ...draft, checks: draft.checks.filter((_, j) => j !== i) })} className="px-1 text-[13px] text-mute" aria-label="Remove indicator">✕</button>
          </li>
        ))}
      </ul>
      {draft.checks.length < 6 && <button onClick={() => { const k = Object.keys(metrics).find(k => !draft.checks.some(c => c.key === k)); if (k) setDraft({ ...draft, checks: [...draft.checks, suggestedCheck(metrics[k])] }) }} className="mt-2 text-[13px] text-signal">Add an indicator</button>}
      <div className="mt-4 flex items-center justify-between">
        {t ? <button onClick={remove} className="text-[13px] text-down">Delete thesis</button> : <span />}
        <div className="flex gap-2">
          <button onClick={() => setEdit(false)} className="rounded-lg px-3 py-2 text-[13px] text-ink-2">Cancel</button>
          <button onClick={save} disabled={!draft.why.trim() && !draft.checks.length} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-30">Save thesis</button>
        </div>
      </div>
    </section>
  )

  if (!t) return (
    <section id="thesis" className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-dashed hair px-4 py-3">
      <p className="text-[13px] leading-snug text-ink-2">Write down why you own {ticker} and the numbers that would prove you wrong. FINN will check them for you.</p>
      <button onClick={start} className="shrink-0 rounded-lg bg-ink px-3 py-2 text-[13px] font-semibold text-paper">Write thesis</button>
    </section>
  )

  return (
    <section id="thesis" className="sheet mt-5 scroll-mt-14 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">Your thesis</h2>
          <p className={`text-[13px] font-medium ${breached.length ? 'text-down' : 'text-up'}`}>
            {results.length ? (breached.length ? `${breached.length} of ${results.length} checks breached` : `All ${results.length} checks holding`) : 'No numeric checks yet'}
          </p>
        </div>
        <button onClick={start} className="text-[13px] text-signal">Edit</button>
      </div>
      {t.why && <p className="mt-2 text-[14px] leading-snug">{t.why}</p>}
      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-rule rounded-xl border hair">
          {results.map(r => (
            <li key={r.key + r.op + r.value} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-[13px] leading-snug text-ink-2">{r.metric.label}<span className="block text-[11px] text-mute">Your limit: {r.op === '>=' ? 'at least' : 'at most'} {fmtMetric(r.value, r.metric.unit)}{r.metric.period ? ` · ${r.metric.period}` : ''}</span></span>
              <span className={`num shrink-0 text-right text-[14px] font-semibold ${r.status === 'breached' ? 'text-down' : r.status === 'ok' ? 'text-up' : 'text-mute'}`}>{fmtMetric(r.metric.value, r.metric.unit)}<span className="block text-[11px] font-normal">{r.status === 'breached' ? 'Breached' : r.status === 'ok' ? 'Holding' : 'No data'}</span></span>
            </li>
          ))}
        </ul>
      )}
      {(t.assumptions || t.breaks || t.changeView) && (
        <details className="mt-3">
          <summary className="text-[13px] text-mute">Assumptions and what would break it</summary>
          <dl className="mt-2 space-y-2 text-[13px] leading-snug">
            {PROMPTS.slice(1).map(([k, label]) => t[k] ? <div key={k}><dt className="text-[11px] font-semibold text-mute">{label}</dt><dd>{t[k] as string}</dd></div> : null)}
          </dl>
        </details>
      )}
      <button onClick={() => onAsk(`Using the transcripts and annual report, what evidence supports or contradicts this investment thesis? Thesis: ${t.why}. Assumptions: ${t.assumptions}. It breaks if: ${t.breaks}`)}
        className="mt-3 w-full rounded-xl border hair py-2 text-[13px] font-medium text-ink-2 hover:text-ink">Challenge my thesis with the evidence</button>
    </section>
  )
}
