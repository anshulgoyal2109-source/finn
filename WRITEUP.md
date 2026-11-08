# FINN — covering note

**What I built.** FINN is a mobile web app (installable as a PWA) for an investor holding 18 NSE stocks: large, mid and small caps across banks, IT, autos, consumer, infra, defence, electronics manufacturing and energy. A GitHub Action runs every hour on market days and again after the close. It pulls EOD price, volume and delivery %, plus every BSE filing, triages them, and enriches only the ones that matter. Vercel serves three screens built around three verbs:

- **Today (glance).** It opens on one sentence and one picture: *"FINN read 258 filings. 39 need you."* Below that sits a strip with one tick per filing, so you can see how much was filtered out. Material filings are cards you mark **Done**, inbox-style:
  - **Results:** Revenue, EBITDA, PBT and PAT versus last quarter and last year, read from the results PDF itself and cross-checked.
  - **Leadership changes:** who is coming in and their background.
  - **M&A, fund raises, legal:** a two-line "what happened / why it matters" note.

  "Worth a glance" items reuse the exchange's own one-line summary. Routine filings collapse into groups like "ESOP allotments ×12". Unusual moves use your own thresholds, which you set on Watch, and show delivery % next to volume. There's also a one-minute spoken brief.
- **Research (dig).** Works for any NSE ticker. The dossier opens on a verdict about management's credibility, then a **promised vs delivered** scorecard built from the last four earnings calls. Each row is marked delivered, partly, missed, revised or pending, and expands to the verbatim quote with a link to the transcript page. After that come story vs numbers, numbers and trajectory, cash quality, balance sheet, segment mix from the annual report, and bull/bear plus what to check next quarter.
- **Ask.** Scoped to one company, answered only from its two latest transcripts and its reported numbers, with page links.

**Key decisions.**

1. **Rules before models.** Exchange headlines follow SEBI's LODR categories, so ordered rules classify about 86% of filings for free. Only the leftovers go to Flash-Lite, in one batched call. Priority is a deterministic score that comes with a stated reason, so every card can say why it's there.
2. **The model never does arithmetic.** EBITDA, growth rates, cash conversion and every flag (for example *"Kaynes receivable days 74 → 154 in 3 years; operating cash negative over 5 years despite ₹977 cr profit"*) are computed in code. The model extracts and interprets; code calculates.
3. **Trust, but check.** Results numbers read from the filing are cross-checked against screener's independently standardised table. On HDFC Bank's scanned PDF the check caught an OCR column shift, and FINN showed the standardised figures, labelled, instead of wrong ones. Every transcript quote is string-matched against the page it claims to come from (the page is repaired when the model cites the printed page number); unmatched quotes are dropped, and every verdict must cite a surviving quote.
4. **Routing for cost.** Flash-Lite with minimal thinking handles all bulk reading. Flash with low thinking runs once per dossier, on extracts only, never on raw PDFs. Each tier has a fallback chain with a circuit breaker; Gemini's newest Flash was returning 503s after 39 s during the build, and the breaker turned that into a 4-second detour. Everything is content-addressed and cached.
   - The 75-day backfill (537 filings, 58 enrichments) cost $0.022 at paid-tier prices.
   - 22 research dossiers cost about $0.23.
   - A live dossier for an unseen company takes 16–20 s and about $0.01.
   - Actually paid: $0. The /engine page shows the ledger.
5. **One codebase.** The Action and the live API share parsers, router and research engine (TypeScript), so the push and pull sides can't drift apart.
6. **Primary sources on the pull side, honestly labelled on the push side.** For an incoming executive's background, FINN tries the SEBI-mandated profile in the filing, then an earlier filing that names the person, then Wikipedia. Model knowledge is used only as a last resort, and the card says so. Google Search grounding is wired in behind a flag but has no free-tier quota, so it's off.

**Deliberately left out.** Accounts (preferences live on the device), Web Push (phone alerts go through ntfy, which needs no infrastructure), news and broker notes (excluded by the brief, and by design), intraday data.

**Where I'd take it next.**
- A per-holding "thesis" note that FINN checks every result against, so it can say "this breaks what you believed".
- Guidance drift tracked across years, not just four calls.
- Peer-relative scorecards (does management miss more than peers in a bad quarter?).
- Concall audio for tone.
- Server-side preferences, so each investor's thresholds also drive the push.
