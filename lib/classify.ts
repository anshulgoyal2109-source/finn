// Two-stage triage. Stage 1 is deterministic: exchange headlines are formulaic
// (SEBI LODR sub-categories), so ordered rules classify the large majority for
// free. Only filings the rules can't place confidently go to the bulk model,
// batched into a single call. Scoring is deterministic so it is explainable:
// every card can say *why* it was ranked where it was.
import type { Category, Tier } from './types'

type Rule = [RegExp, Category, number?] // pattern on headline (and blurb), category, confidence
const H: Rule[] = [
  [/newspaper|news paper|publication of (financial )?results|copy of newspaper/i, 'results', 0.9],
  [/esop|esps|stock option|employee stock|rsu/i, 'unclassified', 0.95],
  [/trading window|reg(ulation)?\.? ?74 ?\(5\)|compliance certificate|loss of share|duplicate share|kfin|registrar|change in (the )?(corporate office )?address|email registration|investor complaint|brsr|esg|business responsibility|monitoring agency|certificate under reg|reg(ulation)? 40|reg(ulation)? 7 ?\(3\)/i, 'unclassified', 0.9],
  [/statutory auditor|secretarial auditor|cost auditor|appointment of auditor/i, 'unclassified', 0.85],
  [/investor presentation|results presentation|earnings presentation|fact sheet/i, 'results', 0.85],
  [/financial results|results for the (quarter|period|year)|outcome of board meeting.*result|shareholders'? letter|integrated filing.*financial|half yearly report|^results\b/i, 'results', 0.9],
  [/board meeting intimation.*result|intimation of board meeting.*result|considering.*results/i, 'results', 0.85],
  [/transcript|audio recording|con\.? ?call|conference call|earnings call|investor call|analyst call/i, 'earnings_call', 0.85],
  [/analyst|investor meet|institutional investor|investor conference|non-deal roadshow|roadshow/i, 'investor_meetings', 0.8],
  [/change in (directorate|management|kmp)|cessation|resignation|retirement|appointment of (director|ceo|cfo|md|managing|chief|company secretary)|re-?appointment|superannuat|key managerial|steps? down|ceases? to be|becomes? (the )?(md|ceo|chair)|appointed as (the )?(md|ceo|cfo|chief|managing|whole|director)|elevat/i, 'management_change', 0.9],
  [/credit rating|rating/i, 'credit_rating', 0.9],
  [/insolvency|cirp|nclt|nclat|litigation|dispute|penalty|show cause|order passed|sebi order|tax demand|fine imposed|regulatory action|warning letter|import alert|usfda|observations/i, 'litigation', 0.85],
  [/pledge|encumbrance|reg(ulation)?\.? ?31/i, 'pledging', 0.9],
  [/sast|reg(ulation)?\.? ?29|insider trading|reg(ulation)?\.? ?7 ?\(2\)|prohibition of insider/i, 'insider_trading', 0.9],
  [/acquisition|acquire|amalgamation|merger|demerger|scheme of arrangement|joint venture|step-?down subsidiary|wholly owned subsidiary|incorporation of (a )?(new )?subsidiary|business transfer|slump sale|divest|restructuring|stake sale|share swap/i, 'mna', 0.85],
  [/qip|qualified institution|preferential|rights issue|warrants?|buy-?back|fund raising|raising of funds|non-convertible|ncds?\b|debentures|commercial paper|allotment/i, 'fund_raise', 0.8],
  [/bonus|split|sub-?division/i, 'bonus_split', 0.85],
  [/dividend|record date/i, 'dividend', 0.85],
  [/capex|capacity expansion|new plant|greenfield|brownfield|commission(ing|ed)|commercial production/i, 'capex', 0.8],
  [/postal ballot|scrutini[sz]er|e-?voting/i, 'postal_ballot', 0.9],
  [/annual general meeting|\bagm\b|\begm\b|extra-?ordinary general/i, 'agm_egm', 0.9],
  [/clarification|rumou?r|production volume|sales volume|business update|operational update|monthly update|press release|media release|order|contract|store opening|launch|partnership|award|general updates?|business update/i, 'press_release', 0.6],
]

export function ruleClassify(headline: string, blurb: string): { category: Category; confidence: number } {
  const h = headline.replace(/announcement under regulation 30 \(lodr\)-?/i, '').trim()
  for (const [re, cat, conf] of H) if (re.test(h)) {
    // headline says "transcript"/"meet" but the description is clearly about something else
    // (screener sometimes pairs a generic headline with the filing's real subject)
    if ((cat === 'earnings_call' || cat === 'investor_meetings' || cat === 'press_release') && blurb) {
      const b = ruleOnText(blurb)
      if (b && b !== cat && !['earnings_call', 'investor_meetings', 'unclassified', 'results'].includes(b)) return { category: b, confidence: 0.6 }
    }
    return { category: cat, confidence: conf ?? 0.8 }
  }
  const b = ruleOnText(blurb)
  if (b) return { category: b, confidence: 0.55 }
  return { category: 'unclassified', confidence: 0.3 }
}
function ruleOnText(t: string): Category | null {
  for (const [re, cat] of H) if (re.test(t)) return cat
  return null
}

const BASE: Record<Category, number> = {
  results: 85, mna: 78, management_change: 72, fund_raise: 62, litigation: 68, credit_rating: 45,
  pledging: 70, insider_trading: 50, capex: 60, press_release: 40, dividend: 35, bonus_split: 50,
  earnings_call: 32, investor_meetings: 12, postal_ballot: 22, agm_egm: 20, unclassified: 5,
}

export const CATEGORY_LABEL: Record<Category, string> = {
  results: 'Results', mna: 'M&A', fund_raise: 'Fund raise', management_change: 'Management',
  litigation: 'Legal / regulatory', insider_trading: 'Insider deal', earnings_call: 'Earnings call',
  investor_meetings: 'Investor meet', credit_rating: 'Credit rating', dividend: 'Dividend',
  bonus_split: 'Bonus / split', capex: 'Capex', press_release: 'Company update', postal_ballot: 'Postal ballot',
  agm_egm: 'AGM / EGM', pledging: 'Pledge', unclassified: 'Routine',
}

/** Deterministic priority with a human-readable reason. */
export function score(category: Category, headline: string, blurb: string, dayMovePct?: number | null): { score: number; tier: Tier; why: string } {
  const t = `${headline} ${blurb}`
  let s = BASE[category]; const why: string[] = []
  const has = (re: RegExp) => re.test(t)
  switch (category) {
    case 'results':
      if (has(/newspaper|publication/i)) { s = 8; why.push('Newspaper ad of results already filed') }
      else if (/half[- ]yearly report|reg(ulation)?\.? ?52/i.test(headline)) { s = 40; why.push('Debt-holder report — numbers already published') }
      else if (has(/presentation|fact sheet/i) && !/result/i.test(headline)) { s = 45; why.push('Results deck — supports the results filing') }
      else if (has(/intimation|to consider|will consider|scheduled|board meeting.*on/i) && !has(/approved|outcome/i)) { s = 34; why.push('Date of upcoming results') }
      else why.push('Fresh numbers')
      break
    case 'management_change':
      if (has(/\b(ceo|md|managing director|chief executive|cfo|chief financial|chairman|chairperson|whole[- ]time)\b/i)) { s += 14; why.push('Top-level change') }
      else if (has(/independent director|non-executive|nominee director|government nominee/i)) { s -= 30; why.push('Board seat, not executive') }
      if (has(/group head|business head|president/i)) { s -= 10; why.push('Senior, below CXO') }
      if (has(/superannuat|retire|completion of (his|her)? ?tenure|term/i)) { s -= 10; why.push('Planned / scheduled exit') }
      if (has(/resign/i)) { s += 6; why.push('Resignation') }
      break
    case 'fund_raise':
      if (has(/qip|preferential|rights|warrant|buy-?back/i)) { s += 12; why.push('Equity action — dilution or return of capital') }
      else if (has(/commercial paper|\bcp\b|ncd|debenture/i)) { s -= 32; why.push('Routine debt market borrowing') }
      if (has(/repayment|redeem|redemption|redeemed/i)) { s = 10; why.push('Debt repaid as scheduled') }
      break
    case 'credit_rating':
      if (has(/downgrad|negative|watch with negative/i)) { s += 35; why.push('Rating downgrade / negative outlook') }
      else if (has(/upgrad|positive/i)) { s += 12; why.push('Rating upgrade / positive outlook') }
      else if (has(/reaffirm|affirm|retain/i)) { s -= 28; why.push('Rating unchanged') }
      break
    case 'litigation':
      if (has(/lakh/i) && !has(/crore/i)) { s -= 25; why.push('Small penalty') }
      if (has(/set aside|allowed.*appeal|in favou?r|dismissed the petition against/i)) { s -= 8; why.push('Ruling in company’s favour') }
      if (has(/nclt|nclat|insolvency|sebi|cbi|ed\b|enforcement|usfda|warning letter|import alert/i)) { s += 6; why.push('Regulator / tribunal involved') }
      break
    case 'mna':
      if (/incorporat/i.test(headline) && !/acqui/i.test(headline)) { s -= 30; why.push('New subsidiary set up — administrative') }
      if (has(/extend|extension/i)) { s -= 25; why.push('Timeline extension of known deal') }
      if (has(/100%|entire stake|acquire|acquisition of/i) && !has(/incorporat/i)) { s += 8; why.push('Acquisition') }
      break
    case 'press_release':
      if (has(/clarification|price movement|rumou?r|news item|media report/i)) { s += 18; why.push('Exchange asked / company clarified') }
      if (has(/order|contract|win|bag|secur/i)) { s += 12; why.push('Order / contract') }
      if (has(/store open|award|certification|great place|study|survey|csr|recogni/i)) { s -= 22; why.push('Low-signal PR') }
      if (has(/highest|record/i)) { s += 6; why.push('Record operating data') }
      break
    case 'insider_trading':
      if (has(/promoter/i) && has(/sold|sale|dispos/i)) { s += 15; why.push('Promoter selling') }
      if (has(/promoter/i) && has(/acqui|bought|purchase/i)) { s += 10; why.push('Promoter buying') }
      break
    case 'earnings_call':
      if (has(/transcript/i)) { s += 4; why.push('Transcript — feeds research') } else { s -= 15; why.push('Call logistics') }
      break
    case 'postal_ballot': case 'agm_egm':
      if (has(/approv/i) && has(/\b(ceo|md|managing director|merger|amalgamation|qip|preferential|chairman)\b/i)) { s += 18; why.push('Shareholders approved a material item') }
      break
    case 'investor_meetings':
      why.push('Investor meeting logistics')
      break
    case 'unclassified':
      why.push('Compliance paperwork')
      break
  }
  if (dayMovePct != null && Math.abs(dayMovePct) >= 3 && s >= 20) { s += 8; why.push(`Stock moved ${dayMovePct > 0 ? '+' : ''}${dayMovePct.toFixed(1)}% that day`) }
  s = Math.max(0, Math.min(100, Math.round(s)))
  const tier: Tier = s >= 70 ? 'act' : s >= 35 ? 'glance' : 'routine'
  return { score: s, tier, why: why.slice(0, 2).join(' · ') }
}

/** Group label for collapsed routine items — "ESOP allotments ×4" reads better than 4 rows. */
export function routineGroup(category: Category, headline: string): string {
  const h = headline.toLowerCase()
  if (/esop|esps|stock option/.test(h)) return 'ESOP allotments'
  if (/newspaper|publication/.test(h)) return 'Newspaper ads'
  if (/trading window/.test(h)) return 'Trading-window notices'
  if (/kfin|address/.test(h)) return 'Registrar / address changes'
  if (category === 'investor_meetings') return 'Investor-meet intimations'
  if (category === 'earnings_call') return 'Call notices & recordings'
  if (category === 'fund_raise') return 'Debt / CP housekeeping'
  if (category === 'postal_ballot' || category === 'agm_egm') return 'Shareholder-meeting paperwork'
  if (category === 'credit_rating') return 'Ratings reaffirmed'
  if (category === 'results') return 'Results logistics'
  return 'Other compliance'
}
