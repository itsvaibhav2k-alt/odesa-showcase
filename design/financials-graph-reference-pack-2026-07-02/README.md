# Odesa Financials Graph Reference Pack — 2026-07-02

Purpose: give Claude a concrete graph-first direction for finishing `/financials`. Current page is beautiful and on-brand, but it is not yet a real analytical finance surface: the charts are too small, too low-information, and do not make trend/property/variance diagnosis obvious.

## Folder contents

```
design/financials-graph-reference-pack-2026-07-02/
├─ current/
│  ├─ current-financials-full.png
│  └─ current-financials-viewport.png
├─ references/
│  ├─ capture-results.json
│  ├─ stripe-revenue-recognition.png
│  ├─ ramp-expense-management.png
│  ├─ mercury-treasury.png
│  ├─ data-to-viz.png
│  ├─ highcharts-combo.png
│  ├─ chartjs-line-sample.png
│  ├─ visx-gallery.png
│  ├─ observable-plot-home.png
│  └─ plaid-transactions.png
├─ mocks/
│  ├─ mock-01-collection-intelligence.html
│  ├─ mock-01-collection-intelligence.png
│  ├─ mock-02-cashflow-pnl.html
│  ├─ mock-02-cashflow-pnl.png
│  ├─ mock-03-property-performance.html
│  └─ mock-03-property-performance.png
├─ web-references.md
├─ current-critique.md
└─ CLAUDE_PROMPT.md
```

## Recommendation

Implement `mock-01-collection-intelligence` first. It solves the current biggest weakness without waiting for expense imports:

1. Replace the tiny 3-month decorative trend with a large 12-month analytical collection bridge.
2. Show billed/collected bars plus collection-rate line.
3. Annotate the current month gap and link it to the exact driver.
4. Make aging buckets readable with dollar + tenant count labels.
5. Add a property/driver panel so the user sees why the number changed.

Then implement `mock-03-property-performance` as the property rollup upgrade. Defer `mock-02-cashflow-pnl` until expenses/Schedule E data exists; keep the current honest null until then.

## Non-negotiable design rule

Do not add prettier fake charts. Every chart must answer at least one operator question:

- What changed vs prior period?
- Which property/tenant caused it?
- Is this late rent, vacancy, or missing data?
- How old is the risk?
- Where do I click to resolve it?

## Current page diagnosis

The current page has strong taste, typography, and trust language. The problem is analytical density:

- The main collection chart is only 3 months, so trends are not visible.
- There are no y-axis labels on the current trend chart, so scale is ambiguous.
- The collection-rate story is expressed in copy but not visually encoded.
- Property comparison is table-only and arrives too low on the page.
- Aging appears as a thin decorative strip; it does not visually communicate amount/severity.
- The current sparklines are too small to carry decision value.
- There is no variance bridge: user sees −$5,200 but not when/why it happened.
- There is no drilldown model for chart interactions beyond month links.

## Implementation stance

Keep Odesa’s warm paper/operator aesthetic. Change the information architecture and graph primitives, not the brand.

Use SVG/CSS or a lightweight React chart layer. If adding a dependency, prefer a React-friendly primitive with accessible SVG output and full styling control. Do not introduce heavy chart chrome or a dark BI dashboard look.
