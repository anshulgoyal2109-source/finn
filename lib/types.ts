// Data contracts shared by the pipeline (GitHub Action) and the web app.
// Everything the frontend renders comes through these shapes.

export type Category =
  | 'results' | 'mna' | 'fund_raise' | 'management_change' | 'litigation'
  | 'insider_trading' | 'earnings_call' | 'investor_meetings' | 'credit_rating'
  | 'dividend' | 'bonus_split' | 'capex' | 'press_release' | 'postal_ballot'
  | 'agm_egm' | 'pledging' | 'unclassified'

export type Tier = 'act' | 'glance' | 'routine'

export interface Holding {
  ticker: string          // NSE symbol
  name: string
  sector: string
  size: 'Large' | 'Mid' | 'Small'
  screenerId: number      // screener company id
  warehouseId: number     // screener warehouse id (chart api)
  bseCode?: string
}

export interface Filing {
  id: string              // stable id (BSE attachment GUID)
  ticker: string
  ts: string              // ISO timestamp of filing
  headline: string        // as filed
  blurb: string           // exchange / feed one-line description
  url: string             // primary-source PDF
  source: 'bse' | 'screener'
  category: Category
  classifiedBy: 'rule' | 'llm'
  score: number           // 0-100 priority
  tier: Tier
  why?: string            // why FINN ranked it here (one line, deterministic)
  enrichment?: Enrichment
}

export type Enrichment =
  | { kind: 'results'; data: ResultsCut }
  | { kind: 'people'; data: PeopleChange }
  | { kind: 'oneliner'; data: { text: string; model: string; next?: string } }

export interface MetricRow { cur: number | null; prev: number | null; yoy: number | null }
export interface ResultsCut {
  period: string                    // e.g. "Sep 2026"
  basis: 'consolidated' | 'standalone'
  unit: string                      // "₹ cr"
  revenue: MetricRow; ebitda: MetricRow; pbt: MetricRow; pat: MetricRow
  lender: boolean                   // banks / NBFCs: EBITDA not meaningful
  source: 'filing' | 'screener'     // which document the numbers came from
  verified: 'match' | 'mismatch' | 'unchecked'
  pages?: number[]                  // pages of the filing that were read
  note?: string
}

export interface Person {
  name: string; role: string; direction: 'in' | 'out'
  bio?: string; bioUnverified?: boolean; sources?: { title: string; url: string }[]
}
export interface PeopleChange { people: Person[]; summary: string }

export interface PricePoint { d: string; c: number; v: number; del?: number | null }
export type PriceBook = Record<string, PricePoint[]>

export interface LedgerEntry {
  stage: string; model: string; calls: number
  inTok: number; outTok: number; cached: number
}
export interface RunLog {
  at: string; filingsSeen: number; newFilings: number
  ruleClassified: number; llmClassified: number
  enriched: number; ledger: LedgerEntry[]; sources: Record<string, string>
  usdEquivalent: number
}

// ---------- Pull / research ----------
export interface Table { cols: string[]; rows: Record<string, (number | null)[]> }
export interface DocLink { label: string; url: string; date?: string }
export interface CompanyFundamentals {
  ticker: string; name: string; screenerId: number; warehouseId: number; bseCode?: string
  about: string; price: number | null; marketCapCr: number | null
  basis: 'consolidated' | 'standalone'
  lender: boolean
  quarters: Table; annual: Table; balance: Table; cashflow: Table; ratios: Table
  shareholding: Table
  transcripts: DocLink[]; annualReports: DocLink[]; presentations: DocLink[]
  quarterSources: DocLink[]
  fetchedAt: string
}

export interface Cite { doc: string; page?: number; url?: string; quote?: string }
export interface GuidanceItem {
  id: string; call: string; metric: string; statement: string
  horizon: string; quote: string; page: number; url: string
}
export interface Verdict {
  metric: string; promised: string; delivered: string
  status: 'delivered' | 'missed' | 'partly' | 'pending' | 'revised'
  evidence: string; cites: string[]   // GuidanceItem ids
}
export interface Dossier {
  ticker: string; name: string; generatedAt: string
  facts: Facts                       // deterministic, no LLM
  narrative?: Narrative              // LLM, grounded
  ledger: LedgerEntry[]
}
export interface Facts {
  price: number | null; marketCapCr: number | null; lender: boolean; basis: string
  about: string
  headline: { label: string; value: string; sub?: string; tone?: 'up' | 'down' | 'flat' }[]
  trajectory: { label: string; years: string[]; values: (number | null)[]; unit: string }[]
  quarterly: { cols: string[]; revenue: (number | null)[]; margin: (number | null)[]; pat: (number | null)[]; revYoY: (number | null)[] }
  balance: { label: string; value: string; note?: string; tone?: 'good' | 'bad' | 'neutral' }[]
  cash: { years: string[]; cfo: (number | null)[]; pat: (number | null)[]; fcf: (number | null)[]; conversion: number | null }
  flags: { text: string; tone: 'good' | 'bad' | 'neutral' }[]
  docs: { transcripts: DocLink[]; annualReports: DocLink[] }
}
export interface Narrative {
  business: { summary: string; segments: { name: string; share?: string; note: string }[]; cites: Cite[] }
  guidance: GuidanceItem[]
  scorecard: Verdict[]
  scoreline: string
  narrativeVsNumbers: { claim: string; reality: string; agrees: boolean; cites: string[] }[]
  bull: string[]; bear: string[]
  watch: string[]
  model: string
}
