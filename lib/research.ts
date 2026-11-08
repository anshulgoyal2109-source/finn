// Pull-side research engine. Works for any NSE ticker screener covers.
//   Facts      : deterministic, from reported financials (analytics.ts) — instant, free
//   Stage A    : bulk model reads each of the last 4 concall transcripts -> guidance + claims with verbatim quotes and page numbers
//   Stage B    : bulk model reads ~14 keyword-selected pages of the latest annual report -> business snapshot
//   Stage C    : reasoning model gets ONLY the extracted claims + the computed numbers -> promised vs delivered, narrative vs numbers, bull/bear
//   Guard      : every quote is string-matched against its source page; every verdict must cite a real claim id. Anything that fails is dropped.
// Primary sources only: no news, no broker notes, and the model is told not to use outside knowledge.
import type { CompanyFundamentals, Dossier, GuidanceItem, Narrative, Facts } from './types'
import { computeFacts, dedupeCalls } from './analytics'
import { callLLM, S, Ledger, type Cache } from './llm'
import { readPdf, pickPages, withPageMarkers } from './pdf'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\s+/g, ' ').trim()
function quoteOnPage(quote: string, page: string): boolean {
  const q = norm(quote), p = norm(page)
  if (!q) return false
  if (p.includes(q)) return true
  // tolerate light paraphrase at the edges: a 6-word window must appear verbatim
  const w = q.split(' ')
  for (let i = 0; i + 6 <= w.length; i += 3) if (p.includes(w.slice(i, i + 6).join(' '))) return true
  return false
}

/** Find the page a quote is really on (models often cite the printed page number). -1 if nowhere. */
function locate(quote: string, pages: string[], hint: number): number {
  if (pages[hint - 1] && quoteOnPage(quote, pages[hint - 1])) return hint
  for (const d of [1, -1, 2, -2]) if (pages[hint - 1 + d] && quoteOnPage(quote, pages[hint - 1 + d])) return hint + d
  const i = pages.findIndex(p => quoteOnPage(quote, p))
  return i < 0 ? -1 : i + 1
}

const TRANSCRIPT_SCHEMA = S.obj({
  quarter: S.str('Quarter discussed, e.g. "Q2 FY27"'),
  guidance: S.arr(S.obj({
    metric: S.str('revenue growth | volume growth | EBITDA margin | PAT | capex | order book | other short label'),
    statement: S.str('What management committed to or expects, in ≤20 words, keep numbers'),
    horizon: S.str('Period it applies to, e.g. "FY27", "H2 FY27", "next 2-3 years", "Q3"'),
    quote: S.str('Verbatim sentence from the transcript (≤35 words) that supports it'),
    page: S.int(),
  })),
  claims: S.arr(S.obj({
    topic: S.str(), claim: S.str('Management’s explanation/narrative in ≤22 words'),
    quote: S.str('verbatim ≤35 words'), page: S.int(),
  })),
  analyst_pushback: S.arr(S.str('Recurring analyst concern, ≤15 words')),
})

const AR_SCHEMA = S.obj({
  summary: S.str('What the company does and how it makes money, ≤45 words'),
  segments: S.arr(S.obj({ name: S.str(), share: S.str('share of revenue if stated, e.g. "62%", else ""'), note: S.str('≤14 words'), page: S.int() })),
  risks: S.arr(S.obj({ text: S.str('≤18 words: contingent liabilities, related-party, auditor remarks, concentration'), page: S.int() })),
})

const SYNTH_SCHEMA = S.obj({
  scorecard: S.arr(S.obj({
    metric: S.str(), promised: S.str('≤18 words'), delivered: S.str('≤18 words, with the actual number from NUMBERS'),
    status: S.enum(['delivered', 'missed', 'partly', 'pending', 'revised']),
    evidence: S.str('≤22 words: the arithmetic or trend from NUMBERS that decides it'), cites: S.arr(S.str('guidance ids')),
  })),
  scoreline: S.str('One sentence verdict on management credibility over these calls'),
  narrative_vs_numbers: S.arr(S.obj({ claim: S.str(), reality: S.str('what NUMBERS show'), agrees: S.bool(), cites: S.arr(S.str()) })),
  bull: S.arr(S.str('≤20 words, grounded')), bear: S.arr(S.str('≤20 words, grounded')),
  watch: S.arr(S.str('Concrete thing to check next quarter, ≤15 words')),
})

export interface ResearchOpts { ledger?: Ledger; cache?: Cache; calls?: number; withAnnualReport?: boolean; onStage?: (s: string) => void }

