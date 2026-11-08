// FINN push pipeline — run by GitHub Actions (hourly on market days + after close).
//   1. EOD price/volume (+ delivery %) for every holding
//   2. New filings: screener feed (+ BSE full feed when it answers) + latest results filing backfill
//   3. Triage: rules first, one batched Flash-Lite call for the leftovers, deterministic scoring
//   4. Enrich only what earns it: results first cut, people background, one-liners (budgeted)
//   5. Write JSON for the app, a cost ledger, and (optionally) phone push via ntfy
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Filing, Holding, PriceBook, RunLog } from '../lib/types'
import { fetchCompanyHtml, parseCompany, parseSector, parseAnnouncements, fetchPrices, resolveQuarterSource, sleep, type RawAnnouncement } from '../lib/screener'
import { bseAnnouncements } from '../lib/bse'
import { ruleClassify, score, CATEGORY_LABEL } from '../lib/classify'
import { resultsFirstCut, peopleChange, oneLiner, classifyBatch } from '../lib/enrich'
import { Ledger, hasKey } from '../lib/llm'
import { fileCache, readJson, writeJson } from '../lib/filecache'
import type { CompanyFundamentals } from '../lib/types'

const ROOT = process.cwd()
const DATA = join(ROOT, 'data')
mkdirSync(DATA, { recursive: true })
const cfg = readJson<any>(join(ROOT, 'config/portfolio.json'), {})
const ledger = new Ledger()
const cache = fileCache(join(ROOT, '.cache/llm'))
const ctx = { ledger, cache }
const log = (...a: unknown[]) => console.log('[finn]', ...a)

const sizeOf = (mcap: number | null): Holding['size'] => !mcap ? 'Small' : mcap >= 100000 ? 'Large' : mcap >= 25000 ? 'Mid' : 'Small'

