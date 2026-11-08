// Upcoming corporate events, read from what companies have already announced
// (board-meeting intimations, record dates, AGMs, scheduled calls). Pure regex
// over the filing text: no model, and nothing is shown without its source filing.
import type { Filing } from './types'

const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** Every explicit calendar date in a string (12 November 2026, November 12, 2026, 12th Nov '26, 12/11/2026, 12.11.2026). */
export function datesIn(text: string): Date[] {
  const out: Date[] = []
  const y = (s: string) => (s.length === 2 ? 2000 + +s : +s)
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[\s-]+'?(\d{4}|\d{2})\b/gi)) out.push(new Date(Date.UTC(y(m[3]), MON[m[2].toLowerCase()], +m[1])))
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) out.push(new Date(Date.UTC(+m[3], MON[m[1].toLowerCase()], +m[2])))
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) if (+m[2] >= 1 && +m[2] <= 12) out.push(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])))
  return out.filter(d => !isNaN(+d))
}

export interface UpcomingEvent { ticker: string; date: string; kind: string; detail: string; url: string; filingId: string }

const KINDS: [RegExp, string][] = [
  [/result|financial statements|audited|unaudited/i, 'Results'],
  [/record date/i, 'Record date'],
  [/dividend/i, 'Dividend'],
  [/annual general meeting|\bagm\b/i, 'AGM'],
  [/extra-?ordinary general|\begm\b/i, 'EGM'],
  [/postal ballot|e-?voting/i, 'Shareholder vote'],
  [/earnings call|conference call|con\.? ?call|investor call/i, 'Earnings call'],
  [/fund rais|qip|preferential|warrant|issue price|ncd|debenture/i, 'Fund-raise decision'],
  [/board meeting|meeting of the board|committee/i, 'Board meeting'],
]

export function upcomingEvents(filings: Filing[], now: number, horizonDays = 21): UpcomingEvent[] {
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0)
  const end = +today + horizonDays * 864e5
  const out = new Map<string, UpcomingEvent>()
  for (const f of filings) {
    if (now - +new Date(f.ts) > 60 * 864e5) continue
    if (!/intimation|to consider|will consider|scheduled|record date|notice|to meet|will meet|to be held|meeting on|on \w+ \d|fix(ed)? .*date/i.test(`${f.headline} ${f.blurb}`)) continue
    if (/outcome|newspaper|transcript|recording|scrutini[sz]er/i.test(f.headline)) continue
    const text = `${f.blurb} ${f.headline}`
    const d = datesIn(text).find(x => +x >= +today && +x <= end)
    if (!d) continue
    const kind = KINDS.find(([re]) => re.test(text))?.[1]
    if (!kind) continue
    const key = `${f.ticker}|${d.toISOString().slice(0, 10)}|${kind}`
    if (!out.has(key)) out.set(key, { ticker: f.ticker, date: d.toISOString().slice(0, 10), kind, detail: f.blurb || f.headline, url: f.url, filingId: f.id })
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date))
}
