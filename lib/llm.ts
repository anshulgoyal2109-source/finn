// Model router. Three tiers, picked per task rather than per app:
//   bulk   - Flash-Lite: classification, extraction from filings/transcripts (high volume, cheap)
//   reason - Flash: cross-document synthesis (promised vs delivered, bull/bear)  (few calls)
//   search - Flash + Google Search grounding: people background on management changes only
// Every call is content-addressed and cached, and metered into a ledger so each
// run can report exactly what it cost.
import { createHash } from 'crypto'
import type { LedgerEntry } from './types'

export type TierName = 'bulk' | 'reason' | 'search'

// Each tier is an ordered fallback chain: if a model is overloaded (503) or
// quota-limited we drop to the next one instead of failing the user.
const chain = (env: string | undefined, def: string[]) => (env ? env.split(',') : def).map(s => s.trim()).filter(Boolean)
export const CHAINS: Record<TierName, string[]> = {
  bulk: chain(process.env.FINN_MODEL_BULK, ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it']),
  reason: chain(process.env.FINN_MODEL_REASON, ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest']),
  search: chain(process.env.FINN_MODEL_SEARCH, ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-flash-lite-latest']),
}
export const MODELS: Record<TierName, string> = { bulk: CHAINS.bulk[0], reason: CHAINS.reason[0], search: CHAINS.search[0] }
// Public list prices (USD / 1M tokens) used only to report a "what this would cost on a paid tier" figure.
const PRICE: Record<TierName, [number, number]> = { bulk: [0.1, 0.4], reason: [0.3, 2.5], search: [0.3, 2.5] }

export interface Cache { get(k: string): Promise<any | undefined>; set(k: string, v: any): Promise<void> }
export const memoryCache = (): Cache => { const m = new Map<string, any>(); return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v) } } }

export class Ledger {
  entries = new Map<string, LedgerEntry & { tier: TierName }>()
  add(stage: string, tier: TierName, inTok: number, outTok: number, cached: boolean, model = MODELS[tier]) {
    const key = `${stage}|${model}`
    const e = this.entries.get(key) || { stage, model, tier, calls: 0, inTok: 0, outTok: 0, cached: 0 }
    if (cached) e.cached++; else { e.calls++; e.inTok += inTok; e.outTok += outTok }
    this.entries.set(key, e)
  }
  list(): LedgerEntry[] { return [...this.entries.values()].map(({ tier, ...e }) => e) }
  usd(): number { let s = 0; for (const e of this.entries.values()) { const [i, o] = PRICE[e.tier]; s += e.inTok / 1e6 * i + e.outTok / 1e6 * o } return s }
}

// Simple per-tier pacing so free-tier RPM limits are respected inside one process.
const RPM: Record<TierName, number> = { bulk: Number(process.env.FINN_RPM_BULK || 14), reason: Number(process.env.FINN_RPM_REASON || 9), search: 9 }
const lastCall: Record<TierName, number[]> = { bulk: [], reason: [], search: [] }
async function pace(tier: TierName) {
  for (;;) {
    const now = Date.now(); const w = lastCall[tier].filter(t => now - t < 60_000); lastCall[tier] = w
    if (w.length < RPM[tier]) { w.push(now); return }
    await new Promise(r => setTimeout(r, 60_000 - (now - w[0]) + 50))
  }
}

export interface CallOpts {
  tier: TierName; stage: string; system?: string; prompt: string
  schema?: object; json?: boolean; temperature?: number
  ledger?: Ledger; cache?: Cache; maxOutputTokens?: number; timeoutMs?: number; thinking?: 'low' | 'medium' | 'high'
}
export interface CallResult<T = any> { data: T; text: string; sources: { title: string; url: string }[]; cached: boolean; model: string }

const tripped = new Map<string, number>()
export const hasKey = () => !!process.env.GEMINI_API_KEY

