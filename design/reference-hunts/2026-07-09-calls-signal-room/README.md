# Odesa Calls — Signal Room reference hunt

Date: 2026-07-09

## Target

Refactor `/calls` from a polite sequence of setup/KPI cards into a distinctive operational listening desk. It should feel as composed as Owner Queue without copying its decision-ledger architecture: the dominant object here is a chronological record of transmissions and the evidence each call produced. The page must remain warm, truthful, privacy-safe, and useful with one call or fifty.

## Current-screen critique

- The page is centered inside a narrow 1000px column while the app shell is very wide, leaving large dead margins and making the operational content feel timid.
- The hierarchy repeats itself: title/meta, phone card, explanatory sentence, four equal KPI cards, filters, register, then integration card. Nothing owns the composition.
- Equal bordered rectangles make setup, metrics, call history, and diagnostics look equally important. The log should be the page; configuration should be a utility.
- The serif heading is elegant, but there is no contrasting visual instrument or spatial motif to make the screen memorable.
- Zero-heavy KPI cards amplify inactivity. A compact signal strip can communicate the same facts without turning absence into four monuments.
- The single call row is a generic table record rather than a human transmission with a sequence, participant, outcome, and trace.

## References

### StoryCorps Archive
URL: https://archive.storycorps.org/
Screenshot: `storycorps.png`
Use for: treating conversations as a human corpus, strong search-first framing, direct language about voices and participants.
Avoid: promotional hero imagery, loud red branding, chat popovers, and archive-scale marketing copy inside an operator workspace.

### American Archive of Public Broadcasting
URL: https://americanarchive.org/catalog/cpb-aacip_15-br8mc8rj0f
Screenshot: `american-archive.png`
Use for: record provenance, access/consent clarity, media/transcript evidence, stable archival metadata.
Limitation: the captured view is blocked by its reading-room agreement; visual claims beyond the modal are intentionally omitted.

### Magnum Contact Sheets
URL: https://www.magnumphotos.com/theory-and-practice/magnum-contact-sheets/
Screenshot: `magnum-contact-sheets.png`
Use for: contact-sheet sequencing, visible neighboring records, sparse selection marks, editorial annotation rather than filled cards.
Limitation: the captured view is blocked by a cookie panel; the implementation uses the documented contact-sheet principle, not unsupported claims from this screenshot.

### The Creative Independent
URL: https://thecreativeindependent.com/people/hanif-abdurraqib-on-the-writer-as-archivist/
Screenshot: `creative-independent.png`
Use for: confident black-on-paper typography, intentional oddness, small hand-made marks, loose editorial rhythm, controls that look like a publication index instead of SaaS pills.
Avoid: literal doodle copying, novelty typography in dense records, and whimsical marks on safety-critical controls.

### Vanderbilt Television News Archive
URL: https://tvnews.vanderbilt.edu/
Screenshot: `vanderbilt-archive.png`
Use for: chronology and search as the archive entrance, institutional masthead confidence, corpus-first hierarchy.
Avoid: giant welcome card, oversized search form, and generic rounded white panels.

### Operational references

- Gong call page: https://help.gong.io/docs/intro-to-the-call-page.md
- Aircall Conversation Center: https://aircall.io/call-center-software-features/conversation-center/
- Retell Session History: https://docs.retellai.com/features/session-history.md

Use for: synchronized evidence, finite call register, direct navigation to the call review studio, and explicit review reasons. Do not import sales-pipeline chrome or opaque AI scoring.

## Chosen direction — The Listening Desk

A warm editorial archive crossed with a restrained broadcast console.

1. **Compact masthead, not a hero.** The page title and phone-line truth occupy one shallow opening composition.
2. **One dark instrument field.** A charcoal/navy line-check band creates a memorable focal point and contrasts with the paper register. It contains number state, readiness, and the three real utilities: Settings, Scripts, Test call.
3. **Signals, not KPI cards.** Today/resolved/review/actions become a single ruled strip with tabular numerals; zero values stay quiet.
4. **The register is the page.** The call log begins immediately and spans the available width. Each record reads as a broadcast log line: sequence/time, participant, outcome, Odesa trace, duration, disposition.
5. **Typography replaces containers.** Thin rules, compact mono labels, serif selected titles, restrained status marks; very few rounded cards and almost no shadows.
6. **Human record dignity.** Caller identity and one-sentence outcome lead. Metadata supports rather than dominates.
7. **Configuration recedes.** Full readiness diagnostics live in a collapsed ledger below the register; the current state remains visible in the opening band.

## Visual contract

- Canvas: existing Odesa warm paper tokens.
- Instrument: `--dark` / `--dark-lift`, with cream text and muted terracotta registration marks.
- Corners: 4–8px for working surfaces; no 16px SaaS cards.
- Type: editorial serif only for the page thesis and selected record titles; strict operator sans for content; mono only for sequence, time, duration, IDs, and signal labels.
- Motion: a very restrained live/readiness pulse only when honest; disabled under reduced motion.
- Responsive: at desktop, show a full ruled register. At narrow widths, each row becomes a compact transmission sheet while preserving its direct native link.

## Acceptance criteria

- Above the fold: phone truth, utilities, review burden, and at least one call record are visible.
- No four-card KPI grid and no setup-card grid.
- The page uses a wider 1240px working canvas comparable to Owner Queue.
- Every call row remains a native privacy-safe link to its own `/calls/[id]` route.
- Existing test IDs and truthful readiness semantics remain intact.
- Settings, Scripts, and Test call remain real routes.
- The register works for empty, single-call, and multi-call states.
- Desktop and mobile screenshots show no clipping, horizontal overflow, or floating-control overlap.
