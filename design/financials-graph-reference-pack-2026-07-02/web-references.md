# Web References — Financial Graphs and Dashboard Patterns

Captured screenshots live in `references/`. Some sites blocked or returned 404/403; use the valid references below and treat blocked captures as notes only.

## Finance trust / product surfaces

### Stripe Revenue Recognition
URL: https://stripe.com/revenue-recognition
Screenshot: `references/stripe-revenue-recognition.png`
Use for: calm enterprise finance presentation, clear relationship between numbers and explanatory copy.
Steal: restrained color, chart-as-accounting-proof, not chart-as-decoration.
Avoid: Stripe’s blue/purple brand look; Odesa should stay warm paper/navy/green/terracotta.

### Ramp Expense Management
URL: https://ramp.com/expense-management
Screenshot: `references/ramp-expense-management.png`
Use for: executive finance density, spend controls, policy/approval language.
Steal: money surfaces should connect metric → control → recommended action.
Avoid: generic SaaS hero gloss and overly corporate card-grid marketing.

### Mercury Treasury
URL: https://mercury.com/treasury
Screenshot: `references/mercury-treasury.png`
Use for: calm trust, money movement, finance copy with constraints.
Steal: serious financial language; clear statements about access, liquidity, and risk.
Avoid: making Odesa feel like a bank; it is a landlord operator console.

### Plaid Transactions
URL: https://plaid.com/products/transactions/
Screenshot: `references/plaid-transactions.png`
Use for: bank-connected data credibility and category/transaction language.
Steal: data freshness/sync status and cleaned/categorized transaction framing.
Avoid: promising imported expense data before Odesa actually has it.

## Chart implementation / visual grammar

### Highcharts Combination Chart
URL: https://www.highcharts.com/demo/highcharts/combo
Screenshot: `references/highcharts-combo.png`
Use for: bars + line in one chart.
Steal: collection dashboard needs billed/collected columns plus a collection-rate line.
Avoid: default Highcharts chrome; Odesa needs custom warm SVG styling.

### Chart.js Line Sample
URL: https://www.chartjs.org/docs/latest/samples/line/line.html
Screenshot: `references/chartjs-line-sample.png`
Use for: default line chart structure, legend/tooltip affordances.
Steal: visible axes, hover states, line/point clarity.
Avoid: random demo colors.

### visx Gallery
URL: https://airbnb.io/visx/gallery
Screenshot: `references/visx-gallery.png`
Use for: React/SVG primitives and custom chart control.
Steal: primitive approach if Odesa wants charts that look native rather than library-default.
Avoid: overengineering a charting system before the data contract is stable.

### Observable Plot
URL: https://observablehq.com/plot/
Screenshot: `references/observable-plot-home.png`
Use for: layered marks, facets/small multiples, exploratory data grammar.
Steal: think in marks: bars, rules, dots, text annotations, facets.
Avoid: exploratory notebook look inside production UI.

### Data-to-Viz
URL: https://www.data-to-viz.com/
Screenshot: `references/data-to-viz.png`
Use for: choosing the correct chart type.
Steal: match chart to question. Time series → line/bar; category comparison → bars; part-to-whole → only when categories matter; two-factor portfolio diagnosis → scatter.
Avoid: donut charts for time trends or fake precision.

## Landlord/property-specific note

Baselane pages currently returned 404 in capture, but the product category remains relevant: rent collection, bookkeeping, banking, security deposits, and property-specific accounting language. Use category vocabulary, not the broken screenshot.
