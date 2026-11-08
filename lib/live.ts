// Live research for tickers without a pre-computed dossier. Per-instance memory
// caches avoid paying twice when the same function instance serves a repeat.
import { fetchCompany, fetchPrices } from './screener'
import { computeFacts } from './analytics'
import { narrative } from './research'
import { Ledger, memoryCache } from './llm'
import type { CompanyFundamentals, Dossier } from './types'

const g = globalThis as any
g.__finn ??= { companies: new Map<string, { at: number; f: CompanyFundamentals }>(), dossiers: new Map<string, Dossier>(), llm: memoryCache() }
const S = g.__finn as { companies: Map<string, { at: number; f: CompanyFundamentals }>; dossiers: Map<string, Dossier>; llm: ReturnType<typeof memoryCache> }

export async function company(t: string) {
  const hit = S.companies.get(t)
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.f
  const f = await fetchCompany(t); S.companies.set(t, { at: Date.now(), f }); return f
}
export async function factsDossier(t: string): Promise<Dossier & { prices: { d: string; c: number }[] }> {
  const f = await company(t)
  const p = await fetchPrices(f.screenerId, 380).catch(() => [])
  return { ticker: f.ticker, name: f.name, generatedAt: new Date().toISOString(), facts: computeFacts(f), ledger: [], prices: p.map(x => ({ d: x.d, c: x.c })) }
}
export async function liveNarrative(t: string): Promise<Dossier> {
  const hit = S.dossiers.get(t); if (hit) return hit
  const f = await company(t)
  const facts = computeFacts(f)
  const ledger = new Ledger()
  const n = await narrative(f, facts, { ledger, cache: S.llm })
  const d: Dossier = { ticker: f.ticker, name: f.name, generatedAt: new Date().toISOString(), facts, narrative: n, ledger: ledger.list() }
  S.dossiers.set(t, d); return d
}
