// Push-side enrichment: turns a filing into something an investor can act on in
// five seconds. Only "act"-tier filings get model time; "glance" items ride on
// the exchange's own one-line description for free.
import type { Category, MetricRow, PeopleChange, ResultsCut, CompanyFundamentals, Person } from './types'
import { callLLM, S, type Cache, type Ledger } from './llm'
import { readPdf, pickPages, withPageMarkers } from './pdf'

interface Ctx { ledger?: Ledger; cache?: Cache }

// ---------------- Results: first cut ----------------
const RESULT_KW: [RegExp, number][] = [
  [/revenue from operations/i, 4], [/total income/i, 2], [/profit before (exceptional items and )?tax/i, 4],
  [/finance costs?/i, 2], [/depreciation/i, 2], [/net profit|profit for the (period|quarter)/i, 3],
  [/quarter ended|three months ended/i, 2], [/consolidated/i, 2], [/interest earned|interest expended/i, 3],
  [/financial results for the quarter/i, 3], [/operating profit before provisions|provisions.*contingencies/i, 3],
  [/auditor|independent auditor|review report/i, -3],
]

const COL = S.obj({
  revenue: S.num('Revenue from operations (for banks: total interest earned)'),
  other_income: S.num('Other income'),
  finance_costs: S.num('Finance costs (banks: interest expended)'),
  depreciation: S.num('Depreciation and amortisation'),
  pbt: S.num('Profit before exceptional items and tax if shown, else profit before tax'),
  pat: S.num('Net profit for the period (total, before minority/non-controlling interest split)'),
})
const RESULT_SCHEMA = S.obj({
  found: S.bool(),
  basis: S.enum(['consolidated', 'standalone']),
  unit: S.str('Unit as printed, e.g. "₹ crore", "₹ lakh", "₹ million"'),
  current_period: S.str('Label of the latest quarter column, e.g. "Sep 2026"'),
  is_lender: S.bool(),
  current: COL, previous_quarter: COL, year_ago_quarter: COL,
  pages_used: S.arr(S.int()),
}, ['found', 'basis', 'unit', 'current_period', 'is_lender', 'current', 'previous_quarter', 'year_ago_quarter', 'pages_used'])

const toCr = (v: number | null | undefined, unit: string) => {
  if (v == null) return null
  const u = unit.toLowerCase()
  if (u.includes('lakh')) return v / 100
  if (u.includes('million') || /\bmn\b/.test(u)) return v / 10
  if (u.includes('billion') || /\bbn\b/.test(u)) return v * 100
  if (u.includes('thousand')) return v / 1e4
  return v
}
const ebitda = (c: any) => c?.pbt == null ? null : c.pbt + (c.finance_costs || 0) + (c.depreciation || 0) - (c.other_income || 0)
const pct = (a: number | null, b: number | null) => a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100

/** Revenue / EBITDA / PBT / PAT — current vs previous quarter vs year-ago — read from the filing itself. */
export async function resultsFirstCut(filingUrl: string, f: CompanyFundamentals | null, ctx: Ctx): Promise<ResultsCut | null> {
  let pages: string[] = []
  try { pages = await readPdf(filingUrl) } catch { /* fall through to screener */ }
  const textPages = pages.filter(p => p.length > 200).length
  if (pages.length && textPages) {
    // prefer consolidated pages; take the 2 best
    const idx = pickPages(pages, RESULT_KW, 2, 5)
    if (idx.length) {
      const r = await callLLM({
        tier: 'bulk', stage: 'results.extract', cache: ctx.cache, ledger: ctx.ledger, schema: RESULT_SCHEMA,
        system: 'You extract numbers from Indian listed-company quarterly results filings. Copy numbers exactly as printed (strip commas; brackets mean negative). Never compute or estimate. If the consolidated statement is present use it, else standalone. Columns: latest quarter, immediately preceding quarter, same quarter last year.',
        prompt: withPageMarkers(pages, idx, 9000),
      })
      const d = r.data
      if (d?.found && d.current?.revenue != null) {
        const u = d.unit || '₹ crore'
        const conv = (c: any) => Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [k, toCr(v as number, u)]))
        const c = conv(d.current), p = conv(d.previous_quarter), y = conv(d.year_ago_quarter)
        const lender = !!d.is_lender || !!f?.lender
        const row = (k: string, fn?: (x: any) => number | null): MetricRow => {
          const g = fn || ((x: any) => x[k] ?? null)
          return { cur: g(c), prev: g(p), yoy: g(y) }
        }
        const cut: ResultsCut = {
          period: normPeriod(d.current_period), basis: d.basis, unit: '₹ cr', lender,
          revenue: row('revenue'),
          // Lenders don't report EBITDA; Net Interest Income (interest earned − expended) is the analogous core-earnings line.
          ebitda: lender ? row('', x => x.revenue == null || x.finance_costs == null ? null : x.revenue - x.finance_costs) : row('', ebitda),
          pbt: row('pbt'), pat: row('pat'),
          source: 'filing', verified: 'unchecked', pages: idx.map(i => i + 1),
        }
        verify(cut, f)
        if (cut.verified === 'mismatch' && f) {
          // Don't show numbers we can't stand behind: fall back to the standardised table and say why.
          const sc = fromScreener(f)
          if (sc) return { ...sc, pages: cut.pages, note: 'Filing text (likely scanned) failed the cross-check — showing standardised figures for the same quarter' }
        }
        return cut
      }
    }
  }
  return f ? fromScreener(f) : null
}