async function main() {
  const tickers: string[] = cfg.portfolio
  const store = readJson<Record<string, Filing>>(join(DATA, 'filings.json'), {})
  const prices: PriceBook = readJson(join(DATA, 'prices.json'), {})
  const holdings: Holding[] = []
  const fundamentals: Record<string, CompanyFundamentals> = {}
  const raw: (RawAnnouncement & { ticker: string; source: 'bse' | 'screener' })[] = []
  const sources: Record<string, string> = {}
  let bseOk = 0, bseFail = 0

  for (const t of tickers) {
    try {
      const { html, basis } = await fetchCompanyHtml(t)
      const f = parseCompany(t, html, basis); fundamentals[t] = f
      holdings.push({ ticker: t, name: f.name.replace(/ Ltd\.?$/, ''), sector: parseSector(html), size: sizeOf(f.marketCapCr), screenerId: f.screenerId, warehouseId: f.warehouseId, bseCode: f.bseCode })
      const i = html.indexOf('company-announcements-tab')
      for (const a of parseAnnouncements(html.slice(i, i + 30000))) raw.push({ ...a, ticker: t, source: 'screener' })
      if (f.bseCode) {
        const b = await bseAnnouncements(f.bseCode, new Date(Date.now() - Number(process.env.FINN_BACKFILL_DAYS || 7) * 864e5), new Date())
        if (b) { bseOk++; for (const a of b) raw.push({ ...a, ticker: t, source: 'bse' }) } else bseFail++
      }
      // Backfill the latest results filing straight from the standardised table's source link
      const qs = f.quarterSources.at(-1)
      if (qs) {
        const pdf = await resolveQuarterSource(qs.url).catch(() => null)
        const id = pdf?.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1]
        if (pdf && id && !store[id] && !raw.some(r => r.id === id)) {
          const h = await fetch(pdf, { method: 'HEAD', headers: { 'user-agent': 'FINN-research-prototype/0.1' } }).catch(() => null)
          const lm = h?.headers.get('last-modified')
          if (lm) raw.push({ id, ts: new Date(lm).toISOString(), headline: `Financial Results for the quarter ended ${qs.label}`, blurb: `${basis === 'consolidated' ? 'Consolidated' : 'Standalone'} results for ${qs.label} filed with the exchange.`, url: pdf, ticker: t, source: 'screener' })
        }
      }
      const p = await fetchPrices(f.screenerId, 400)
      if (p.length) prices[t] = p.map(x => ({ d: x.d, c: x.c, v: x.v, del: x.del }))
      log(t, 'ok', f.basis)
    } catch (e: any) { log(t, 'FAILED', e.message) }
    await sleep(700) // be polite to screener
  }
  sources.filings = bseOk ? `screener + bse (${bseOk}/${bseOk + bseFail} scrips)` : 'screener (BSE API unavailable)'
  sources.prices = 'screener EOD (NSE close, volume, delivery %)'

  // ---- triage new filings ----
  const fresh = raw.filter((a, i) => !store[a.id] && raw.findIndex(b => b.id === a.id) === i)
  log('new filings', fresh.length, 'of', raw.length)
  const dayMove = (t: string, ts: string) => {
    const s = prices[t]; if (!s) return null
    const d = ts.slice(0, 10); let k = s.findIndex(p => p.d >= d); if (k <= 0) return null
    return ((s[k].c - s[k - 1].c) / s[k - 1].c) * 100
  }
  let ruleN = 0, llmN = 0
  const low: { id: string; headline: string; blurb: string }[] = []
  for (const a of fresh) {
    const c = ruleClassify(a.headline, a.blurb)
    if (c.confidence < 0.6) low.push({ id: a.id, headline: a.headline, blurb: a.blurb })
    store[a.id] = { id: a.id, ticker: a.ticker, ts: a.ts, headline: a.headline, blurb: a.blurb, url: a.url, source: a.source, category: c.category, classifiedBy: 'rule', score: 0, tier: 'routine' }
    if (c.confidence >= 0.6) ruleN++
  }
  if (low.length && hasKey()) {
    try {
      const m = await classifyBatch(low, ctx)
      for (const [id, cat] of Object.entries(m)) { store[id].category = cat; store[id].classifiedBy = 'llm'; llmN++ }
      ruleN += low.length - Object.keys(m).length
    } catch (e: any) { log('classify batch failed', e.message); ruleN += low.length }
  } else ruleN += low.length
  for (const a of fresh) {
    const f = store[a.id]
    const s = score(f.category, f.headline, f.blurb, dayMove(f.ticker, f.ts))
    Object.assign(f, s)
  }
  // One results card per company per quarter: companions (deck, letter) step down a tier.
  const byT = new Map<string, Filing[]>()
  for (const f of Object.values(store)) if (f.category === 'results' && f.tier === 'act') byT.set(f.ticker, [...(byT.get(f.ticker) || []), f])
  for (const list of byT.values()) {
    list.sort((a, b) => Number(/financial results|results for the/i.test(b.headline)) - Number(/financial results|results for the/i.test(a.headline)) || a.ts.localeCompare(b.ts))
    const primary = list[0]
    for (const f of list.slice(1)) if (Math.abs(+new Date(f.ts) - +new Date(primary.ts)) < 4 * 864e5) { f.tier = 'glance'; f.score = Math.min(f.score, 55); f.why = 'Companion to the results filing' }
  }

  // Same event filed twice (e.g. "Meeting Updates" + "Allotment" for one QIP): keep one card.
  const acts = Object.values(store).filter(f => f.tier === 'act').sort((a, b) => b.score - a.score || a.ts.localeCompare(b.ts))
  for (let i = 0; i < acts.length; i++) for (let j = i + 1; j < acts.length; j++) {
    const a = acts[i], b = acts[j]
    if (b.tier !== 'act' || a.tier !== 'act' || a.ticker !== b.ticker || a.category !== b.category || a.category === 'results') continue
    if (Math.abs(+new Date(a.ts) - +new Date(b.ts)) > 1.5 * 864e5) continue
    b.tier = 'glance'; b.score = Math.min(b.score, 55); b.why = 'Another filing on the same event'
  }

  // ---- enrich (budgeted, newest material first) ----
  let enriched = 0
  const budget = Number(cfg.enrichBudgetPerRun || 30)
  const queue = Object.values(store).filter(f => f.tier === 'act' && !f.enrichment && Date.now() - +new Date(f.ts) < 75 * 864e5).sort((a, b) => b.ts.localeCompare(a.ts))
  if (hasKey()) for (const f of queue.slice(0, budget)) {
    const name = holdings.find(h => h.ticker === f.ticker)?.name || f.ticker
    try {
      if (f.category === 'results') {
        const cut = await resultsFirstCut(f.url, fundamentals[f.ticker] || null, ctx)
        if (cut) f.enrichment = { kind: 'results', data: cut }
      } else if (f.category === 'management_change') {
        // other filings from the same company (e.g. the appointment notice) often carry the profile
        const related = Object.values(store).filter(x => x.ticker === f.ticker && x.id !== f.id && Math.abs(+new Date(x.ts) - +new Date(f.ts)) < 90 * 864e5).map(x => ({ url: x.url, text: `${x.headline} ${x.blurb}` }))
        const p = await peopleChange(f.url, f.headline, f.blurb, name, ctx, related)
        if (p) f.enrichment = { kind: 'people', data: p }
      } else {
        const t = await oneLiner(f.url, f.headline, f.blurb, name, ctx)
        if (t) f.enrichment = { kind: 'oneliner', data: { text: t.text, next: t.next, model: 'bulk' } }
      }
      if (f.enrichment) enriched++
      log('enriched', f.ticker, f.category, f.enrichment?.kind || '-')
    } catch (e: any) { log('enrich failed', f.ticker, f.id, e.message) }
  } else for (const f of queue) if (f.category === 'results' && fundamentals[f.ticker]) {
    // No key: still give a first cut from the standardised table.
    const { fromScreener } = await import('../lib/enrich')
    const cut = fromScreener(fundamentals[f.ticker]); if (cut) { f.enrichment = { kind: 'results', data: cut }; enriched++ }
  }

  // ---- write ----
  const cutoff = Date.now() - 120 * 864e5
  for (const [k, f] of Object.entries(store)) if (+new Date(f.ts) < cutoff) delete store[k]
  for (const t of Object.keys(prices)) prices[t] = prices[t].slice(-260)
  writeJson(join(DATA, 'filings.json'), store)
  writeJson(join(DATA, 'prices.json'), prices)
  writeJson(join(DATA, 'holdings.json'), { updatedAt: new Date().toISOString(), holdings, research: cfg.research, alerts: cfg.alerts }, true)
  const run: RunLog = { at: new Date().toISOString(), filingsSeen: raw.length, newFilings: fresh.length, ruleClassified: ruleN, llmClassified: llmN, enriched, ledger: ledger.list(), sources, usdEquivalent: +ledger.usd().toFixed(5) }
  const runs = readJson<RunLog[]>(join(DATA, 'runs.json'), [])
  writeJson(join(DATA, 'runs.json'), [run, ...runs].slice(0, 60), true)
  log('done', JSON.stringify({ ...run, ledger: undefined }))

  await notify(fresh.map(a => store[a.id]).filter(f => f.tier === 'act' && (cfg.alerts?.categories || []).includes(f.category)), prices, holdings)
}

