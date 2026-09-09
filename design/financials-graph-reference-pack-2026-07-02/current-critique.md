# Current `/financials` Critique — Graph/Data Readability

Captured from local Odesa at `current/current-financials-full.png` using the existing Galaxy test owner flow.

## What works

- The page feels premium and coherent with Odesa’s warm operator-console direction.
- Hero numbers are honest and human-readable.
- The copy correctly refuses to invent NOI/expenses before imports exist.
- Exception queue is useful and specific.
- The property P&L table is clear once the user scrolls down.

## What does not work yet

### 1. The core chart is decorative, not analytical

Current `Collection trend` shows only May/Jun/Jul. It has bars but no y-axis labels, no data labels, no rate line, and no annotation explaining the July gap. A landlord cannot tell whether July is a small miss, a severe miss, or part of a broader decline without reading surrounding copy.

Fix: make this a large 12-month chart with:
- billed bars
- collected bars
- collection-rate line
- y-axis dollar labels
- optional right axis or percent labels for rate
- visible current-month annotation
- click targets for `/rent?cycle=YYYY-MM`

### 2. Sparklines are too small to mean anything

The KPI card sparklines are visually tasteful but too small and unlabeled. They do not show scale, time, or causality. Keep them only as secondary texture; do not rely on them as the chart system.

Fix: main chart carries meaning; KPI cards summarize and link.

### 3. Aging is underpowered

The current aging module has a thin strip plus four labels. It technically states the data but does not create visual urgency. `1–7 days $5,200 / 2 tenants` should be legible at a glance.

Fix: use a horizontal or vertical bar chart with amount labels and tenant counts, terracotta reserved for 31+ or actual severe overdue states.

### 4. Property comparison is not visual

The table shows the key story: 17th Street Row is the collection problem; Winchester/Vaibhav’s House are vacancy problems; Oakwood is healthy. But that insight is buried below copy and rows.

Fix: add a property performance chart/board above or beside the table:
- occupancy × collection scatter
- ranked risk heatmap
- property contribution to outstanding

### 5. No variance bridge

The page says `−$5,200 collected vs prior` and `$5,200 outstanding`, but not visually. There is no bridge showing how billed → collected → outstanding, or how prior month → current month changed.

Fix: add a waterfall/bridge or annotated trend callout.

### 6. Graphs need drilldown contracts

Pretty charts become useful when every mark has an action:
- Month bar → `/rent?cycle=YYYY-MM`
- Outstanding segment → `/rent?filter=outstanding`
- Late segment → `/rent?filter=late`
- Property dot/row → property-level financial drilldown or filtered rent ledger

Do not build dead SVG art.
