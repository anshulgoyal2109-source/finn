import { Search } from '@/components/Search'
import { loadHoldings, loadDossier } from '@/lib/data'
import { readdirSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

export default function Research() {
  const h = loadHoldings()
  let ready: string[] = []
  try { ready = readdirSync(join(process.cwd(), 'data/dossiers')).map(f => f.replace('.json', '')) } catch { /* none yet */ }
  // management track record per holding, straight from the stored promised-vs-delivered verdicts
  const record = Object.fromEntries(h.holdings.map(x => {
    const v = loadDossier(x.ticker)?.narrative?.scorecard || []
    const c = (s: string) => v.filter(y => y.status === s).length
    return [x.ticker, { delivered: c('delivered'), partly: c('partly'), missed: c('missed'), revised: c('revised'), pending: c('pending') }]
  }))
  return <Search holdings={h.holdings.map(x => ({ ticker: x.ticker, name: x.name, sector: x.sector }))} picks={h.research} ready={ready} record={record} />
}
