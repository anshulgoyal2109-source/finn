// screener.in adapter. Screener republishes companies' own reported numbers and
// links straight to the primary documents on BSE / company IR sites, so it is our
// single, well-structured entry point to primary data. We read: standardised
// financial tables, the documents list (filings, transcripts, annual reports) and
// the EOD price/volume chart API.
import type { CompanyFundamentals, DocLink, Table, PricePoint } from './types'

const BASE = 'https://www.screener.in'
const UA = 'FINN-research-prototype/0.1'

async function get(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, redirect: 'follow', cache: 'no-store' })
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); last = new Error(`${r.status} ${url}`); continue }
      return r
    } catch (e) { last = e; await sleep(1000 * (i + 1)) }
  }
  throw last
}
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const decode = (s: string) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim()

export function num(s: string): number | null {
  const t = s.replace(/[,₹%\s+]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!t || t === '-' || /x/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function section(html: string, id: string): string {
  const i = html.indexOf(`id="${id}"`)
  if (i < 0) return ''
  const j = html.indexOf('<section', i + 10)
  return html.slice(i, j < 0 ? i + 200000 : j)
}

export function parseTable(sec: string): Table {
  const t = sec.match(/<table[\s\S]*?<\/table>/)
  if (!t) return { cols: [], rows: {} }
  const head = t[0].match(/<thead[\s\S]*?<\/thead>/)?.[0] || ''
  const cols = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => decode(m[1])).slice(1)
  const rows: Table['rows'] = {}
  const body = t[0].match(/<tbody[\s\S]*?<\/tbody>/)?.[0] || ''
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => decode(m[1]))
    if (!cells.length) continue
    const label = cells[0].replace(/\s*\+$/, '').trim()
    if (!label || label === 'Raw PDF') continue
    rows[label] = cells.slice(1).map(num)
  }
  return { cols, rows }
}

const abs = (u: string) => (u.startsWith('http') ? u : BASE + u).replace(/&amp;/g, '&')

