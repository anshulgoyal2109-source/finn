import { Dossier } from '@/components/Dossier'
import { loadDossier, loadFilings, loadHoldings, loadPrices } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function Company({ params }: { params: Promise<{ ticker: string }> }) {
  const t = decodeURIComponent((await params).ticker).toUpperCase().replace(/[^A-Z0-9&-]/g, '')
  const h = loadHoldings()
  const holding = h.holdings.some(x => x.ticker === t)
  const filings = loadFilings().filter(f => f.ticker === t && f.tier !== 'routine').slice(0, 15)
  const prices = (loadPrices()[t] || []).map(p => ({ d: p.d, c: p.c }))
  return <Dossier key={t} ticker={t} initial={loadDossier(t)} filings={filings} prices={prices} holding={holding} />
}
