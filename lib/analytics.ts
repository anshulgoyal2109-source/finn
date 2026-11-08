// Deterministic fundamentals. The model never does arithmetic: every number in a
// dossier is computed here from the company's reported financials, and the LLM
// only gets to *interpret* them.
import type { CompanyFundamentals, Facts, Table } from './types'

const row = (t: Table, ...names: string[]) => { for (const n of names) if (t.rows[n]) return t.rows[n]; return t.cols.map(() => null) }
const last = <T>(a: T[], k = 1) => a[a.length - k]
const fmtCr = (v: number | null) => v == null ? '—' : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L cr` : `₹${Math.round(v).toLocaleString('en-IN')} cr`
const pctS = (v: number | null, d = 0) => v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`
const cagr = (a: number | null, b: number | null, yrs: number) => a == null || b == null || a <= 0 || b <= 0 ? null : (Math.pow(b / a, 1 / yrs) - 1) * 100
const sub = (a: number | null, b: number | null) => a == null || b == null ? null : a - b
const sum = (a: (number | null)[]) => a.reduce<number>((s, x) => s + (x || 0), 0)

export function computeFacts(f: CompanyFundamentals): Facts {
  // annual columns: drop TTM for multi-year series but keep it for "current"
  const A = f.annual; const yrsAll = A.cols
  const ttmIdx = yrsAll.indexOf('TTM')
  const yrs = yrsAll.filter(c => c !== 'TTM')
  const take = (r: (number | null)[]) => ttmIdx >= 0 ? r.filter((_, i) => i !== ttmIdx) : r
  const sales = take(row(A, 'Sales', 'Revenue'))
  const op = take(row(A, 'Operating Profit', 'Financing Profit'))
  const opm = take(row(A, 'OPM %', 'Financing Margin %'))
  const np = take(row(A, 'Net Profit'))
  const n = yrs.length

  const Q = f.quarters; const qn = Q.cols.length
  const qs = row(Q, 'Sales', 'Revenue'), qnp = row(Q, 'Net Profit'), qm = row(Q, 'OPM %', 'Financing Margin %')
  const qYoY = qs.map((v, i) => i >= 4 && v != null && qs[i - 4] ? ((v - qs[i - 4]!) / Math.abs(qs[i - 4]!)) * 100 : null)
  const ttmSales = sum(qs.slice(-4)), ttmPat = sum(qnp.slice(-4))

  const B = f.balance
  const eq = row(B, 'Equity Capital').map((v, i) => (v ?? 0) + (row(B, 'Reserves')[i] ?? 0))
  const debt = row(B, 'Borrowings', 'Borrowing')
  const de = last(debt) != null && last(eq) ? last(debt)! / last(eq) : null
  const C = f.cashflow
  const cfoAll = row(C, 'Cash from Operating Activity')
  const fcfAll = row(C, 'Free Cash Flow')
  const cyrs = C.cols
  const k = Math.min(6, cyrs.length)
  const patForCf = cyrs.map(c => { const i = yrs.indexOf(c); return i >= 0 ? np[i] : null })
  const conv5 = sum(patForCf.slice(-5)) ? sum(cfoAll.slice(-5)) / sum(patForCf.slice(-5)) : null

  const R = f.ratios
  const ccc = row(R, 'Cash Conversion Cycle'), debtor = row(R, 'Debtor Days'), roce = row(R, 'ROCE %', 'ROE %')
  const promoters = row(f.shareholding, 'Promoters')
  const pe = f.price && ttmPat > 0 && f.marketCapCr ? f.marketCapCr / ttmPat : null

  const flags: Facts['flags'] = []
  const g3 = cagr(sales[n - 4], sales[n - 1], 3), g5 = cagr(sales[n - 6], sales[n - 1], 5)
  const p3 = cagr(np[n - 4], np[n - 1], 3)
  if (g3 != null && p3 != null && p3 < g3 - 8) flags.push({ text: `Profit compounding (${pctS(p3)}/yr) lags sales (${pctS(g3)}/yr) over 3 years — margins under pressure`, tone: 'bad' })
  if (g3 != null && p3 != null && p3 > g3 + 8) flags.push({ text: `Operating leverage: profit ${pctS(p3)}/yr vs sales ${pctS(g3)}/yr over 3 years`, tone: 'good' })
  if (!f.lender && opm.length > 4 && last(opm) != null && opm[n - 4] != null) {
    const d = last(opm)! - opm[n - 4]!
    if (Math.abs(d) >= 3) flags.push({ text: `Operating margin ${d > 0 ? 'expanded' : 'compressed'} ${Math.abs(d).toFixed(0)} pts in 3 years (${opm[n - 4]}% → ${last(opm)}%)`, tone: d > 0 ? 'good' : 'bad' })
  }
  if (!f.lender && conv5 != null) flags.push(conv5 < 0 ? { text: `Operating cash flow was negative over 5 years (₹${Math.round(sum(cfoAll.slice(-5))).toLocaleString('en-IN')} cr) despite ₹${Math.round(sum(patForCf.slice(-5))).toLocaleString('en-IN')} cr of profit`, tone: 'bad' } : conv5 < 0.7 ? { text: `Only ${(conv5 * 100).toFixed(0)}% of 5-year profit turned into operating cash`, tone: 'bad' } : conv5 > 1.0 ? { text: `Cash-rich profits: 5-yr operating cash = ${(conv5 * 100).toFixed(0)}% of PAT`, tone: 'good' } : { text: `5-yr cash conversion ${(conv5 * 100).toFixed(0)}% of PAT`, tone: 'neutral' })
  if (!f.lender && debtor.length >= 4 && last(debtor) != null && debtor[debtor.length - 4] != null && last(debtor)! - debtor[debtor.length - 4]! >= 15)
    flags.push({ text: `Receivable days stretched from ${debtor[debtor.length - 4]} to ${last(debtor)} in 3 years`, tone: 'bad' })
  if (!f.lender && de != null && de > 1) flags.push({ text: `Leveraged: debt ${de.toFixed(1)}× equity`, tone: 'bad' })
  if (!f.lender && de != null && de < 0.1) flags.push({ text: 'Practically debt-free', tone: 'good' })
  if (promoters.length >= 4 && last(promoters) != null && promoters[promoters.length - 5] != null) {
    const d = last(promoters)! - promoters[promoters.length - 5]!
    if (Math.abs(d) >= 1.5) flags.push({ text: `Promoter stake ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} pts in a year (now ${last(promoters)}%)`, tone: d > 0 ? 'good' : 'bad' })
  }
  const lastQ = qYoY[qn - 1]
  if (lastQ != null && g3 != null && lastQ < g3 - 10) flags.push({ text: `Latest quarter growth (${pctS(lastQ)}) well below 3-yr trend (${pctS(g3)})`, tone: 'bad' })
  if (lastQ != null && g3 != null && lastQ > g3 + 10) flags.push({ text: `Latest quarter growth (${pctS(lastQ)}) accelerating vs 3-yr trend (${pctS(g3)})`, tone: 'good' })

  const tone = (v: number | null) => v == null ? 'flat' as const : v > 0 ? 'up' as const : v < 0 ? 'down' as const : 'flat' as const
  return {
    price: f.price, marketCapCr: f.marketCapCr, lender: f.lender, basis: f.basis, about: f.about,
    headline: [
      { label: 'Revenue (TTM)', value: fmtCr(ttmSales), sub: `${pctS(lastQ)} YoY last qtr`, tone: tone(lastQ) },
      f.lender
        ? { label: 'Net interest income', value: fmtCr(sub(last(qs), last(row(Q, 'Interest')))), sub: `${Q.cols[qn - 1]} qtr · revenue − interest` }
        : { label: 'EBITDA margin', value: last(qm) == null ? '—' : `${last(qm)}%`, sub: `${Q.cols[qn - 1]} qtr` },
      { label: 'PAT (TTM)', value: fmtCr(ttmPat), sub: `${pctS(cagr(np[n - 4], np[n - 1], 3))}/yr 3-yr` , tone: tone(cagr(np[n - 4], np[n - 1], 3)) },
      { label: f.lender ? 'ROE' : 'ROCE', value: last(roce) == null ? '—' : `${last(roce)}%`, sub: yrs[n - 1] },
      { label: 'Market cap', value: fmtCr(f.marketCapCr), sub: pe ? `${pe.toFixed(0)}× TTM earnings` : '' },
      { label: 'Revenue CAGR', value: pctS(g5), sub: `5-yr · 3-yr ${pctS(g3)}` },
    ],
    trajectory: [
      { label: 'Revenue', years: yrs.slice(-10), values: sales.slice(-10), unit: '₹ cr' },
      { label: f.lender ? 'Financing margin' : 'Operating margin', years: yrs.slice(-10), values: opm.slice(-10), unit: '%' },
      { label: 'Net profit', years: yrs.slice(-10), values: np.slice(-10), unit: '₹ cr' },
    ],
    quarterly: { cols: Q.cols.slice(-9), revenue: qs.slice(-9), margin: qm.slice(-9), pat: qnp.slice(-9), revYoY: qYoY.slice(-9) },
    balance: f.lender ? [
      { label: 'Deposits', value: fmtCr(last(row(B, 'Deposits'))) },
      { label: 'Borrowings', value: fmtCr(last(debt)) },
      { label: 'Net worth', value: fmtCr(last(eq)) },
      { label: 'Gross NPA', value: last(row(Q, 'Gross NPA %')) == null ? '—' : `${last(row(Q, 'Gross NPA %'))}%`, note: Q.cols[qn - 1] },
      { label: 'Net NPA', value: last(row(Q, 'Net NPA %')) == null ? '—' : `${last(row(Q, 'Net NPA %'))}%` },
    ] : [
      { label: 'Debt / equity', value: de == null ? '—' : `${de.toFixed(2)}×`, tone: de == null ? 'neutral' : de > 1 ? 'bad' : de < 0.3 ? 'good' : 'neutral', note: `Borrowings ${fmtCr(last(debt))}` },
      { label: 'Net worth', value: fmtCr(last(eq)), note: B.cols.at(-1) },
      { label: 'Cash conversion cycle', value: last(ccc) == null ? '—' : `${last(ccc)} days`, note: ccc.length > 3 && ccc[ccc.length - 4] != null ? `${ccc[ccc.length - 4]} days 3 yrs ago` : undefined, tone: ccc.length > 3 && last(ccc) != null && ccc[ccc.length - 4] != null ? (last(ccc)! > ccc[ccc.length - 4]! + 10 ? 'bad' : last(ccc)! < ccc[ccc.length - 4]! - 10 ? 'good' : 'neutral') : 'neutral' },
      { label: 'Debtor days', value: last(debtor) == null ? '—' : `${last(debtor)}` },
      { label: 'Capital work in progress', value: fmtCr(last(row(B, 'CWIP'))), note: 'Capex still being built' },
      { label: 'Promoter holding', value: last(promoters) == null ? '—' : `${last(promoters)}%`, note: f.shareholding.cols.at(-1) },
    ],
    cash: { years: cyrs.slice(-k), cfo: cfoAll.slice(-k), pat: patForCf.slice(-k), fcf: fcfAll.slice(-k), conversion: conv5 },
    flags,
    docs: { transcripts: dedupeCalls(f.transcripts).slice(0, 8), annualReports: f.annualReports.slice(0, 3) },
  }
}

/** screener sometimes lists the same call twice (or mis-dates one) — keep one per month label, newest first */
export function dedupeCalls<T extends { date?: string; url: string }>(xs: T[]): T[] {
  const seen = new Set<string>(); const out: T[] = []
  for (const x of xs) { const k = x.date || x.url; if (seen.has(k) || seen.has(x.url)) continue; seen.add(k); seen.add(x.url); out.push(x) }
  return out
}
export { fmtCr, pctS }
