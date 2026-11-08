// PDF fetch + page-level text extraction. We never send a whole document to a
// model when a few pages will do: pages are scored by keywords and only the
// relevant ones are forwarded (the main cost lever on 300-page annual reports).
import { extractText, getDocumentProxy } from 'unpdf'

const UA = 'FINN-research-prototype/0.1'

export async function fetchPdf(url: string, maxBytes = 40_000_000): Promise<Uint8Array> {
  const candidates = [url]
  // BSE moves attachments from AttachLive to AttachHis after a while.
  if (url.includes('/AttachLive/')) candidates.push(url.replace('/AttachLive/', '/AttachHis/'))
  else if (url.includes('/AttachHis/')) candidates.push(url.replace('/AttachHis/', '/AttachLive/'))
  let lastErr = ''
  for (const u of candidates) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow', cache: 'no-store' })
      const ct = r.headers.get('content-type') || ''
      if (!r.ok || (!ct.includes('pdf') && !ct.includes('octet'))) { lastErr = `${r.status} ${ct}`; continue }
      const len = Number(r.headers.get('content-length') || 0)
      if (len > maxBytes) throw new Error(`PDF too large (${(len / 1e6).toFixed(0)} MB)`)
      const buf = new Uint8Array(await r.arrayBuffer())
      if (buf.length > 4 && String.fromCharCode(...buf.slice(0, 4)) === '%PDF') return buf
      lastErr = 'not a pdf'
    } catch (e: any) { lastErr = e.message }
  }
  throw new Error(`Could not fetch PDF ${url}: ${lastErr}`)
}

export async function pdfPages(buf: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(buf)
  const { text } = await extractText(pdf, { mergePages: false })
  return (text as string[]).map(t => t.replace(/[ \t]+/g, ' ').trim())
}

export async function readPdf(url: string, maxBytes?: number): Promise<string[]> {
  return pdfPages(await fetchPdf(url, maxBytes))
}

/** Score pages by weighted keyword hits; return the best `k` page indices (sorted). */
export function pickPages(pages: string[], keywords: [RegExp, number][], k: number, minScore = 1): number[] {
  const scored = pages.map((p, i) => {
    let s = 0
    for (const [re, w] of keywords) s += (p.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))?.length || 0) * w
    return { i, s }
  })
  return scored.filter(x => x.s >= minScore).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.i).sort((a, b) => a - b)
}

/** Render selected pages with page markers so the model can cite them. */
export const withPageMarkers = (pages: string[], idx: number[], maxChars = 12000) =>
  idx.map(i => `[[page ${i + 1}]]\n${pages[i].slice(0, maxChars)}`).join('\n\n')

export const wordCount = (pages: string[]) => pages.reduce((a, p) => a + p.split(/\s+/).length, 0)
