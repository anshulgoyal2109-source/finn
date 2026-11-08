// EOD threshold alerts — pure, runs in the browser so each investor's own
// definition of "unusual" applies instantly without a backend round-trip.
import type { PricePoint } from './types'

export interface Thresholds { volumeMultiple: number; priceMovePct: number; categories: string[]; muted?: string[] }
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

// ---------- Alert history with explanations ----------
// Every alert carries its trigger, the supporting data and why it was surfaced.
// "Why" is decided by plain rules, in this order:
//   1. a filing landed between the previous close and this close  -> filing-linked
//   2. the portfolio as a whole moved the same way                -> market-wide
//   3. otherwise                                                   -> unexplained (worth investigating)
export interface FilingLite { id: string; ticker: string; ts: string; headline: string; tier: string; category: string; url: string }
export interface AlertEvent extends Move {
  sector: string
  portfolioMedian: number          // median holding move that session
  relative: number                 // move minus portfolio median, in % points
  cause: 'filing' | 'market' | 'sector' | 'unexplained'
  filings: FilingLite[]
  sectorPeers: string[]
  reason: string
}

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const isWeekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())

export function alertHistory(holdings: { ticker: string; sector: string }[], prices: Record<string, PricePoint[]>, t: Thresholds, filings: FilingLite[], sessions = 30): AlertEvent[] {
  const muted = new Set(t.muted || [])
  // regular sessions present in the price book, newest last
  const days = [...new Set(Object.values(prices).flatMap(s => s.map(p => p.d)))].filter(d => !isWeekend(d)).sort().slice(-sessions)
  const out: AlertEvent[] = []
  for (const d of days) {
    const moves = holdings.map(h => {
      const s = prices[h.ticker]; if (!s) return null
      const k = s.findIndex(p => p.d === d); if (k < 22) return null
      return latestMove(h.ticker, s.slice(0, k + 1).filter((p, i, a) => i === a.length - 1 || !isWeekend(p.d)), t)
    })
    const changes = moves.filter(Boolean).map(m => m!.changePct)
    const med = median(changes)
    const prevDay = days[days.indexOf(d) - 1]
    holdings.forEach((h, i) => {
      const m = moves[i]; if (!m || !m.reasons.length || muted.has(h.ticker)) return
      // filings disseminated after the previous close (15:30 IST) and up to this close
      const from = prevDay ? new Date(prevDay + 'T10:00:00Z').getTime() : 0, to = new Date(d + 'T10:00:00Z').getTime()
      const fl = filings.filter(f => f.ticker === h.ticker && f.tier !== 'routine' && +new Date(f.ts) > from && +new Date(f.ts) <= to)
      const peers = holdings.filter((x, j) => j !== i && x.sector && x.sector === h.sector && moves[j]?.reasons.length && Math.sign(moves[j]!.changePct) === Math.sign(m.changePct)).map(x => x.ticker)
      const rel = m.changePct - med
      const cause: AlertEvent['cause'] = fl.length ? 'filing' : peers.length ? 'sector' : Math.abs(med) >= 1 && Math.sign(med) === Math.sign(m.changePct) && Math.abs(rel) < Math.abs(m.changePct) / 2 ? 'market' : 'unexplained'
      const trig = m.reasons.map(r => r === 'price' ? `price ${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}% (rule ±${t.priceMovePct}%)` : `volume ${m.volMultiple.toFixed(1)}× its 20-day average (rule ${t.volumeMultiple}×)`).join(' and ')
      const reason = cause === 'filing' ? `Coincides with a filing: ${fl[0].headline.slice(0, 90)}`
        : cause === 'sector' ? `Moved with ${peers.join(', ')} from the same sector`
        : cause === 'market' ? `Your portfolio's median stock moved ${med >= 0 ? '+' : ''}${med.toFixed(1)}% that day, so this looks market-wide`
        : `No filing and no matching sector or market move. ${Math.abs(rel).toFixed(1)} pts ${rel >= 0 ? 'better' : 'worse'} than your portfolio's median: worth investigating`
      out.push({ ...m, sector: h.sector, portfolioMedian: med, relative: rel, cause, filings: fl, sectorPeers: peers, reason: `Triggered by ${trig}. ${reason}.` })
    })
  }
  return out.reverse()
}