/** Cross-check filing extraction against screener's independently standardised table. */
function verify(cut: ResultsCut, f: CompanyFundamentals | null) {
  if (!f) return
  const q = f.quarters; const i = q.cols.indexOf(cut.period)
  const at = (label: string[]) => { for (const l of label) if (q.rows[l]) return q.rows[l][i] ?? null; return null }
  if (i < 0) { cut.note = 'Period not yet in standardised table'; return }
  const rev = at(['Sales', 'Revenue']), pat = at(['Net Profit'])
  const close = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.02)
  if (rev == null && pat == null) return
  const ok = (rev == null || close(cut.revenue.cur, rev)) && (pat == null || close(cut.pat.cur, pat))
  if (ok) cut.verified = 'match'
  else if (f.basis !== cut.basis) { cut.verified = 'unchecked'; cut.note = `Filing read on ${cut.basis} basis; standardised table is ${f.basis}` }
  else { cut.verified = 'mismatch'; cut.note = `Standardised table shows revenue ${rev?.toLocaleString('en-IN')} / PAT ${pat?.toLocaleString('en-IN')}` }
}

export function fromScreener(f: CompanyFundamentals): ResultsCut | null {
  const q = f.quarters; const n = q.cols.length
  if (n < 5) return null
  const g = (labels: string[], k: number) => { for (const l of labels) if (q.rows[l]) return q.rows[l][k] ?? null; return null }
  const row = (labels: string[]): MetricRow => ({ cur: g(labels, n - 1), prev: g(labels, n - 2), yoy: g(labels, n - 5) })
  const rev = row(['Sales', 'Revenue'])
  const ebitdaRow: MetricRow = f.lender
    ? { cur: sub(rev.cur, g(['Interest'], n - 1)), prev: sub(rev.prev, g(['Interest'], n - 2)), yoy: sub(rev.yoy, g(['Interest'], n - 5)) }
    : row(['Operating Profit'])
  return { period: q.cols[n - 1], basis: f.basis, unit: '₹ cr', lender: f.lender, revenue: rev, ebitda: ebitdaRow, pbt: row(['Profit before tax']), pat: row(['Net Profit']), source: 'screener', verified: 'unchecked' }
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "September 30, 2026" | "30.09.2026" | "Q2 FY27" -> "Sep 2026" (screener's column label) */
export function normPeriod(s: string): string {
  if (!s) return s
  const yr = (y: string) => (y.length === 2 ? '20' + y : y)
  const cap = (m: string) => m[0].toUpperCase() + m.slice(1, 3).toLowerCase()
  const m1 = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?['’,\s-]*(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?(\d{4}|\d{2})\b/i)
  if (m1) return `${cap(m1[1])} ${yr(m1[2])}`
  const m2 = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/)
  if (m2) return `${MON[+m2[2] - 1]} ${yr(m2[3])}`
  return s
}
const sub = (a: number | null, b: number | null) => a == null || b == null ? null : a - b
export const growth = { pct }

// ---------------- Management change: who are they? ----------------
const PEOPLE_SCHEMA = S.obj({
  summary: S.str('One line: what changed, effective when. No adjectives.'),
  people: S.arr(S.obj({
    name: S.str(), role: S.str('Role at this company'), direction: S.enum(['in', 'out']),
    profile: S.str('Background exactly as stated in the filing (previous roles, years, education). Empty string if the filing has none.'),
  })),
})

export async function peopleChange(filingUrl: string, headline: string, blurb: string, company: string, ctx: Ctx, related: { url: string; text: string }[] = []): Promise<PeopleChange | null> {
  let text = `${headline}\n${blurb}`
  try {
    const pages = await readPdf(filingUrl)
    const idx = pickPages(pages, [[/appoint|resign|cessation|retire|brief profile|experience|qualification|designation/i, 2], [/profile/i, 3]], 4, 1)
    text = withPageMarkers(pages, idx.length ? idx : [0, 1].filter(i => i < pages.length), 6000)
  } catch { /* use headline only */ }
  const r = await callLLM({
    tier: 'bulk', stage: 'people.extract', cache: ctx.cache, ledger: ctx.ledger, schema: PEOPLE_SCHEMA,
    system: 'Extract management/board changes from an Indian exchange filing. Use only the filing text. SEBI requires a brief profile for appointed directors — copy its facts concisely (max 45 words per person).',
    prompt: `Company: ${company}\n\n${text}`,
  })
  const d = r.data
  if (!d?.people?.length) return null
  const people: Person[] = []
  for (const p of d.people.slice(0, 4)) {
    const person: Person = { name: p.name, role: p.role, direction: p.direction, bio: p.profile || undefined, sources: [{ title: 'Exchange filing', url: filingUrl }] }
    if (p.direction === 'in' && !person.bio) {
      // 1) another recent filing of the same company that names this person and carries a profile
      const last = p.name.split(' ').slice(-1)[0]
      const ranked = [...related].sort((a, b) => Number(b.text.includes(last)) - Number(a.text.includes(last)) || Number(/appoint|postal ballot/i.test(b.text)) - Number(/appoint|postal ballot/i.test(a.text)))
      for (const { url: u } of ranked.slice(0, 6)) {
        try {
          const pages = await readPdf(u, 8_000_000)
          const idx = pages.map((t, i) => (t.includes(last) && /profile|experience|career|qualification|joined|served as/i.test(t) ? i : -1)).filter(i => i >= 0).slice(0, 2)
          if (!idx.length) continue
          const r2 = await callLLM({ tier: 'bulk', stage: 'people.profile', cache: ctx.cache, ledger: ctx.ledger, json: true,
            system: 'From this filing text, copy the professional profile of the named person (previous roles, years, education), max 45 words. If the text has no profile of this person, return {"bio": ""}.',
            prompt: `Person: ${p.name}\n\n${withPageMarkers(pages, idx, 6000)}\n\nReturn {"bio": "..."}` })
          if (r2.data?.bio) { person.bio = r2.data.bio; person.sources!.push({ title: 'Earlier exchange filing', url: u }); break }
        } catch { /* next */ }
      }
    }
    if (p.direction === 'in') {
      const w = person.bio ? null : await wikipedia(p.name, company)
      if (w) { person.bio = person.bio ? person.bio : w.extract; person.sources!.push({ title: 'Wikipedia', url: w.url }) }
      if (!person.bio) {
        // Last resort: model knowledge (or live Google Search when grounding is enabled on a paid key).
        // Clearly labelled in the UI as unverified; the model must decline if unsure.
        const b = await callLLM({
          tier: 'search', stage: 'people.background', cache: ctx.cache, ledger: ctx.ledger, json: true,
          system: 'You give short, factual professional backgrounds of Indian business executives. If you are not confident you know this specific person, return {"known": false}. Never guess.',
          prompt: `Person: ${p.name}\nNew role: ${p.role}, ${company}\nReturn {"known": boolean, "bio": "max 40 words: previous employers/roles with years, education"}`,
        }).catch(() => null)
        if (b?.data?.known && b.data.bio) { person.bio = b.data.bio; person.bioUnverified = !b.sources.length; for (const s of b.sources.slice(0, 2)) person.sources!.push(s) }
      }
      person.sources!.push({ title: 'LinkedIn search', url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${p.name} ${company.replace(/ (Ltd|Limited)\.?$/i, '')}`)}` })
    }
    people.push(person)
  }
  return { summary: d.summary, people }
}

async function wikipedia(name: string, company: string): Promise<{ extract: string; url: string } | null> {
  try {
    const UA = { 'user-agent': 'FINN-research-prototype/0.1 (github.com/anshulgoyal2109-source/finn)' }
    const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(`${name} ${company.split(' ')[0]}`)}`, { headers: UA })
    if (!s.ok) return null
    const hit = (await s.json() as any).query?.search?.[0]
    if (!hit || !hit.title.toLowerCase().includes(name.split(' ').slice(-1)[0].toLowerCase())) return null
    const p = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`, { headers: UA })
    if (!p.ok) return null
    const j: any = await p.json()
    return j.extract ? { extract: j.extract.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.'), url: j.content_urls?.desktop?.page } : null
  } catch { return null }
}

// ---------------- Everything else material: one line that earns attention ----------------
export async function oneLiner(filingUrl: string, headline: string, blurb: string, company: string, ctx: Ctx): Promise<{ text: string; next?: string } | null> {
  let text = ''
  try { const pages = await readPdf(filingUrl, 15_000_000); text = withPageMarkers(pages, [0, 1, 2].filter(i => i < pages.length), 5000) } catch { text = '' }
  if (!text) return null
  const r = await callLLM({
    tier: 'bulk', stage: 'filing.oneliner', cache: ctx.cache, ledger: ctx.ledger,
    schema: S.obj({
      what: S.str('What happened, with the key number (size, price, stake, date). Max 22 words.'),
      so_what: S.str('Why an investor should care, stated factually from the filing. Max 18 words. Empty if nothing beyond "what".'),
      check_next: S.str('One concrete thing the investor should verify next (a number, a document, an approval, a date), max 16 words. Empty if nothing specific.'),
    }),
    system: 'You write terse investor notes from Indian exchange filings. Facts from the filing only; no hype, no speculation, no advice.',
    prompt: `Company: ${company}\nHeadline: ${headline}\n\n${text}`,
  })
  const d = r.data
  return d?.what ? { text: [d.what, d.so_what].filter(Boolean).join(' — '), next: d.check_next || undefined } : null
}

// ---------------- Low-confidence classification, batched ----------------
const CATS: Category[] = ['results', 'mna', 'fund_raise', 'management_change', 'litigation', 'insider_trading', 'earnings_call', 'investor_meetings', 'credit_rating', 'dividend', 'bonus_split', 'capex', 'press_release', 'postal_ballot', 'agm_egm', 'pledging', 'unclassified']
export async function classifyBatch(items: { id: string; headline: string; blurb: string }[], ctx: Ctx): Promise<Record<string, Category>> {
  if (!items.length) return {}
  const r = await callLLM({
    tier: 'bulk', stage: 'classify.batch', cache: ctx.cache, ledger: ctx.ledger,
    schema: S.arr(S.obj({ id: S.str(), category: S.enum(CATS) })),
    system: `Classify Indian exchange announcements. Categories: results (results, results decks), mna (acquisitions, mergers, JVs, subsidiaries, stake sales), fund_raise (QIP, rights, preferential, warrants, buyback, NCD/CP), management_change (CEO/CFO/MD/director join/leave), litigation (lawsuits, regulatory orders, penalties, insolvency), insider_trading (promoter/insider personal dealings), earnings_call, investor_meetings, credit_rating, dividend, bonus_split, capex, press_release (orders, launches, operating data, rumour clarifications), postal_ballot, agm_egm, pledging, unclassified (routine compliance).`,
    prompt: JSON.stringify(items.map(i => ({ id: i.id, headline: i.headline.slice(0, 200), description: i.blurb.slice(0, 300) }))),
  })
  const out: Record<string, Category> = {}
  for (const x of (r.data || []) as any[]) if (CATS.includes(x.category)) out[x.id] = x.category
  return out
}