export async function buildDossier(f: CompanyFundamentals, o: ResearchOpts = {}): Promise<Dossier> {
  const ledger = o.ledger || new Ledger()
  const facts = computeFacts(f)
  const d: Dossier = { ticker: f.ticker, name: f.name, generatedAt: new Date().toISOString(), facts, ledger: [] }
  d.narrative = await narrative(f, facts, { ...o, ledger })
  d.ledger = ledger.list()
  return d
}

export async function narrative(f: CompanyFundamentals, facts: Facts, o: ResearchOpts & { ledger: Ledger }): Promise<Narrative> {
  const calls = dedupeCalls(f.transcripts).slice(0, o.calls ?? 4)
  o.onStage?.(`Reading ${calls.length} earnings-call transcripts`)
  const extracted = await Promise.all(calls.map(async (c, ci) => {
    try {
      const pages = await readPdf(c.url, 20_000_000)
      // Opening remarks + Q&A where numbers are discussed; skip boilerplate pages.
      const idx = pickPages(pages, [[/guid|expect|target|outlook|aspir|we should|we will|going forward|next year|fy ?2\d|margin|growth|capex|order book|double[- ]digit|%/i, 1]], 22, 2)
      const r = await callLLM({
        tier: 'bulk', stage: 'research.transcript', ledger: o.ledger, cache: o.cache, schema: TRANSCRIPT_SCHEMA, maxOutputTokens: 6000,
        system: 'You read Indian earnings-call transcripts. Extract only what management (not analysts) said. Guidance = explicit forward commitments or expectations on headline metrics. Quotes must be copied verbatim from the page they are on. Use only this transcript; no outside knowledge.',
        prompt: `Company: ${f.name}. Call: ${c.label}.\n\n${withPageMarkers(pages, idx, 7000)}`,
      })
      const data = r.data || {}
      const g: GuidanceItem[] = []
      for (const [k, x] of (data.guidance || []).entries()) {
        const pg = x?.quote ? locate(x.quote, pages, x.page) : -1
        if (pg < 0) continue // guard: a quote we cannot find verbatim in the transcript is dropped
        g.push({ id: `c${ci}g${k}`, call: data.quarter || c.label, metric: x.metric, statement: x.statement, horizon: x.horizon, quote: x.quote, page: pg, url: c.url })
      }
      const claims = (data.claims || []).map((x: any, k: number) => ({ id: `c${ci}n${k}`, call: data.quarter || c.label, ...x, page: x?.quote ? locate(x.quote, pages, x.page) : -1, url: c.url }))
        .filter((x: any) => x.page > 0)
      const dropped = (data.guidance || []).length - g.length
      return { call: data.quarter || c.label, date: c.date, guidance: g, claims, pushback: data.analyst_pushback || [], dropped }
    } catch (e: any) { return { call: c.label, date: c.date, guidance: [], claims: [], pushback: [], error: e.message } }
  }))

  let business: Narrative['business'] = { summary: facts.about, segments: [], cites: [] }
  let risks: { text: string; page: number }[] = []
  const ar = f.annualReports[0]
  if (ar && o.withAnnualReport !== false) {
    o.onStage?.(`Reading ${ar.label}`)
    try {
      const pages = await readPdf(ar.url, 60_000_000)
      const idx = pickPages(pages, [
        [/segment(al)? (revenue|information|results)/i, 4], [/revenue (mix|break|split|share)|share of revenue|% of (total )?revenue/i, 4],
        [/business overview|our business|business model|management discussion/i, 3], [/contingent liabilit/i, 3], [/related part/i, 1],
        [/key audit matter|qualified opinion|emphasis of matter/i, 3], [/geograph/i, 1],
      ], 14, 4)
      const r = await callLLM({
        tier: 'bulk', stage: 'research.annual_report', ledger: o.ledger, cache: o.cache, schema: AR_SCHEMA, maxOutputTokens: 3000,
        system: 'You read selected pages of an Indian annual report. Use only these pages, cite page numbers. No outside knowledge.',
        prompt: `Company: ${f.name}. ${ar.label}.\n\n${withPageMarkers(pages, idx, 6000)}`,
      })
      if (r.data?.summary) {
        business = { summary: r.data.summary, segments: (r.data.segments || []).slice(0, 6), cites: (r.data.segments || []).slice(0, 6).map((s: any) => ({ doc: ar.label, page: s.page, url: `${ar.url}#page=${s.page}` })) }
        risks = r.data.risks || []
      }
    } catch { /* keep screener 'about' */ }
  }

  // screener occasionally lists one call twice under different months — keep the first (newest) per quarter
  const seenQ = new Set<string>()
  for (const e of extracted) { if (seenQ.has(e.call)) { e.guidance = []; e.claims = []; (e as any).duplicate = true } seenQ.add(e.call) }
  const guidance = extracted.flatMap(e => e.guidance)
  const claims = extracted.flatMap(e => e.claims)
  o.onStage?.('Checking promises against reported numbers')
  const NUMBERS = {
    quarters: facts.quarterly.cols.map((c, i) => ({ q: c, revenue_cr: facts.quarterly.revenue[i], revenue_yoy_pct: facts.quarterly.revYoY[i] == null ? null : +facts.quarterly.revYoY[i]!.toFixed(1), margin_pct: facts.quarterly.margin[i], pat_cr: facts.quarterly.pat[i] })),
    annual: facts.trajectory.map(t => ({ series: t.label, unit: t.unit, by_year: Object.fromEntries(t.years.map((y, i) => [y, t.values[i]])) })),
    cash: facts.cash, balance: facts.balance, computed_flags: facts.flags.map(x => x.text),
    note: 'Indian fiscal year: FY27 = Apr 2026–Mar 2027; Q1=Jun, Q2=Sep, Q3=Dec, Q4=Mar quarter-ends. Columns are reported consolidated figures in ₹ crore.',
  }
  const r = await callLLM({
    tier: 'reason', stage: 'research.synthesis', ledger: o.ledger, cache: o.cache, schema: SYNTH_SCHEMA, maxOutputTokens: 6000, temperature: 0.1,
    system: `You are a sceptical buy-side analyst. Judge what management PROMISED (GUIDANCE, by id) against what was DELIVERED (NUMBERS). Rules:
- Use only GUIDANCE, CLAIMS and NUMBERS below. No outside knowledge, no news.
- Every scorecard row and narrative check must cite guidance/claim ids that exist.
- 'revised' = the same metric's guidance changed between calls (say from what to what). 'pending' = horizon not yet reached; say what run-rate is needed.
- Put numbers in 'delivered' and 'evidence'. Don't invent numbers that are not in NUMBERS.
- Prefer 4-7 scorecard rows on headline metrics; merge repeats of the same promise across calls.
- Bull and bear: 3 points each, each grounded in a number or a quote.
- Write for an investor: never mention the section names above (GUIDANCE, NUMBERS…) or ids inside the prose; ids go only in cites.`,
    prompt: `COMPANY: ${f.name} (${f.ticker})\n\nGUIDANCE:\n${JSON.stringify(guidance.map(({ url, ...g }) => g))}\n\nCLAIMS:\n${JSON.stringify(claims.map(({ url, ...c }: any) => c))}\n\nANALYST PUSHBACK:\n${JSON.stringify(extracted.map(e => ({ call: e.call, pushback: e.pushback })))}\n\nANNUAL REPORT RISKS:\n${JSON.stringify(risks)}\n\nNUMBERS:\n${JSON.stringify(NUMBERS)}`,
  })
  const ids = new Set([...guidance.map(g => g.id), ...claims.map((c: any) => c.id)])
  const s = scrub(r.data || {})
  const gids = new Set(guidance.map(g => g.id))
  // A verdict is only a verdict if it grades a real, quote-verified promise: commentary alone doesn't count.
  const scorecard = (s.scorecard || []).map((v: any) => ({ ...v, cites: (v.cites || []).filter((c: string) => ids.has(c)) })).filter((v: any) => v.cites.some((c: string) => gids.has(c)))
  return {
    business, guidance, scorecard, scoreline: s.scoreline || '',
    narrativeVsNumbers: (s.narrative_vs_numbers || []).map((x: any) => ({ ...x, cites: (x.cites || []).filter((c: string) => ids.has(c)) })).filter((x: any) => x.cites.length),
    bull: s.bull || [], bear: s.bear || [], watch: s.watch || [], model: r.model,
    // claims are kept so the UI can resolve claim cites too
    ...({ claims, calls: extracted.map(e => ({ call: e.call, date: e.date, n: e.guidance.length, dropped: (e as any).dropped || 0, error: (e as any).error })), risks } as any),
  }
}

