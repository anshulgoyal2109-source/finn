'use client'
import Link from 'next/link'
import type { Holding, PriceBook } from '@/lib/types'
import { lastRegular, DEFAULT_THRESHOLDS } from '@/lib/alerts'
import { CATEGORY_LABEL } from '@/lib/classify'
import { useThresholds } from '@/lib/prefs'
import { pct } from '@/lib/format'

const WATCHABLE = ['results', 'mna', 'management_change', 'fund_raise', 'litigation', 'pledging', 'credit_rating', 'insider_trading', 'capex', 'press_release', 'dividend', 'bonus_split'] as const

export function Watch({ holdings, prices, pushTopic }: { holdings: Holding[]; prices: PriceBook; pushTopic?: string }) {
  const [t, setT] = useThresholds()
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
        <p className="text-[13px] text-mute">Last session: <b className="font-semibold text-ink">{hits.length}</b> of {rows.length} holdings cross these rules.</p>
      </section>

      <section className="mt-6">
        <h2 className="px-1 text-[18px] font-bold">Last session, against your rules</h2>
        <ul className="sheet mt-2 divide-y divide-rule rounded-2xl">
          {rows.map(({ h, m }) => (
            <li key={h.ticker}><Link href={`/c/${h.ticker}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${m!.reasons.length ? 'bg-signal' : 'bg-rule'}`} aria-hidden />
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

      <section className="mt-6">
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
