import { Watch } from '@/components/Watch'
import { loadHoldings, loadPrices, loadFilings } from '@/lib/data'
export const dynamic = 'force-dynamic'
export default function Page() {
  const h = loadHoldings(); const p = loadPrices()
  const slim = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.slice(-60)]))
  const cutoff = Date.now() - 60 * 864e5
  const filings = loadFilings().filter(f => +new Date(f.ts) > cutoff && f.tier !== 'routine').map(f => ({ id: f.id, ticker: f.ticker, ts: f.ts, headline: f.enrichment?.kind === 'oneliner' ? f.enrichment.data.text.split(' — ')[0] : f.headline.replace(/^.*?(announcement under regulation 30 \(lodr\)-)/i, ''), tier: f.tier, category: f.category, url: f.url }))
  return <Watch holdings={h.holdings} prices={slim} filings={filings} pushTopic={process.env.NTFY_TOPIC_PUBLIC} />
}
