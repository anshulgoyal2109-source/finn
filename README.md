# FINN — your portfolio, pre-read

A mobile-first investment agent for an Indian equity portfolio. FINN reads every exchange filing, every results PDF and every earnings-call transcript, so the investor only reads what matters.

- **Push (Today):** "FINN read 258 filings. 39 need you." Material filings arrive as cards: results become a Revenue / EBITDA / PBT / PAT table versus last quarter and last year, read from the filing itself and cross-checked. Leadership changes show who is coming in and where they came from. M&A, fund raises and legal items get a two-line note. Routine filings are collapsed into groups ("ESOP allotments ×12"). Unusual moves follow the investor's own thresholds.
- **Pull (Research):** for any NSE company, a dossier led by **promised vs delivered**. Every guidance statement from the last four calls is checked against the reported numbers, and each one links to the exact transcript page. Then story vs numbers, cash quality, balance sheet, business mix, bull and bear, and an Ask box grounded in the transcripts.
- **Watch:** you decide what "unusual" means (volume × 20-day average, ±% move, which filing types). The app applies it instantly, and the GitHub Action pushes to your phone via ntfy.

## Point of view on interaction

An investor's day has three verbs: **glance, dig, ask.**

1. *Glance* is triage, not a feed. The Today screen is an inbox you finish. The first thing you see is the sieve: one tick per filing, so you can see how much was filtered before you read a word. Cards are marked **Done**, and the goal is inbox zero. There is a one-minute **Listen** mode (on-device speech, no cost) for the commute.
2. *Dig* is opinionated: the dossier opens on a verdict about management's credibility, not on a company description.
3. *Ask* is scoped to one company and its primary sources, so an answer is always a quote away from being checked.

## Architecture

```
GitHub Action (hourly on market days, 18:17 IST after close)          Vercel (Next.js, mobile web / PWA)
 ├─ screener.in  ─ EOD price, volume, delivery %                       ├─ /            Today: sieve, cards, moves, routine
 ├─ BSE API      ─ full announcement feed (screener feed as fallback)  ├─ /c/[ticker]  Dossier (pre-built or live)
 ├─ triage       ─ rules → batched Flash-Lite for leftovers            ├─ /research    search any NSE company
 ├─ enrich       ─ results PDF → numbers (+ cross-check),              ├─ /watch       thresholds & filing types
 │                 people → profile, material → one-liner              ├─ /engine      how it decides + cost ledger
 ├─ dossiers     ─ transcripts + annual report → research              └─ /api/research, /api/narrative (live, any ticker), /api/ask
 └─ commit data/*.json  ─────────────────────────────▶ redeploy
```

One TypeScript codebase: the Action and the live API share the same parsers (`lib/screener.ts`), model router (`lib/llm.ts`) and research engine (`lib/research.ts`).

### Where the model is used — and where it isn't

| Step | How |
|---|---|
| Classify ~86% of filings | Ordered rules over SEBI LODR headlines (free) |
| Classify the rest | **Flash-Lite**, one batched call |
| Priority score + "why" | Deterministic, explainable (`lib/classify.ts`) |
| Results numbers | Keyword-pick 2 pages of the PDF → **Flash-Lite** extracts; code computes EBITDA, QoQ, YoY; cross-checked against screener's standardised table; a scanned PDF that fails the check falls back, labelled |
| Incoming executive's background | The SEBI-mandated profile in the filing → an earlier filing naming the person → Wikipedia → model knowledge as a *labelled* last resort; plus a LinkedIn search link |
| Transcript → guidance with quotes | **Flash-Lite**, minimal thinking |
| Promised vs delivered, bull/bear | **Flash**, low thinking, sees only extracted claims + computed numbers |
| All arithmetic, thresholds, flags | Plain code (`lib/analytics.ts`, `lib/alerts.ts`) |

**Guards.** Every quote the model returns is string-matched against the PDF page it cites (the page is auto-corrected when the model uses the printed page number). Unmatched quotes are dropped, and every verdict must cite a surviving quote id. In testing the results cross-check caught an OCR column shift on HDFC Bank's scanned filing. FINN showed the standardised figures instead of wrong ones.

**Cost.** Each tier is a fallback chain with a circuit breaker (an overloaded model costs seconds, not the answer). Every call is content-addressed and cached. Backfilling 75 days across 18 holdings (537 filings, 58 enrichments) cost **$0.022 at paid-tier prices**; 22 research dossiers about **$0.17**; a live dossier for a new company ~16–20 s and ~$0.01. Actually paid: $0 (Gemini free tier). The `/engine` page shows the live ledger.

## Run it

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local          # free key: aistudio.google.com/apikey
npx tsx scripts/pipeline.ts                      # prices + filings + enrichment → data/
FINN_BACKFILL_DAYS=75 npx tsx scripts/pipeline.ts  # first run: pull history
npx tsx scripts/dossiers.ts [TICKER ...]         # pre-build research dossiers
npm run dev                                      # http://localhost:3000
```

**Deploy:** import the repo in Vercel and set `GEMINI_API_KEY` in its environment variables. In GitHub → Settings → Secrets → Actions, add `GEMINI_API_KEY` (and optionally `NTFY_TOPIC` for phone alerts). The workflow in `.github/workflows/finn.yml` then keeps `data/` fresh and every commit redeploys.

Portfolio and defaults live in `config/portfolio.json`.

## Deliberately left out

- **Accounts and server-side user state.** Preferences live on the device, which is enough to prove the interaction model.
- **Native push via Web Push.** ntfy gives real phone notifications with zero infrastructure. Web Push would need a subscription store.
- **News and broker research.** Excluded by design on the pull side: only primary sources.
- **Intraday data.** The brief is end-of-day.