/** BSE "AnnPdfOpen" links 302 to AttachLive (and later AttachHis). Resolve to a direct PDF. */
export const directPdf = (u: string) => {
  const m = u.match(/Pname=([\w-]+\.pdf)/i)
  return m ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${m[1]}` : u
}

export interface RawAnnouncement { id: string; ts: string; headline: string; blurb: string; url: string }

export function parseAnnouncements(fragment: string): RawAnnouncement[] {
  const out: RawAnnouncement[] = []
  const re = /<a href="([^"]+)"[^>]*>\s*((?:(?!<a\s)[\s\S])*?)<div class="ink-600 smaller"><time datetime="([^"]+)"[^>]*>[^<]*<\/time>\s*-?\s*([\s\S]*?)<\/div>/g
  for (const m of fragment.matchAll(re)) {
    const url = m[1].replace(/&amp;/g, '&')
    const id = url.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1] || url
    out.push({ id, ts: m[3], headline: decode(m[2]), blurb: decode(m[4]), url: directPdf(url) })
  }
  return out
}

export async function fetchCompanyHtml(ticker: string): Promise<{ html: string; basis: 'consolidated' | 'standalone' }> {
  const t = encodeURIComponent(ticker.toUpperCase())
  let r = await get(`${BASE}/company/${t}/consolidated/`)
  if (r.ok) {
    const html = await r.text()
    // Some companies have no consolidated numbers: screener shows an empty table.
    if (/data-result-table/.test(html) && /Sales|Revenue/.test(section(html, 'quarters'))) return { html, basis: 'consolidated' }
  }
  r = await get(`${BASE}/company/${t}/`)
  if (!r.ok) throw new Error(`Company ${ticker} not found on screener (${r.status})`)
  return { html: await r.text(), basis: 'standalone' }
}

export function parseCompany(ticker: string, html: string, basis: 'consolidated' | 'standalone'): CompanyFundamentals {
  const name = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || ticker)
  const screenerId = Number(html.match(/data-company-id="(\d+)"/)?.[1] || 0)
  const warehouseId = Number(html.match(/data-warehouse-id="(\d+)"/)?.[1] || 0)
  const bseCode = html.match(/bseindia\.com\/stock-share-price\/[^/]+\/[^/]+\/(\d{6})/)?.[1]
  const top = decode(section(html, 'top-ratios'))
  const marketCapCr = num(top.match(/Market Cap ₹ ([\d,.]+)/)?.[1] || '')
  const price = num(top.match(/Current Price ₹ ([\d,.]+)/)?.[1] || '')
  const about = decode(html.match(/class="sub show-more-box about"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').replace(/\[\d+\]/g, '').trim()

  const q = section(html, 'quarters')
  const quarters = parseTable(q)
  const lender = 'Financing Profit' in quarters.rows || 'Interest' in quarters.rows && !('Sales' in quarters.rows)
  const quarterSources: DocLink[] = [...q.matchAll(/href="(\/company\/source\/quarter\/[^"]+)"/g)]
    .map((m, i) => ({ label: quarters.cols.slice(-[...q.matchAll(/\/company\/source\/quarter\//g)].length)[i] || '', url: abs(m[1]) }))

  const docs = section(html, 'documents')
  const ar: DocLink[] = [...docs.matchAll(/<a href="([^"]+)"[^>]*Annual\+Report[^>]*>\s*([^<]+)<\/a>/g)]
    .map(m => ({ label: decode(m[2]), url: abs(m[1]) }))
  const transcripts: DocLink[] = []; const presentations: DocLink[] = []
  for (const li of docs.matchAll(/<li class="flex flex-gap-8[^"]*">([\s\S]*?)<\/li>/g)) {
    const date = decode(li[1].match(/<div class="ink-600[^>]*>([\s\S]*?)<\/div>/)?.[1] || '')
    const tr = li[1].match(/<a\s+class="button-chip"\s+href="([^"]+)"[^>]*title="Raw Transcript"/)
    if (tr) transcripts.push({ label: `${date} call`, url: directPdf(abs(tr[1])), date })
    const ppt = li[1].match(/<a\s+href="([^"]+)"\s+class="button-chip"[^>]*>\s*PPT\s*<\/a>/)
    if (ppt) presentations.push({ label: `${date} deck`, url: directPdf(abs(ppt[1])), date })
  }

  return {
    ticker: ticker.toUpperCase(), name, screenerId, warehouseId, bseCode, about, price, marketCapCr, basis, lender,
    quarters, annual: parseTable(section(html, 'profit-loss')), balance: parseTable(section(html, 'balance-sheet')),
    cashflow: parseTable(section(html, 'cash-flow')), ratios: parseTable(section(html, 'ratios')),
    shareholding: parseTable(section(html, 'shareholding')),
    transcripts, annualReports: ar, presentations, quarterSources, fetchedAt: new Date().toISOString(),
  }
}

export async function fetchCompany(ticker: string): Promise<CompanyFundamentals> {
  const { html, basis } = await fetchCompanyHtml(ticker)
  return parseCompany(ticker, html, basis)
}

export function parseSector(html: string): string {
  const seg = section(html, 'peers')
  const m = [...seg.matchAll(/title="(Broad Sector|Sector|Broad Industry|Industry)"\s*>\s*([^<]+)<\/a>/g)]
  return decode(m.find(x => x[1] === 'Broad Industry')?.[2] || m.find(x => x[1] === 'Sector')?.[2] || '')
}

export async function fetchAnnouncements(screenerId: number): Promise<RawAnnouncement[]> {
  const r = await get(`${BASE}/announcements/recent/${screenerId}/`)
  return r.ok ? parseAnnouncements(await r.text()) : []
}

export async function fetchPrices(warehouseIdOrCompanyId: number, days = 400): Promise<PricePoint[]> {
  const r = await get(`${BASE}/api/company/${warehouseIdOrCompanyId}/chart/?q=Price-Volume&days=${days}`)
  if (!r.ok) return []
  const j = await r.json() as { datasets: { metric: string; values: any[] }[] }
  const p = j.datasets.find(d => d.metric === 'Price')?.values || []
  const v = new Map((j.datasets.find(d => d.metric === 'Volume')?.values || []).map((x: any) => [x[0], x]))
  return p.map((x: any) => {
    const vv: any = v.get(x[0])
    return { d: x[0], c: Number(x[1]), v: vv ? Number(vv[1]) : 0, del: vv?.[2]?.delivery ?? null }
  })
}

export async function searchCompanies(q: string): Promise<{ name: string; ticker: string }[]> {
  const r = await get(`${BASE}/api/company/search/?q=${encodeURIComponent(q)}&v=3`)
  if (!r.ok) return []
  const j = await r.json() as { id: number | null; name: string; url: string }[]
  return j.filter(x => x.id).map(x => ({ name: x.name, ticker: (x.url.match(/\/company\/([^/]+)\//)?.[1] || '').toUpperCase() })).filter(x => x.ticker && !/^\d+$/.test(x.ticker)).slice(0, 8)
}

/** Resolve screener's /company/source/quarter/ redirect to the BSE results PDF. */
export async function resolveQuarterSource(url: string): Promise<string | null> {
  const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } })
  const loc = r.headers.get('location')
  return loc ? directPdf(loc) : null
}
