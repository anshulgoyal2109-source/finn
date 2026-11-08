// Optional full-feed adapter for BSE's announcement API. Screener's per-company
// feed only shows the 5 latest filings; with hourly polling + an append-only
// store that is rarely a gap, but when the BSE API answers we use it to be
// complete. If BSE refuses (it often blocks non-browser clients) we log it and
// carry on with screener — the pipeline never depends on it.
import type { RawAnnouncement } from './screener'

export async function bseAnnouncements(scrip: string, from: Date, to: Date): Promise<RawAnnouncement[] | null> {
  const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=${f(from)}&strScrip=${scrip}&strSearch=P&strToDate=${f(to)}&strType=C&subcategory=-1`
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'FINN-research-prototype/0.1', referer: 'https://www.bseindia.com/', accept: 'application/json' } })
    if (!r.ok) return null
    const j: any = await r.json()
    return (j.Table || []).filter((x: any) => x.ATTACHMENTNAME).map((x: any) => ({
      id: String(x.ATTACHMENTNAME).replace(/\.pdf$/i, ''),
      ts: new Date(String(x.DissemDT || x.NEWS_DT) + '+05:30').toISOString(),
      headline: [x.CATEGORYNAME, x.SUBCATNAME, x.NEWSSUB].filter(Boolean).join(' - ').slice(0, 300),
      blurb: String(x.HEADLINE || '').slice(0, 400),
      url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${x.ATTACHMENTNAME}`,
    }))
  } catch { return null }
}