// Phone push without accounts or servers: ntfy.sh topic (install the ntfy app, subscribe to the topic).
async function notify(items: Filing[], prices: PriceBook, holdings: Holding[]) {
  const topic = process.env.NTFY_TOPIC; if (!topic) return
  const app = process.env.FINN_APP_URL || ''
  const msgs: { title: string; body: string; tags: string; click: string }[] = items.slice(0, 8).map(f => ({
    title: `${f.ticker} · ${CATEGORY_LABEL[f.category]}`,
    body: f.enrichment?.kind === 'oneliner' ? f.enrichment.data.text : f.blurb || f.headline,
    tags: f.category === 'results' ? 'bar_chart' : f.category === 'management_change' ? 'bust_in_silhouette' : 'bell', click: `${app}/?f=${f.id}`,
  }))
  // EOD threshold alerts (defaults from config; the app lets each user tune their own view)
  const { volumeMultiple = 2, priceMovePct = 4 } = cfg.alerts || {}
  const today = new Date().toISOString().slice(0, 10)
  for (const h of holdings) {
    const s = prices[h.ticker]; if (!s || s.length < 22) continue
    const last = s.at(-1)!, prev = s.at(-2)!; if (last.d !== today) continue
    const avg = s.slice(-21, -1).reduce((a, p) => a + p.v, 0) / 20
    const mv = (last.c - prev.c) / prev.c * 100
    if (last.v > volumeMultiple * avg || Math.abs(mv) >= priceMovePct)
      msgs.push({ title: `${h.ticker} unusual move`, body: `${mv >= 0 ? '+' : ''}${mv.toFixed(1)}% · volume ${(last.v / avg).toFixed(1)}× 20-day avg`, tags: mv >= 0 ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend', click: `${app}/c/${h.ticker}` })
  }
  for (const m of msgs) await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: m.body, headers: { Title: m.title, Tags: m.tags, Click: m.click } }).catch(() => {})
  log('pushed', msgs.length)
}

main().catch(e => { console.error(e); process.exit(1) })
