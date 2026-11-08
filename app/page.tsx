import { Brief } from '@/components/Brief'
import { loadFilings, loadPrices, loadHoldings, loadDossier } from '@/lib/data'
import { metricsFromFacts } from '@/lib/thesis'

export const dynamic = 'force-dynamic'

export default function Today() {
  const now = Date.now()
  const filings = loadFilings().filter(f => now - +new Date(f.ts) < 31 * 864e5)
  const prices = loadPrices()
  const h = loadHoldings()
  // ship only what the brief needs: ~40 sessions per holding
  const slim = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.slice(-60)]))
  // reported metrics per holding, for checking the investor's own thesis conditions on-device
  const metrics = Object.fromEntries(h.holdings.map(x => { const d = loadDossier(x.ticker); return [x.ticker, d ? metricsFromFacts(d.facts) : {}] }))
  return <Brief filings={filings} prices={slim} holdings={h.holdings} updatedAt={h.updatedAt} now={now} metrics={metrics} />
}
