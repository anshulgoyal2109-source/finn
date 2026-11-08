import Link from 'next/link'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadRuns, loadFilings } from '@/lib/data'
import type { Dossier } from '@/lib/types'

export const dynamic = 'force-dynamic'
const PRICE: Record<string, [number, number]> = { lite: [0.1, 0.4], flash: [0.3, 2.5] }
const usd = (m: string, i: number, o: number) => { const p = m.includes('lite') ? PRICE.lite : PRICE.flash; return i / 1e6 * p[0] + o / 1e6 * p[1] }

export default function Engine() {
  const runs = loadRuns()
  const filings = loadFilings()
  const tot = runs.reduce((a, r) => ({ seen: a.seen + r.newFilings, rule: a.rule + r.ruleClassified, llm: a.llm + r.llmClassified, enr: a.enr + r.enriched, usd: a.usd + r.usdEquivalent }), { seen: 0, rule: 0, llm: 0, enr: 0, usd: 0 })
  let dossiers: Dossier[] = []
  try { dossiers = readdirSync(join(process.cwd(), 'data/dossiers')).map(f => JSON.parse(readFileSync(join(process.cwd(), 'data/dossiers', f), 'utf8'))) } catch { /* none */ }
  const dUsd = dossiers.reduce((a, d) => a + d.ledger.reduce((s, l) => s + usd(l.model, l.inTok, l.outTok), 0), 0)
  const dTok = dossiers.reduce((a, d) => a + d.ledger.reduce((s, l) => s + l.inTok + l.outTok, 0), 0)
  const tiers = { act: filings.filter(f => f.tier === 'act').length, glance: filings.filter(f => f.tier === 'glance').length, routine: filings.filter(f => f.tier === 'routine').length }
  const last = runs[0]

  return (
    <div className="pb-10">
      <Link href="/" className="text-[13px] text-mute">‹ Today</Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.02em]">How FINN decides</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">Most filings are paperwork. FINN spends model time only where it changes what you see, and never lets a model do arithmetic or speak without a source.</p>

      <Block title="1. Triage: rules first, model only for leftovers">
        <p>Exchange headlines follow SEBI’s disclosure categories, so ordered rules place most filings for free. What the rules can’t place goes to Flash-Lite in one batched call.</p>
        <Stat rows={[['Filings triaged', tot.seen], ['Placed by rules', `${tot.rule} (${tot.seen ? Math.round(tot.rule / tot.seen * 100) : 0}%)`], ['Sent to the model', tot.llm]]} />
        <p>Each filing gets a deterministic score with a stated reason (“Top-level change”, “Rating unchanged”, “Stock moved +4.1% that day”). Of {filings.length} filings on file: {tiers.act} material, {tiers.glance} worth a glance, {tiers.routine} set aside.</p>
      </Block>

      <Block title="2. Enrich only what earns it">
        <p><b>Results:</b> the 2 pages of the results PDF that hold the P&amp;L are found by keyword and read by Flash-Lite; FINN computes EBITDA and the QoQ/YoY changes itself, then cross-checks revenue and PAT against the independently standardised table. Scanned filings that fail the check fall back to the standardised figures, labelled.</p>
        <p><b>Leadership changes:</b> the profile SEBI requires in the appointment filing; if absent, an earlier filing that names the person; then Wikipedia; model knowledge only as a labelled last resort.</p>
        <p><b>Everything else material:</b> a two-part note from the filing’s first pages. “Worth a glance” items use the exchange’s own summary and cost nothing.</p>
      </Block>

      <Block title="3. Research: read cheap, reason once">
        <p>Four transcripts and ~14 keyword-selected annual-report pages are read by Flash-Lite into structured guidance with verbatim quotes. Every quote is string-matched against the PDF page it claims to come from; misses are dropped. Flash then sees only those extracts and the computed numbers, and every verdict must cite a surviving quote.</p>
        <Stat rows={[['Dossiers built', dossiers.length], ['Tokens', `${Math.round(dTok / 1000)}k`], ['Paid-tier equivalent', `$${dUsd.toFixed(3)}`]]} />
      </Block>

      <Block title="Model routing">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-rule">
            {[['Classify leftovers, read filings, read transcripts', 'Flash-Lite, minimal thinking'], ['Promised vs delivered, bull/bear, Q&A', 'Flash, low thinking'], ['Arithmetic, scoring, thresholds, cross-checks', 'Plain code']].map(([a, b]) => (
              <tr key={a}><td className="py-2 pr-3">{a}</td><td className="py-2 text-right text-ink-2">{b}</td></tr>
            ))}
          </tbody>
        </table>
        <p>Each tier has a fallback chain with a circuit breaker, so an overloaded model costs seconds, not the answer. Every call is content-addressed and cached: re-running a day re-reads nothing.</p>
      </Block>

      <Block title="Spend so far">
        <Stat rows={[['Push pipeline runs', runs.length], ['Push: paid-tier equivalent', `$${tot.usd.toFixed(4)}`], ['Research: paid-tier equivalent', `$${dUsd.toFixed(3)}`], ['Actually paid (free tier)', '$0']]} />
        {last && (
          <details className="mt-1">
            <summary className="text-[13px] text-signal">Latest run, {new Date(last.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</summary>
            <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
              {Object.entries(last.sources).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
              {last.ledger.map(l => <li key={l.stage + l.model} className="num">{l.stage} · {l.model} · {l.calls} calls ({l.cached} cached) · {l.inTok.toLocaleString()} in / {l.outTok.toLocaleString()} out</li>)}
            </ul>
          </details>
        )}
      </Block>
    </div>
  )
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-7"><h2 className="text-[17px] font-bold">{title}</h2><div className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-2">{children}</div></section>
)
const Stat = ({ rows }: { rows: [string, string | number][] }) => (
  <dl className="sheet grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-rule" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}>
    {rows.map(([k, v]) => <div key={k} className="bg-sheet p-3"><dd className="num text-[18px] font-semibold text-ink">{v}</dd><dt className="text-[11px] leading-tight text-mute">{k}</dt></div>)}
  </dl>
)
