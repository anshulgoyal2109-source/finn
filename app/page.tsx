import { Brief } from '@/components/Brief'
import { loadFilings, loadPrices, loadHoldings } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default function Today() {
  const now = Date.now()
  const filings = loadFilings().filter(f => now - +new Date(f.ts) < 31 * 864e5)
  const prices = loadPrices()
  const h = loadHoldings()
  // ship only what the brief needs: ~40 sessions per holding
  const slim = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.slice(-55)]))
  return <Brief filings={filings} prices={slim} holdings={h.holdings} updatedAt={h.updatedAt} now={now} />
}
