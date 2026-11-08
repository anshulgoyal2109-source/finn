// Server-side loaders for the pipeline's JSON output.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Filing, Holding, PriceBook, RunLog, Dossier } from './types'

const D = join(process.cwd(), 'data')
const read = <T>(p: string, def: T): T => { try { return JSON.parse(readFileSync(join(D, p), 'utf8')) } catch { return def } }

export const loadFilings = () => Object.values(read<Record<string, Filing>>('filings.json', {})).sort((a, b) => b.ts.localeCompare(a.ts))
export const loadPrices = () => read<PriceBook>('prices.json', {})
export const loadHoldings = () => read<{ updatedAt: string; holdings: Holding[]; research: string[]; alerts: any }>('holdings.json', { updatedAt: '', holdings: [], research: [], alerts: {} })
export const loadRuns = () => read<RunLog[]>('runs.json', [])
export const loadDossier = (t: string): Dossier | null => {
  const p = join(D, 'dossiers', `${t.toUpperCase().replace(/[^A-Z0-9&-]/g, '')}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