export async function callLLM<T = any>(o: CallOpts): Promise<CallResult<T>> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')
  const ck = createHash('sha256').update(JSON.stringify([o.tier, o.system, o.prompt, o.schema, o.tier])).digest('hex').slice(0, 32)
  const hit = await o.cache?.get(ck)
  if (hit) { o.ledger?.add(o.stage, o.tier, 0, 0, true); return { ...hit, cached: true } }

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: o.prompt }] }],
    generationConfig: { temperature: o.temperature ?? 0.2, maxOutputTokens: o.maxOutputTokens ?? 8192 },
  }
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] }
  if (o.tier === 'search' && process.env.FINN_GROUNDING === '1') body.tools = [{ google_search: {} }]
  else if (o.schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = o.schema }
  else if (o.json) body.generationConfig.responseMimeType = 'application/json'
  // Extraction needs no deliberation: minimal thinking keeps bulk calls cheap. Reasoning tier thinks at the model default.
  if (o.tier === 'bulk') body.generationConfig.thinkingConfig = { thinkingLevel: 'minimal' }
  else body.generationConfig.thinkingConfig = { thinkingLevel: o.thinking || 'low' }

  let lastErr = ''
  // circuit breaker: skip models that failed recently in this process
  const models = CHAINS[o.tier].filter(m => (tripped.get(m) || 0) < Date.now())
  if (!models.length) models.push(...CHAINS[o.tier])
  for (let attempt = 0, mi = 0; attempt < 6 && mi < models.length; attempt++) {
    const model = models[mi]
    await pace(o.tier)
    let r: Response
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
      })
    } catch (e: any) { lastErr = `${model} ${e.name}`; tripped.set(model, Date.now() + 10 * 60_000); mi++; continue }
    if (r.status === 503 || r.status === 404) tripped.set(model, Date.now() + 10 * 60_000)
    if (r.status === 429 || r.status >= 500 || r.status === 404) {
      lastErr = `${model} ${r.status} ${(await r.text()).slice(0, 200)}`
      const retry = Number(lastErr.match(/retry in ([\d.]+)s/i)?.[1] || 0)
      // overloaded / gone / daily quota -> next model in chain; per-minute limit -> wait briefly
      if (r.status !== 429 || !retry || /per ?day|daily|PerDay/i.test(lastErr) || retry > 20) mi++
      else await new Promise(res => setTimeout(res, Math.max(retry * 1000, 3000)))
      continue
    }
    if (!r.ok) {
      const t = await r.text()
      // Some models reject thinkingConfig; drop it and retry once.
      if (r.status === 400 && body.generationConfig.thinkingConfig) { delete body.generationConfig.thinkingConfig; continue }
      if (r.status === 400 && /not supported|not found|unavailable|no longer/i.test(t)) { lastErr = t.slice(0, 200); mi++; continue }
      throw new Error(`Gemini ${r.status}: ${t.slice(0, 300)}`)
    }
    const j: any = await r.json()
    const cand = j.candidates?.[0]
    const text: string = (cand?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('')
    const u = j.usageMetadata || {}
    o.ledger?.add(o.stage, o.tier, u.promptTokenCount || 0, (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), false, j.modelVersion || model)
    const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c: any) => ({ title: c.web?.title || '', url: c.web?.uri || '' })).filter((s: any) => s.url)
    let data: any = text
    if (o.schema || o.json || o.tier === 'search') { try { data = parseJson(text) } catch { if (o.schema) { lastErr = 'bad json'; continue } } }
    if (o.schema) { const bad = conforms(data, o.schema); if (bad) { lastErr = `schema: ${bad}`; o.ledger?.add(o.stage + '.rejected', o.tier, 0, 0, false, model); continue } }
    const res = { data, text, sources, model: j.modelVersion || model }
    await o.cache?.set(ck, res)
    return { ...res, cached: false }
  }
  throw new Error(`Gemini failed after retries: ${lastErr}`)
}

/** Minimal validator for the schema subset we use. Gemini's responseSchema is a request, not a guarantee. */
export function conforms(v: any, sc: any, path = '$'): string | null {
  if (!sc) return null
  if (v == null) return sc.nullable ? null : `${path} is missing`
  switch (sc.type) {
    case 'OBJECT': {
      if (typeof v !== 'object' || Array.isArray(v)) return `${path} is not an object`
      for (const k of sc.required || []) if (!(k in v) && !sc.properties?.[k]?.nullable) return `${path}.${k} is missing`
      for (const [k, sub] of Object.entries(sc.properties || {})) if (k in v) { const e = conforms(v[k], sub, `${path}.${k}`); if (e) return e }
      return null
    }
    case 'ARRAY': { if (!Array.isArray(v)) return `${path} is not an array`; for (let i = 0; i < v.length; i++) { const e = conforms(v[i], sc.items, `${path}[${i}]`); if (e) return e } return null }
    case 'STRING': return typeof v !== 'string' ? `${path} is not a string` : sc.enum && !sc.enum.includes(v) ? `${path} '${v}' not in enum` : null
    case 'NUMBER': case 'INTEGER': return typeof v === 'number' && isFinite(v) ? null : `${path} is not a number`
    case 'BOOLEAN': return typeof v === 'boolean' ? null : `${path} is not a boolean`
  }
  return null
}

export function parseJson(t: string): any {
  const s = t.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(s) } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}'), c = s.indexOf('['), d = s.lastIndexOf(']')
    if (c >= 0 && (a < 0 || c < a)) return JSON.parse(s.slice(c, d + 1))
    return JSON.parse(s.slice(a, b + 1))
  }
}

// Tiny schema helpers (Gemini OpenAPI subset)
export const S = {
  str: (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'NUMBER', nullable: true, ...(description ? { description } : {}) }),
  int: (description?: string) => ({ type: 'INTEGER', ...(description ? { description } : {}) }),
  bool: () => ({ type: 'BOOLEAN' }),
  enum: (values: string[]) => ({ type: 'STRING', enum: values }),
  arr: (items: object) => ({ type: 'ARRAY', items }),
  obj: (properties: Record<string, object>, required?: string[]) => ({ type: 'OBJECT', properties, required: required || Object.keys(properties) }),
}
