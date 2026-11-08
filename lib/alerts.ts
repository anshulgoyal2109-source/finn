// EOD threshold alerts — pure, runs in the browser so each investor's own
// definition of "unusual" applies instantly without a backend round-trip.
import type { PricePoint } from './types'

export interface Thresholds { volumeMultiple: number; priceMovePct: number; categories: string[] }
export const DEFAULT_THRESHOLDS: Thresholds = { volumeMultiple: 2, priceMovePct: 4, categories: ['results', 'mna', 'management_change', 'fund_raise', 'litigation', 'pledging', 'credit_rating'] }

export interface Move {
  ticker: string; date: string; close: number; changePct: number
  volume: number; volMultiple: number; delivery: number | null; avgDelivery: number | null
  reasons: ('volume' | 'price')[]; special: boolean
}

/** Latest regular session for a ticker, with move vs prior close and volume vs 20-session average. */
export function latestMove(ticker: string, s: PricePoint[] | undefined, t: Thresholds): Move | null {
  if (!s || s.length < 22) return null
  // Weekend / holiday special sessions (e.g. Diwali muhurat) are short: compare but flag them.
  let i = s.length - 1
  const isSpecial = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())
  const special = isSpecial(s[i].d)
  const cur = s[i], prev = s[i - 1]
  const win = s.slice(Math.max(0, i - 20), i).filter(p => !isSpecial(p.d))
  const avg = win.reduce((a, p) => a + p.v, 0) / Math.max(1, win.length)
  const dels = win.map(p => p.del).filter((x): x is number => x != null)
  const m: Move = {
    ticker, date: cur.d, close: cur.c, changePct: ((cur.c - prev.c) / prev.c) * 100,
    volume: cur.v, volMultiple: avg ? cur.v / avg : 0, delivery: cur.del ?? null,
    avgDelivery: dels.length ? dels.reduce((a, b) => a + b, 0) / dels.length : null, reasons: [], special,
  }
  if (!special && m.volMultiple >= t.volumeMultiple) m.reasons.push('volume')
  if (Math.abs(m.changePct) >= t.priceMovePct) m.reasons.push('price')
  return m
}

/** Last regular session (skips special sessions) — what "today's move" means for the brief. */
export function lastRegular(ticker: string, s: PricePoint[] | undefined, t: Thresholds): Move | null {
  if (!s) return null
  let k = s.length
  while (k > 22 && [0, 6].includes(new Date(s[k - 1].d + 'T12:00:00Z').getUTCDay())) k--
  return latestMove(ticker, s.slice(0, k), t)
}

/** All threshold crossings within the window (for the digest), newest first. */
export function movesInWindow(ticker: string, s: PricePoint[] | undefined, t: Thresholds, sinceISO: string): Move[] {
  if (!s) return []
  const out: Move[] = []
  for (let k = s.length; k > 22; k--) {
    if (s[k - 1].d < sinceISO.slice(0, 10)) break
    const m = latestMove(ticker, s.slice(0, k), t)
    if (m && m.reasons.length) out.push(m)
  }
  return out
}
