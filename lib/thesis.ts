// Investment-thesis tracker. The investor writes the thesis; FINN only checks the
// numeric conditions they chose against reported figures. Pure functions — run on
// server (Today) and client (dossier) alike. No model is involved in a check.
import type { Facts } from './types'

export interface Metric { key: string; label: string; unit: '%' | '×' | 'days'; value: number | null; period: string; higherIsBetter: boolean }
export interface Check { key: string; op: '>=' | '<='; value: number }
export interface Thesis { why: string; assumptions: string; breaks: string; changeView: string; checks: Check[]; updatedAt: string }
export type CheckResult = Check & { metric: Metric; status: 'ok' | 'breached' | 'na' }

const num = (s: string | undefined) => { const m = (s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null }
const last = <T>(a: T[]) => a[a.length - 1]

export const METRIC_KEYS = ['revYoY', 'patYoY', 'margin', 'roce', 'de', 'cashConv', 'ccc', 'debtorDays', 'promoter'] as const

export function metricsFromFacts(f: Facts): Record<string, Metric> {
  const q = f.quarterly, n = q.cols.length
  const qPeriod = q.cols[n - 1] || ''
  const patYoY = n >= 5 && q.pat[n - 1] != null && q.pat[n - 5] ? ((q.pat[n - 1]! - q.pat[n - 5]!) / Math.abs(q.pat[n - 5]!)) * 100 : null
  const bal = (label: string) => f.balance.find(b => b.label === label)
  const head = (label: string) => f.headline.find(h => h.label === label)
  const ccc = bal('Cash conversion cycle'), debt = bal('Debtor days'), de = bal('Debt / equity'), pr = bal('Promoter holding')
  const roce = head('ROCE') || head('ROE')
  const M: Metric[] = [
    { key: 'revYoY', label: 'Revenue growth, latest quarter YoY', unit: '%', value: last(q.revYoY) ?? null, period: qPeriod, higherIsBetter: true },
    { key: 'patYoY', label: 'Profit growth, latest quarter YoY', unit: '%', value: patYoY, period: qPeriod, higherIsBetter: true },
    { key: 'margin', label: f.lender ? 'Financing margin, latest quarter' : 'Operating margin, latest quarter', unit: '%', value: last(q.margin) ?? null, period: qPeriod, higherIsBetter: true },
    { key: 'roce', label: f.lender ? 'Return on equity' : 'Return on capital employed', unit: '%', value: num(roce?.value), period: roce?.sub || '', higherIsBetter: true },
    { key: 'de', label: 'Debt to equity', unit: '×', value: num(de?.value), period: de?.note || '', higherIsBetter: false },
    { key: 'cashConv', label: '5-year cash conversion (operating cash ÷ profit)', unit: '%', value: f.cash.conversion == null ? null : Math.round(f.cash.conversion * 100), period: f.cash.years.at(-1) || '', higherIsBetter: true },
    { key: 'ccc', label: 'Cash conversion cycle', unit: 'days', value: num(ccc?.value), period: '', higherIsBetter: false },
    { key: 'debtorDays', label: 'Receivable days', unit: 'days', value: num(debt?.value), period: '', higherIsBetter: false },
    { key: 'promoter', label: 'Promoter holding', unit: '%', value: num(pr?.value), period: pr?.note || '', higherIsBetter: true },
  ]
  return Object.fromEntries(M.filter(m => !(f.lender && ['de', 'cashConv', 'ccc', 'debtorDays'].includes(m.key))).map(m => [m.key, m]))
}

export function runChecks(t: Thesis | null, m: Record<string, Metric>): CheckResult[] {
  if (!t) return []
  return t.checks.filter(c => m[c.key]).map(c => {
    const metric = m[c.key]
    const status = metric.value == null ? 'na' : (c.op === '>=' ? metric.value >= c.value : metric.value <= c.value) ? 'ok' : 'breached'
    return { ...c, metric, status }
  })
}

export const fmtMetric = (v: number | null, unit: Metric['unit']) => v == null ? 'not available' : unit === '%' ? `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%` : unit === '×' ? `${v.toFixed(2)}×` : `${Math.round(v)} days`

/** Starting limits are quality floors an analyst would use, not today's value — the investor edits them. */
export function suggestedCheck(m: Metric): Check {
  const v = m.value ?? 0
  switch (m.key) {
    case 'revYoY': return { key: m.key, op: '>=', value: Math.max(0, Math.floor(v * 0.6)) }
    case 'patYoY': return { key: m.key, op: '>=', value: 0 }
    case 'margin': return { key: m.key, op: '>=', value: Math.floor(v - 2) }
    case 'roce': return { key: m.key, op: '>=', value: Math.max(10, Math.floor(v - 3)) }
    case 'de': return { key: m.key, op: '<=', value: v < 1 ? 1 : Math.round(v * 1.2 * 10) / 10 }
    case 'cashConv': return { key: m.key, op: '>=', value: 70 }
    case 'ccc': case 'debtorDays': return { key: m.key, op: '<=', value: Math.ceil(v * 1.15) }
    case 'promoter': return { key: m.key, op: '>=', value: Math.floor(v - 2) }
  }
  return { key: m.key, op: m.higherIsBetter ? '>=' : '<=', value: Math.round(v) }
}
