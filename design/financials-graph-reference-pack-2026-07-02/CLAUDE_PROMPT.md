# Claude Prompt — Finish Odesa Financials Graph System

Goal: Upgrade `/financials` from a beautiful finance readout into a graph-first financial command center where a landlord can actually understand trends, compare properties, see variance, and drill into exceptions.

Repo: `/Users/vaibhav/odesa`
Branch: `feat/authenticated-trust-sprint`
Reference pack: `design/financials-graph-reference-pack-2026-07-02/`

Read these first:
- `design/financials-graph-reference-pack-2026-07-02/current-critique.md`
- `design/financials-graph-reference-pack-2026-07-02/web-references.md`
- `design/financials-graph-reference-pack-2026-07-02/mocks/mock-01-collection-intelligence.png`
- `design/financials-graph-reference-pack-2026-07-02/mocks/mock-03-property-performance.png`
- Defer `mock-02-cashflow-pnl` unless real expense/Schedule E data already exists; do not invent NOI.

Current issue:
The page looks premium but the graphs are mostly decorative. The 3-month trend is too small and unlabeled; KPI sparklines cannot carry real analytical meaning; aging is underpowered; property comparison is table-only; and users cannot visually diagnose why collection changed.

Implement this in production, preserving existing data integrity and server-side data flow:

1. Replace the current `CollectionTrend` with a large 12-month analytical chart.
   - Show billed and collected as grouped bars.
   - Show collection rate as a line or clearly labeled overlay.
   - Include y-axis dollar labels and month labels.
   - Annotate the current month gap when outstanding > 0.
   - Preserve month drilldown links to `/rent?cycle=YYYY-MM`.
   - Keep zero baseline. Do not use misleading truncated axes.

2. Upgrade aging from decorative strip to readable chart.
   - Show Current / 1–7 / 8–30 / 31+.
   - Each bucket must show dollars and tenant count.
   - Use terracotta only for actual late/severe buckets; do not turn the whole chart red.
   - Bucket links should drill to the appropriate rent filter if a filter exists; otherwise leave accessible labels only.

3. Add a property performance visual above or beside the property table.
   - At minimum: property contribution/risk board showing billed, collected, outstanding, late, occupancy, and collection rate.
   - Preferred: occupancy × collection scatter or ranked horizontal bar/heatmap, depending on what is fastest to implement cleanly.
   - Make the core insight obvious: 17th Street Row is a collection problem; vacant properties are occupancy/listing problems; Oakwood is healthy.
   - Every property visual should link to the property page or filtered rent ledger when possible.

4. Keep Odesa’s visual system.
   - Warm paper panels, thin borders, serif headings, disciplined sans/mono numeric labels.
   - No generic BI dashboard chrome.
   - No random gradients.
   - No fake data.
   - No invented expense/NOI figures.

5. Accessibility and implementation requirements.
   - Charts must have `role="img"` or semantic table fallback/aria labels.
   - Numeric values must be visible in text somewhere, not only encoded in color/position.
   - Use existing `getFinancialsConsole(periodKey)` data if possible. Add pure derived helpers only; avoid new DB queries unless absolutely necessary.
   - Add/extend unit tests for helper output if you introduce chart series transforms.
   - Add/extend Playwright coverage to assert graph landmarks render and links work.

Acceptance gates:
- `npm run typecheck`
- `npm run lint`
- `npm test -- src/lib/financials`
- `npx playwright test e2e/financials/console.spec.ts --project=chromium`
- `npm run build`
- route sweep if graph changes touch shared shell/routing

Report back with:
- Files changed
- What chart/data question each new graph answers
- Verification output
- Any deferred real-data requirements, especially expenses/Schedule E/NOI
