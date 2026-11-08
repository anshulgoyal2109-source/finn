import { Search } from '@/components/Search'
import { loadHoldings } from '@/lib/data'
import { readdirSync } from 'fs'
import { join } from 'path'

export default function Research() {
  const h = loadHoldings()
  let ready: string[] = []
  try { ready = readdirSync(join(process.cwd(), 'data/dossiers')).map(f => f.replace('.json', '')) } catch { /* none yet */ }
  return <Search holdings={h.holdings.map(x => ({ ticker: x.ticker, name: x.name, sector: x.sector }))} picks={h.research} ready={ready} />
}
