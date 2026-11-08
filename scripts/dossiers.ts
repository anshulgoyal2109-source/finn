// Pre-compute research dossiers for the demo set (portfolio + research list) so the
// app opens them instantly. Any other ticker is researched live by /api/research.
// Content-addressed caching means a re-run only pays for new transcripts.
import { mkdirSync } from 'fs'
import { join } from 'path'
import { fetchCompany, sleep } from '../lib/screener'
import { buildDossier } from '../lib/research'
import { Ledger } from '../lib/llm'
import { fileCache, readJson, writeJson } from '../lib/filecache'

const cfg = readJson<any>('config/portfolio.json', {})
const only = process.argv.slice(2)
const list: string[] = only.length ? only : [...cfg.research, ...cfg.portfolio]
const out = join('data', 'dossiers'); mkdirSync(out, { recursive: true })
const cache = fileCache('.cache/llm')
const ledger = new Ledger()
for (const t of list) {
  try {
    const f = await fetchCompany(t)
    const d = await buildDossier(f, { cache, ledger: new Ledger() })
    for (const e of d.ledger) ledger.add(e.stage, e.model.includes('lite') ? 'bulk' : 'reason', e.inTok, e.outTok, false, e.model)
    writeJson(join(out, `${t}.json`), d)
    console.log('[dossier]', t, 'guidance', d.narrative?.guidance.length, 'verdicts', d.narrative?.scorecard.length)
  } catch (e: any) { console.log('[dossier]', t, 'FAILED', e.message) }
  await sleep(500)
}
console.log('[dossier] usd-equivalent', ledger.usd().toFixed(4))