/** Remove internal prompt labels (NUMBERS, GUIDANCE, CLAIMS…) and ids that models sometimes echo into prose. */
export function scrub<T>(v: T): T {
  const fix = (t: string) => t.replace(/\b(?:in|from|per|the)?\s*(NUMBERS|GUIDANCE|CLAIMS|ANALYST PUSHBACK|ANNUAL REPORT RISKS)\b/g, (m, w) => /^\s*(in|from|per)\s/i.test(m) ? '' : w === 'NUMBERS' ? ' the reported figures' : ' management’s statements').replace(/\s*\(?\b[cC]\d+[gn]\d+\b\)?/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').replace(/(^|[.!?]\s+)(management’s|the reported)/g, (_, a, b) => a + b[0].toUpperCase() + b.slice(1)).trim()
  const walk = (x: any): any => typeof x === 'string' ? fix(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, k === 'cites' || k === 'id' ? y : walk(y)])) : x
  return walk(v)
}

/** Grounded Q&A: the dossier's extracts + the full text of the two latest transcripts (primary source), cited by page. */
export async function askDossier(d: Dossier, question: string, o: { ledger?: Ledger; cache?: Cache } = {}) {
  const n: any = d.narrative || {}
  const docs = d.facts.docs.transcripts.slice(0, 2)
  const texts = await Promise.all(docs.map(async (t, i) => {
    try { const pages = await readPdf(t.url, 20_000_000); return { i, t, pages, text: pages.map((p, k) => `[[doc ${i} page ${k + 1}]]\n${p.slice(0, 6000)}`).join('\n') } } catch { return null }
  }))
  const ok = texts.filter(Boolean) as { i: number; t: { label: string; url: string }; pages: string[]; text: string }[]
  // Route to the annual report only when the question is about things it covers better than calls do.
  const AR_TOPICS = /risk|working capital|receivable|inventor|debt|borrow|leverage|segment|related part|contingent|auditor|capex|subsidiar|cash flow|cash conversion|thesis|bull|bear|governance|promoter|pledge/i
  const ar = d.facts.docs.annualReports[0]
  if (ar && AR_TOPICS.test(question)) {
    try {
      const pages = await readPdf(ar.url, 60_000_000)
      const terms = question.toLowerCase().match(/[a-z]{5,}/g) || []
      const kw: [RegExp, number][] = [
        ...terms.slice(0, 12).map(t => [new RegExp(t.slice(0, 7), 'i'), 1] as [RegExp, number]),
        [/risk|contingent liabilit|related part|key audit matter|working capital|borrowing|segment/i, 2],
      ]
      const idx = pickPages(pages, kw, 8, 3)
      if (idx.length) ok.push({ i: ok.length, t: { label: ar.label, url: ar.url }, pages, text: idx.map(k => `[[doc ${ok.length} page ${k + 1}]]\n${pages[k].slice(0, 5000)}`).join('\n') })
    } catch { /* answer from transcripts alone */ }
  }
  const r = await callLLM({
    tier: 'reason', stage: 'research.ask', ledger: o.ledger, cache: o.cache, maxOutputTokens: 1500, temperature: 0.2,
    schema: S.obj({ answer: S.str('≤110 words, direct, numbers first'), sources: S.arr(S.obj({ doc: S.int(), page: S.int() })), confidence: S.enum(['high', 'medium', 'low']) }),
    system: 'Answer an investor’s question about one company using ONLY the material provided: earnings-call transcripts and, when included, annual-report pages (cite doc and page), extracted guidance, and reported numbers. Prefer management’s own explanation from the transcripts, and say where the numbers agree or not. If the material does not answer it, say exactly what is missing. No outside knowledge, no news. Never write citations inside the answer text; put them only in sources.',
    prompt: `QUESTION: ${question}\n\nDOCUMENTS:\n${ok.map(x => `doc ${x.i} = ${x.t.label}\n${x.text}`).join('\n\n')}\n\nGUIDANCE: ${JSON.stringify((n.guidance || []).map(({ url, quote, ...g }: any) => g))}\nFACTS: ${JSON.stringify({ quarterly: d.facts.quarterly, trajectory: d.facts.trajectory, cash: d.facts.cash, balance: d.facts.balance, flags: d.facts.flags })}`,
  })
  const data = r.data || {}
  const sources = (data.sources || []).map((s: any) => ok.find(x => x.i === s.doc) ? { label: `${ok.find(x => x.i === s.doc)!.t.label}, p.${s.page}`, url: `${ok.find(x => x.i === s.doc)!.t.url}#page=${s.page}` } : null).filter(Boolean)
  const answer = scrub(String(data.answer || '')).replace(/\s*\((?:doc \d|facts|page \d)[^)]*\)/gi, '')
  return { answer, confidence: data.confidence, sources }
}
