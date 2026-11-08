# FINN — your portfolio, pre-read

A mobile-first investment agent for an Indian equity portfolio. FINN reads every exchange filing, every results PDF and every earnings-call transcript, so the investor only reads what matters.

- **Push (Today):** "38 things need you". The first thing you see is the sieve: one tick per filing, so you can see how much was filtered out. Below it:
  - **Your theses:** any condition you set that the latest numbers break.
  - **Across your portfolio:** patterns computed across holdings, e.g. "7 of 14 reporters saw margins contract ≥100 bps".
  - **Needs you:** compact cards you can expand. Each one answers *what happened / why it matters / check next*.
  - **Unusual moves:** each tile labelled filing-linked / sector / market-wide / unexplained.
  - **Worth a glance:** the shorter list, using the exchange's own one-line summaries.
  - **Routine:** collapsed into groups ("ESOP allotments ×12").
- **Results analyser:** Revenue / EBITDA / PBT / PAT against last quarter and last year, read from the results PDF and cross-checked against the standardised table. Also EBITDA margin change in basis points, revenue vs profit growth, exceptional items (derived from two reported lines, never from the model's sign), one-offs in the comparison quarter, and other income as a share of PBT.
- **Coming up:** results dates, fund-raise decisions and record dates that companies have announced, pulled from their own filings by date parsing (no model).
- **Time window:** 24 hours by default (as the brief asks), plus 3 / 7 / 30 days or a custom date range. A short first-visit guide helps someone opening the link cold.
- **Pull (Research, any NSE ticker):** the list shows each holding's management track record (kept / missed / pending) at a glance. the dossier leads with **promised vs delivered**, followed by a plain list of what management has explicitly guided. Every guidance statement from the last four calls is graded against reported numbers and links to its verbatim quote and transcript page. Each verdict carries an evidence-based confidence. After that: story vs numbers, numbers and trajectory, cash quality, balance sheet, segment mix from the annual report, bull/bear, and what to check next quarter.
- **Thesis tracker:** write why you own a stock and which numbers would prove you wrong. FINN checks those conditions against reported figures (no model involved), flags breaches on Today, and can "challenge my thesis" with the evidence.
- **Ask:** answers grounded in the latest transcripts. It routes to annual-report pages only for questions they cover better (risks, working capital, debt, segments, related parties), and cites document and page.
- **Watch:** you set what "unusual" means (±% move, × 20-day volume, filing types, per-stock mute). A 30-session alert history explains every alert (trigger, move vs your portfolio, likeliest cause) and lets you record the outcome. Optional phone push via ntfy.

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

**Guards.** Every structured model response is validated against its schema at runtime and retried on failure. Every quote the model returns is string-matched against the PDF page it cites (the page is auto-corrected when the model uses the printed page number). Unmatched quotes are dropped, and every verdict must cite a surviving quote id. In testing the results cross-check caught an OCR column shift on HDFC Bank's scanned filing. FINN showed the standardised figures instead of wrong ones.

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

## Known limitations

- Theses, alert outcomes and mutes are stored on the device (no accounts). Phone push uses the repo's default rules, not each user's sliders.
- The screener feed shows 5 recent filings per company; the BSE full feed fills the gap when it answers (it has from GitHub's runners so far).
- Free-tier rate limits mean a daily run refreshes a handful of dossiers at a time; the rest keep their previous version, and the date is shown.
- Scanned results PDFs fall back to standardised figures (labelled). Companies without published call transcripts get no promised-vs-delivered section, and the dossier says so.

## Deliberately left out

- **Portfolio "ripple effects".** With 18 largely unrelated holdings, almost every cross-company link would be inferred rather than evidenced in a filing. FINN does not present relationships it can't source.

- **Accounts and server-side user state.** Preferences live on the device, which is enough to prove the interaction model.
- **Native push via Web Push.** ntfy gives real phone notifications with zero infrastructure. Web Push would need a subscription store.
- **News and broker research.** Excluded by design on the pull side: only primary sources.
- **Intraday data.** The brief is end-of-day.
