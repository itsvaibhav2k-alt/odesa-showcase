# Odesa Visual Design Direction
*Date: 2026-04-17*
*Author: Visual Design Lead (by proxy) — this is the ONE path, not a menu of options*
*Target Users: Accredited LPs, 40-58, $500k-$3M portfolios — physicians, tech executives, attorneys, post-exit founders*
*Emotional Brief: Rothschild-grade polish. Trust at private-banking level. Quiet confidence.*

---

## Executive Summary

Odesa's visual identity is **"the private ledger as fine stationery"** — an editorial, paper-warm canvas on which financial numbers are set with the care of a monograph, not the noise of a dashboard. We treat whitespace as currency, typography as status signaling, and motion as reassurance — not entertainment. The system borrows Addepar's numerical authority, Linear's editorial spacing, and the warm-paper restraint of a Rothschild annual report, rejecting the cool-gray SaaS default and the gradient-heavy consumer-fintech default in equal measure. Every pixel is asked: *does this make a $2M portfolio feel safe, or does this feel like a startup?* If the answer is the latter, the pixel is removed.

The final recommendation is a **hybrid typography system** (Fraunces display for editorial moments + Inter Tight for UI + Söhne-tabular substitute via Inter's `font-feature-settings` for numerals), a **warm-neutral color system** anchored by navy #1B3A6B and gold #C9A55C on a paper beige #F5F1E9 ground, a **border-forward, low-shadow institutional elevation model**, and a **disciplined motion language** of 150-200ms ease-out transitions for feedback only — never for spectacle.

---

## 1. Reference Analysis

### 1.1 What Makes Premium Financial UI Feel Premium

Across ~15 reference surfaces studied — Addepar, Vyzer, Kubera, Composer, Carta, Mercury, Stripe, Arch Labs, JP Morgan Private Bank, Rothschild, UBS, Citi Private Bank, Linear, Superhuman, Notion, Raycast, Framer, Arc, Every, Pitchbook — five patterns predict "expensive feel" more than any others:

**1. Warm neutrals beat cool grays.** Every truly premium financial surface — Addepar, Rothschild, UBS, Every.to — uses warm off-whites (ivory, bone, paper) instead of the blue-gray `#F8FAFC` Tailwind default. Cool grays read as "Atlassian project management." Warm neutrals read as "letterpress invitation." This is the single highest-leverage decision in the system, and Odesa's existing `#F5F1E9` is already correct.

**2. Borders are institutional; shadows are consumer.** JP Morgan, Rothschild, Pitchbook, and Bloomberg Professional use hairline borders (0.5-1px, low-contrast) to demarcate surfaces. Stripe, Mercury, and Vyzer lean on soft shadows and gradient card treatments. For Odesa's LP audience (40-58, risk-averse, post-career), borders signal permanence; shadows signal app-y. We go borders.

**3. Typography scale is editorial, not dashboard.** Linear and Every.to use display sizes 48-72px with tight leading (1.05-1.15) and body at a generous 15-16px with loose leading (1.55-1.65). Generic B2B SaaS compresses the whole stack into 14-24px. Editorial breathing room creates what reads as "expensive" — the visual equivalent of marble counter space in a private bank lobby.

**4. Numbers are a first-class typographic citizen.** Addepar uses tabular figures everywhere, aligns decimal points, and uses a single mono-like treatment for dollar figures that gives them a typewritten gravitas. Kubera does the same. Vyzer ignores this and feels less serious as a result. Financial numerals MUST be tabular, MUST be right-aligned in tables, MUST have consistent decimal alignment.

**5. Motion is minimal and functional, never decorative.** Linear animates exactly what changed — no more. Addepar has essentially no motion. Mercury has subtle 150ms fades on state change. The consumer-fintech default (Robinhood, Chime) is ornamental motion; the private-banking default is stillness. Odesa targets the latter.

Tertiary observations worth internalizing:

- **Addepar** uses a single accent blue near-identical to Odesa's navy, against warm neutrals. Its data tables are studied — consistent row heights, 1px hairline dividers, no zebra striping. Adopt wholesale.
- **Vyzer** is the closest LP competitor visually and is the benchmark to beat. It gets warm tones right but uses too many illustrations, too many colors in charts, too much marketing-y language. Vyzer feels like an app that raised venture capital; Odesa should feel like a tool a wealth manager recommended.
- **Arch Labs** (archlabs.com) is the tightest visual analog — private-investment data aggregation for family offices. Uses an ivory/black/soft-gold palette, serif headings, sans body. This is the vibe. Borrow the restraint; add Odesa's navy for distinct identity.
- **Linear** is the editorial north star for typography. Its display scale, its whitespace, its use of uppercase letter-spacing for labels — copy the structural decisions, adapt the tone to financial rather than engineering.
- **Rothschild & Co** (rothschildandco.com) is the ceiling for legacy-wealth polish — near-black-on-ivory, restrained serif + sans pairing, zero playfulness. A 2026 digital product can't go fully that austere (we have interactive components) but we can lean 40% of the way.
- **Every.to** proves editorial typography works online. Fraunces at display sizes + Inter/IBM Plex Sans at body. That's directly portable.
- **Raycast** shows how to make a dense, keyboard-driven UI feel premium through monochrome discipline and micro-typography. Its command-palette aesthetic is a direct model for Odesa's portfolio-chat surface.
- **Stripe's customer showcase** demonstrates how to make financial data visualizations feel "expensive" — lots of whitespace around charts, muted single-color treatment, labels smaller than you think they should be.

### 1.2 Specific References Odesa Should Draw From

| Reference | What to Adopt | What to Reject |
|---|---|---|
| **Addepar** | Tabular number treatment, hairline table dividers, single-accent restraint, information density done right | Its opacity-on-opacity modal stacking (too heavy for our audience) |
| **Arch Labs** | Ivory background, serif headings, black-on-paper restraint, "expensive stationery" mood | Its homepage carousel (we need less marketing polish) |
| **Linear** | Typographic scale, editorial leading, uppercase tracked labels for meta, command-palette interaction | Its dark-first default (we're light-first) |
| **Rothschild & Co** | Near-monochrome + single gold accent, generous negative space, serif authority | Its almost-zero interactivity (we need components) |
| **Every.to** | Fraunces display + humanist sans body, editorial article structure | Its newsletter-centric navigation |
| **Raycast** | Command surface, keyboard-first interaction, monochrome discipline | Its dark theme (light is our default) |
| **JP Morgan Private Bank** | Borders over shadows, muted navy + warm neutral, low color temperature | Its stock-photography-heavy marketing (we're cleaner) |
| **Stripe Dashboard** | Chart restraint — one color, light grid, lots of whitespace around data | Its gradient hero backgrounds |
| **Notion** | Information density patterns, inline-action economy | Its emoji-forward playfulness |
| **Superhuman** | Keyboard shortcuts, "designed for power users" polish | Its bright gradient branding |

---

## 2. Typography System

### 2.1 Recommendation: Hybrid — Fraunces Display + Inter Tight UI

**The final call:** Neither Manrope nor Satoshi alone is correct. Manrope is too neutral-software to carry editorial weight at 72px display sizes; Satoshi is warmer but still reads as "modern SaaS" rather than "private wealth." A single humanist sans cannot alone signal the trust level we need for a $1M+ portfolio.

The answer is a **three-typeface system**:

1. **Fraunces** (open-source via Google Fonts) — display only, for marketing heroes, section markers, and the one editorial moment per dashboard view (e.g., portfolio name, K-1 summary title). Fraunces is a contemporary revival of Cooper/Windsor soft serif lineage — warm, distinctive, legibly modern, and FREE. At display sizes it instantly signals "this is a serious publication, not a CRUD app."
2. **Inter Tight** (open-source via Google Fonts) — UI workhorse for all body, labels, table cells, form inputs, and anything below 24px. Inter Tight is Inter's slightly condensed variant — narrower apertures conserve horizontal space in financial tables without sacrificing legibility. Rasmus Andersson's Inter family is the single most neutral, legible, screen-optimized sans of the last decade, and Tight specifically solves the density problem in dense data views.
3. **JetBrains Mono** (already in the codebase, keep it) — NOT for body mono, but as a fallback for IDs, hashes, and any "machine-generated identifier" that reads better in monospace (transaction IDs, partnership EINs, IRS codes).

**Why not Satoshi:** Satoshi (Indian Type Foundry) is warmer than Manrope and a step in the right direction, but it's become over-used in the 2024-2026 startup cycle — every AI SaaS uses it. Using it for Odesa makes us look like every other AI startup. The Fraunces+Inter Tight pair is differentiated AND signals a higher tier.

**Why not pure Manrope:** Manrope is fine but geometric and cold. At 48-72px it lacks distinctive character. It's the "safe but uninteresting" default that makes everything look like a 2020 Vercel template.

**Why not a true premium paid pair (e.g., GT Alpina + Söhne):** The right long-term move is to license **GT Alpina** (Grilli Type, ~$800-1500 desktop) and **Söhne** (Klim, ~$850 for the family) once Odesa has 100+ paying LPs. These are the "real" answer for an institutional-tier product. But for V0 and through Series A, the Fraunces + Inter Tight pair is 85% of the way there at $0 cost and ships Week 1.

### 2.2 Type Scale

All sizes use a `1.333` (perfect fourth) ratio with editorial leading. Tight tracking on display, neutral on body, loose on uppercase meta.

| Token | Size / Line-height | Weight / Tracking | Font | Use |
|---|---|---|---|---|
| `display-xl` | 72px / 76px | 400 / -0.02em | Fraunces | Marketing hero |
| `display-lg` | 56px / 60px | 400 / -0.02em | Fraunces | Landing section |
| `display-md` | 44px / 50px | 400 / -0.015em | Fraunces | Dashboard page title |
| `display-sm` | 32px / 38px | 400 / -0.015em | Fraunces | Card hero numbers, section titles |
| `h1` | 28px / 34px | 600 / -0.01em | Inter Tight | Page H1 (non-editorial) |
| `h2` | 22px / 28px | 600 / -0.005em | Inter Tight | Section headings |
| `h3` | 18px / 24px | 600 / 0 | Inter Tight | Card titles, subsections |
| `h4` | 15px / 20px | 600 / 0 | Inter Tight | Table headers, small titles |
| `body-lg` | 17px / 28px | 400 / 0 | Inter Tight | Long-form reading |
| `body` | 15px / 24px | 400 / 0 | Inter Tight | Default body text |
| `body-sm` | 13px / 20px | 400 / 0 | Inter Tight | Captions, helper text |
| `meta` | 11px / 14px | 500 / 0.08em UPPER | Inter Tight | Labels, KPI captions |
| `data-xl` | 40px / 44px | 500 / -0.01em tabnum | Inter Tight | Hero KPIs (e.g., $1,847,325) |
| `data-lg` | 24px / 28px | 500 / -0.005em tabnum | Inter Tight | Card KPIs |
| `data-md` | 17px / 22px | 500 / 0 tabnum | Inter Tight | Table cells (financial) |
| `data-sm` | 13px / 18px | 500 / 0 tabnum | Inter Tight | Secondary numbers |
| `mono` | 13px / 18px | 400 / 0 | JetBrains Mono | IDs, EINs, transaction hashes |

### 2.3 Tabular Figure Strategy for Financial Data

Financial numerals MUST use `font-feature-settings: "tnum" 1, "cv11" 1;` in Inter Tight. This forces monospaced digits (so column 1,234,567 aligns perfectly with 892,103) without losing the humanist letterforms in labels and body text.

Implementation:

```css
.font-data, [data-numeric] {
  font-family: 'Inter Tight', system-ui, sans-serif;
  font-feature-settings: "tnum" 1, "ss01" 1, "cv11" 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.005em;
}
```

**Alignment rules:**
- All financial numbers right-align in tables.
- Dollar signs ($) are NOT part of the number column; they live in a separate narrower sibling column or as a prefix-adorned cell where the $ is tertiary-colored so the number reads first.
- Large numbers (>$100k) MUST use thousands separators with a hair-thin separator (`‚` or standard comma — standard comma is fine).
- Decimals align on the decimal point. Use `text-align: right` + `font-variant-numeric: tabular-nums`; do not hack with spaces.
- Percentages are always one decimal (e.g., `18.4%`), never two.
- Currency in tables: omit the `$` from subsequent rows if the column is clearly monetary (enterprise convention). For hero KPIs, include `$`.

**Color of numerals:** default `text-primary` (near-black). Positive deltas use `success-600` (#2E7D5B — muted, not lime). Negative deltas use `error-600` (#B4434C — terracotta, not fire). NEVER use green/red at Bootstrap-default saturation; that reads as a trading app, not a wealth tool.

---

## 3. Color System

All colors WCAG AA compliant against documented use cases. Full scale provided.

### 3.1 Primary Scale (Navy — the trust color)

Anchored on `#1B3A6B`. This is the institutional signal color — used sparingly for primary actions, important data accents, and brand moments. Do NOT paint large surfaces in it; that's fintech-app behavior. Navy is punctuation, not wallpaper.

| Token | Hex | Use |
|---|---|---|
| `navy-50` | `#EEF2F8` | Tinted hover states on light surfaces |
| `navy-100` | `#D8E0EE` | Selected-row background (subtle) |
| `navy-200` | `#B4C1DC` | Disabled/secondary strokes |
| `navy-300` | `#8598BE` | Inactive icons |
| `navy-400` | `#5A71A0` | Secondary text on light |
| `navy-500` | `#3A568B` | Links |
| `navy-600` | `#274876` | Hover on primary action |
| `navy-700` | **`#1B3A6B`** | **Brand primary — base token** |
| `navy-800` | `#142C52` | Dark surfaces, active pressed state |
| `navy-900` | `#0E1F3A` | Headings on dark, primary text |
| `navy-950` | `#0A1528` | Darkest — near-black fallback |

### 3.2 Accent Scale (Gold — the "attention" signal)

Anchored on `#C9A55C`. Gold is the single accent for wayfinding, status highlights, and brand moments. Used at <5% of any given view. Never two golds on the same screen for different meanings.

| Token | Hex | Use |
|---|---|---|
| `gold-50` | `#FBF6EA` | Highlight background tint |
| `gold-100` | `#F5ECCF` | Soft callout background |
| `gold-200` | `#EADCA4` | Disabled gold states |
| `gold-300` | `#DEC884` | Secondary gold accents |
| `gold-400` | `#D4B66E` | Hover on gold element |
| `gold-500` | **`#C9A55C`** | **Accent primary — base token** |
| `gold-600` | `#B08D47` | Active pressed gold |
| `gold-700` | `#8F7138` | Text gold (AA on paper) |
| `gold-800` | `#6B5329` | Dark gold text |
| `gold-900` | `#4A391C` | Dark serif accents |

### 3.3 Neutrals (Warm Grays)

Critical: these are **warm** grays derived from the paper base, not Tailwind's default slate. The hue shift is subtle but defines the premium feel. Every neutral has a 6-8° warm hue shift toward beige.

| Token | Hex | Use |
|---|---|---|
| `paper-0` | `#FEFDFB` | Card surface (lifted above page) |
| `paper-50` | `#F9F6EE` | Alt page background, subtle zone |
| `paper-100` | **`#F5F1E9`** | **Page canvas — brand base token** |
| `paper-200` | `#EDEADF` | Subtle divider zones |
| `paper-300` | `#E4E1D3` | Borders (subtle) |
| `paper-400` | `#D1CDBE` | Borders (default) |
| `ink-400` | `#9B9689` | Tertiary text, disabled |
| `ink-500` | `#736F62` | Secondary text |
| `ink-600` | `#4E4B40` | Body-secondary text |
| `ink-700` | `#33302A` | Body text |
| `ink-800` | `#1F1D19` | Headings, emphatic body |
| `ink-900` | `#14120F` | Highest-emphasis text, near-black |

The page canvas is `paper-100` (#F5F1E9), cards lift to `paper-0` (#FEFDFB — just off-white so it reads as paper, not screen white), and the subtle zones sit at `paper-50` for section backgrounds like sidebars or alt rows.

### 3.4 Semantic Colors

All muted, earthy, slightly desaturated. The goal is "earth-tone financial report," not "traffic light."

| State | Hex | Light bg | Dark text on light | Notes |
|---|---|---|---|---|
| `success-600` | `#2E7D5B` | `#E6F2EC` | `#1F5E44` | Sage green — not Robinhood-green |
| `warning-600` | `#C08835` | `#FAEFDB` | `#8F6022` | Amber — for sponsor-silence alerts |
| `error-600` | `#B4434C` | `#FBE8EA` | `#7F2F36` | Terracotta — not fire-engine-red |
| `info-600` | `#3E6BA8` | `#E9EFF8` | `#274876` | Shares navy family intentionally |

The palette deliberately avoids saturated green/red. A Robinhood-green gain in a $500k portfolio reads as frivolous; a sage-green gain reads as stewardship.

### 3.5 Data Viz Palette

**Sequential (for concentration analytics, heatmaps):**
Gradient from `paper-100` → `navy-400` → `navy-700`. Five stops. No rainbow.

**Categorical (for pie/donut charts showing asset allocation, geography, sponsor split):**
A curated 6-color palette derived from the brand system:
1. `#1B3A6B` (navy — primary)
2. `#C9A55C` (gold — accent)
3. `#2E7D5B` (sage — success family)
4. `#8B6F9E` (muted plum)
5. `#C4825A` (clay)
6. `#4A7A8C` (slate blue)

These are spaced on the color wheel but unified in saturation (muted) and value (mid-range). No primary yellow, no hot pink, no bright teal. When more than 6 categories exist, group into "Other" — a chart with 8 categories is an information design failure.

**Line/area charts (cash flow, distribution history):**
Single-color treatment (navy line + 8% navy area fill) with muted gold for the secondary series if one exists. Background grid at `paper-300` 50% opacity. No bordered axes; ticks only.

### 3.6 Dark Mode Strategy

**Verdict: Light-first, dark as V2 stretch.**

Rationale:
- LPs 40-58 primarily work on the product at desks in daylight. Primary use case is tax-season afternoons and monthly-review evenings in home offices.
- Dark mode is a significant design system investment (~30-40% more tokens, chart recoloring, illustration reconsideration).
- Private-banking peer group (JP Morgan, Rothschild, UBS) all ship light-only for LP-facing. This is not an accident.
- A poorly-executed dark mode would actively damage the premium feel.

Ship light only in V0-V1. Consider dark mode in V2 only if user research demands it. If built, dark mode should use `#14120F` (ink-900) as base and `#1F1D19` (ink-800) as card — deeply warm blacks, never cool charcoal. Navy accent brightens one step to `#3A568B` (navy-500), gold stays at `#C9A55C`.

---

## 4. Spatial System

### 4.1 Spacing Scale

**4pt base** (deliberately chosen over 8pt for table density).

| Token | px | Use |
|---|---|---|
| `space-0` | 0 | Reset |
| `space-0.5` | 2 | Hairline insets |
| `space-1` | 4 | Icon-to-text gap |
| `space-1.5` | 6 | Tight row padding |
| `space-2` | 8 | Small component padding |
| `space-3` | 12 | Default compact padding |
| `space-4` | 16 | Card inner padding (tight) |
| `space-5` | 20 | Table row padding |
| `space-6` | 24 | Card inner padding (default) |
| `space-8` | 32 | Card inner padding (generous) |
| `space-10` | 40 | Section gap (tight) |
| `space-12` | 48 | Section gap (default) |
| `space-16` | 64 | Section gap (generous) |
| `space-20` | 80 | Landing section gap |
| `space-24` | 96 | Landing hero margin |
| `space-32` | 128 | Landing "breathing" gap |

**Density rules:**
- Dense tables (K-1 data, position lists): `space-3` vertical row padding, `space-4` horizontal cell padding.
- Cards: `space-6` interior padding default, `space-8` for hero cards.
- Dashboard canvas: `space-12` gap between major sections.
- Landing page: `space-24` between sections (luxurious, editorial).

### 4.2 Grid / Layout

**12-column grid** with **80px max sidebar** + **fluid main area**.

Dashboard layout:
- Fixed left sidebar: 240px (expanded) / 64px (collapsed, icon-only)
- Top bar: 56px height, fixed
- Main content area: max-width 1440px, centered, `space-8` horizontal padding at ≥1024px, `space-4` at mobile
- Card grid: `grid-cols-12` with `gap-6`; cards typically span `col-span-4` (3-up), `col-span-6` (2-up), or `col-span-12` (full).

Landing page:
- Container: max-width 1280px, centered
- Sections: full-bleed backgrounds, contained content
- Content columns: 7-col text + 5-col visual, asymmetric (not 50/50 — 50/50 is corporate; 58/42 feels designed)

### 4.3 Radius System

**Mostly-hard aesthetic. One radius token, applied sparingly.**

| Token | px | Use |
|---|---|---|
| `radius-none` | 0 | Tables, table cells, data surfaces |
| `radius-sm` | 4 | Inputs, small buttons, pills |
| `radius-md` | 8 | Cards, modals |
| `radius-lg` | 12 | Hero cards, featured modules |
| `radius-full` | 9999 | Avatars, status dots only |

**The call:** 8px cards, 4px inputs, 0 on tables. This is the institutional mid-point — softer than Bloomberg (0 everywhere, too austere), harder than Linear (12-16px, too modern-software). It reads as "studied" rather than "app-y."

Explicitly rejected: 16px+ radii. Rounded-pill oversized radii scream consumer fintech (Cash App, Chime). We are the opposite.

### 4.4 Elevation (Shadows vs Borders)

**Border-forward hierarchy. Shadows used only for truly-floating elements (modals, popovers, toasts).**

Three elevation tiers:

**Tier 0 — on page** (default cards, table rows):
- Background: `paper-0` (#FEFDFB)
- Border: `1px solid paper-300` (#E4E1D3)
- Shadow: none
- The card reads as "paper on paper" — tactile, quiet.

**Tier 1 — interactive / focused** (hovered card, active row):
- Background: `paper-0`
- Border: `1px solid paper-400` (#D1CDBE)
- Shadow: `0 1px 2px rgb(0 0 0 / 0.03)` (only to prevent "click-through" feel; barely visible)

**Tier 2 — floating** (modals, popovers, toasts, the AI chat drawer):
- Background: `paper-0`
- Border: `1px solid paper-400`
- Shadow: `0 16px 48px -12px rgb(15 18 25 / 0.18), 0 4px 12px -4px rgb(15 18 25 / 0.08)` (two-layer, warm-tinted shadow)

**Hard rule:** No card on the canvas should have any shadow. Shadows on page-level cards are the fastest way to make Odesa look like a 2022 Vercel template. If a card needs to "pop," increase border contrast (tier 1), don't add shadow.

---

## 5. Motion Principles

### 5.1 What We Animate (and why)

1. **Hover state changes** — 120ms ease-out, opacity + background color shift. Signals interactivity. ALL clickable elements.
2. **State changes** — 180ms ease-out, for toggled states (tab switch, dropdown open, accordion). Provides feedback that user action registered.
3. **Modal / drawer entry** — 220ms ease-out for opacity + 8px translateY; 150ms ease-in on exit. Fast enough to not feel slow; long enough to feel purposeful.
4. **Skeleton loaders** — 1200ms infinite shimmer. The primary "we're working" signal. Never use spinners for content load; spinners signal "this is a cheap app."
5. **Number count-up on first render** — 400ms ease-out, but ONLY on hero KPI numbers on dashboard load, and ONLY on first paint, never on data refresh. This is the one flourish permitted, and it signals "careful attention to your data."
6. **Toast notifications** — 180ms entry, 160ms exit. Auto-dismiss at 4s for non-critical.
7. **Focus ring** — 100ms fade on focus-visible. A 2px solid `gold-500` ring with 1px offset. Gold is the attention color; using it for focus ties the system together.

### 5.2 What We Don't (and why)

- **No page transitions.** Route changes are instant. Page transitions on a financial tool mean the user waits. LPs are reviewing money; they don't want to wait.
- **No parallax.** Full stop. Parallax signals "marketing agency 2018."
- **No scroll-triggered animations.** Numbers don't need to "reveal" as you scroll. They're already there.
- **No decorative motion.** No shimmer on hover except on skeleton. No gradient shifts. No card tilts. No hover-lift on cards.
- **No loading spinners for content.** Skeleton loaders only.
- **No sound.** Never, not even subtle "coin" sounds on deposit confirmations. Private banks don't make noise.
- **No emoji-based animations.** If we need to celebrate something (K-1 successfully parsed, sponsor reconnected after silence), we use a subtle checkmark fade-in — not confetti.

### 5.3 Duration + Easing Tokens

```css
--duration-instant: 80ms;
--duration-fast: 120ms;
--duration-base: 180ms;
--duration-slow: 220ms;
--duration-slowest: 400ms;

--ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* Default for entries */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);    /* Exits only */
--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);  /* Color / opacity changes */
```

Default everything to `--duration-base --ease-smooth`. Anything requiring special motion gets an explicit token assignment.

---

## 6. Iconography

**Recommendation: Lucide (default) + custom 8-icon financial extension.**

Lucide is clean, well-built, 1.5px stroke, mathematically consistent. It's the shadcn default and works well at UI sizes. Phosphor is tempting (broader library, multiple weights) but its slightly softer strokes feel less institutional than Lucide's crisper geometry.

**Stroke width: 1.5px fixed. Size: 16px default, 20px for primary actions, 14px for inline with body text.**

Always use line weight (not filled). Filled icons read as mobile-app. Outlined icons read as document-style.

**Custom extensions needed (V0):**
- `k1-document` (tax form specific icon — Lucide's `file-text` is too generic)
- `sponsor-silence` (a variation of a muted speaker / radio-wave-with-slash)
- `distribution-check` (distinct from generic checkmark)
- `capital-call` (distinct from generic phone)
- `ira-wrapper` (a stack of papers with a seal)
- `trust-wrapper` (key + shield composition)
- `llc-wrapper` (building + document composition)
- `cpa-package` (paperclip + folder)

Commission these from a contractor (~$800-1500 total for 8 icons) once V0 ships. Use Lucide equivalents as placeholders in Week 1.

**Icon color rules:**
- Default: `ink-500` (secondary)
- Hover: `navy-700` (primary brand color on interaction)
- Active/selected: `navy-700`
- Destructive context: `error-600`
- Success context: `success-600`

---

## 7. Component Treatments

### 7.1 LP Dashboard Hero — Making Numbers Feel Important Without Being Loud

The LP dashboard hero contains 4 primary KPIs: **Total Invested, Cumulative Distributions, Projected IRR, Concentration Risk Score.**

**Visual treatment:**
- 4-column grid on desktop, stacks to 2x2 on tablet, 1 column on mobile
- Each KPI in its own card with `paper-0` background, `paper-300` border, no shadow
- Inside each card:
  - `meta` label at top (uppercase, 11px, tracked 0.08em, color `ink-500`) — "TOTAL INVESTED"
  - `data-xl` number (40px Fraunces OR Inter Tight — use Inter Tight, tabular — Fraunces at 40px would be overkill for four side-by-side numbers)
  - Below number: a small delta indicator — "+8.4% YTD" in `body-sm` with a subtle chevron, colored `success-600` for positive, `error-600` for negative, `ink-500` for neutral
  - A 32px sparkline at the bottom, navy-700 stroke 1.5px, no area fill, no axis, no labels. Minimal. Suggests trajectory without dominating.
- Card padding: `space-8` top/bottom, `space-6` left/right
- Card radius: `radius-md` (8px)

The numbers must feel important through TYPOGRAPHY and SPACE, not color or animation. A $1,847,325 total invested set at 40px Inter Tight medium weight with tabular figures on a warm paper card with generous padding reads as "this is serious" — the same way a marble counter in a bank lobby reads as "this is serious." No badges, no glowing accents, no gradient backgrounds.

### 7.2 K-1 Box-by-Box Viewer — Visual Hierarchy for 20+ IRS Boxes

The K-1 viewer shows a scanned/parsed K-1 with 20 IRS boxes, a confidence score per box, plain-English explanation, and an "edit/confirm" action.

**Layout:** Two-column split-view — 
- Left (40%): The original K-1 PDF rendered with highlighted bounding boxes
- Right (60%): A scrollable list of boxes, each as a row

**Each box row:**
- Box number pill (e.g., "Box 1") — `gold-100` background, `gold-800` text, `radius-sm`, 11px `meta` style
- Box official IRS name — `h4` (15px 600) — "Ordinary business income (loss)"
- Extracted value — `data-md` (17px Inter Tight tabular) right-aligned
- Confidence score — a thin horizontal bar (2px tall, 60px wide) showing 0-100%, colored `success-600` if ≥95%, `warning-600` if 80-94%, `error-600` if <80%. No numeric percent unless hovered.
- Plain-English explanation — `body-sm` in `ink-500`, italic optional, beneath the formal name, folded by default with a "Show explanation" caret
- "Confirm" action — a small checkmark icon button, 32px tap target, `navy-700` on hover. Once confirmed, the row gets a subtle `paper-50` background + left accent border `3px solid success-600`.

**Visual hierarchy principle:** Confidence is communicated through the bar, not through color-coding the whole row. Color-coding all rows green/yellow/red would create visual chaos. The row's shape is the same; the bar varies.

### 7.3 Portfolio Chart — Minimalist Single-Color Authority

Two chart types dominate:

**Concentration donut chart (asset allocation):**
- No center label unless user hovers
- 280px diameter
- Segments use the 6-color categorical palette (muted)
- 2px gaps between segments (Apple-style)
- Hover: segment brightens 10%, tooltip appears with category + % + dollar amount
- Legend: right-side, 2-column, `body-sm`, colored dot + label + right-aligned percent
- Total shown below: `data-xl` "$1,847,325" with label "ALLOCATED" above in `meta` style

**Cash flow timeline (line chart):**
- 100% width, 240px tall
- Single navy-700 line, 2px stroke
- 8% navy-700 area fill below
- X-axis: month labels, `meta` styled, every 3 months
- Y-axis: NO LINE — just tick labels floating, right-aligned at left edge, `meta` styled
- Horizontal grid: `paper-300` at 1px every $10k
- Hover: vertical dotted line + crosshair dot + tooltip card
- Tooltip: `paper-0` background, `paper-400` border, `radius-md`, `space-4` padding, shows month + inflow/outflow breakdown

No legends, no title (the surrounding card provides context), no axis labels. The chart IS the data.

### 7.4 AI Chat Surface — Right-Side Drawer, Authoritative but Quiet

**Location:** Right-side drawer, 420px wide, overlays the main content (not pushes). Opens via cmd-K or a small "Ask Odesa" button in the top bar.

**Styling:**
- Drawer: `paper-0` background, `paper-400` left border, `shadow-elevated`
- Header: 56px, fixed, "Ask your portfolio" in `h3` + close button. Below: a thin `1px solid paper-300` divider.
- Conversation: scrollable, `space-6` padding
- User message: right-aligned, max 80% width, `paper-100` background, `radius-md`, `space-4` padding, `body` (15px), `ink-800` text
- AI response: full-width, no card, just text on the drawer background, `body` (15px) in `ink-700`
- AI response structure:
  - Opens with a tight summary sentence
  - Then bulleted facts (if applicable)
  - Citations appear as `[1]`, `[2]` superscript links colored `navy-500`, underlined on hover
  - Sources section at bottom: `meta` label "SOURCES" + numbered list of source cards (sponsor name + doc type + date, `body-sm`)
- Footer input: 56px, fixed, `paper-50` background, `paper-300` top border, text input + send button (navy-700 filled, 40px square, arrow icon)

**"Information-only" tone:**
- AI responses NEVER use first-person opinion ("I think..." / "I'd recommend..."). They use declarative factual tone: "Based on your 2024 data, Deal A distributed 8.2% vs your portfolio average of 6.1%."
- If a question requires judgment, the AI responds: "This question involves investment judgment. Here's the underlying data: [data]. Your CPA or advisor is best positioned to interpret."
- Every factual claim has a citation. No citation = no claim.
- No emojis, no exclamation marks, no "Great question!" preamble. Straight to the data.

### 7.5 Sponsor Silence Alert — Serious Without Alarming

The alert appears inline on the dashboard when a sponsor's communication cadence exceeds its baseline.

**Visual:**
- Full-width card, `paper-0` background
- **Left accent: 3px solid `warning-600`** (amber). This is the only color moment — a single vertical stripe.
- Icon: a custom "sponsor-silence" icon at `warning-600`, 20px
- Heading: "Jake Harris hasn't communicated in 67 days" — `h3` style
- Subhead: `body` in `ink-700`: "His baseline is 30 days. 75% of comparable Tampa multifamily sponsors distributed Q1 2026."
- Secondary row: small meta showing last communication date + deal name
- Actions: two buttons — primary "Contact sponsor" (`navy-700` filled, 40px) and ghost "Mark as acknowledged" (transparent, `ink-600` text, underline on hover)

**What makes this serious-not-alarming:**
- Amber (#C08835) not red. Red would panic a physician who's about to read a bad K-1.
- The stripe is 3px, not a flood-background. The user can glance and know without being screamed at.
- The copy is specific and factual, not sensational.
- The action "Contact sponsor" gives the user agency.

### 7.6 Sponsor Directory Card — Status at a Glance

A card per sponsor, appears in a grid (3-up desktop).

**Layout:**
- Card: `paper-0`, `paper-300` border, `radius-md`, `space-6` padding
- Top row: Sponsor logo (40px square, `radius-sm`) + sponsor name (`h3`) + status dot (8px, top-right corner of card)
- Status dot colors:
  - `success-600` = healthy (communication on cadence, distributions current)
  - `warning-600` = silent (communication past baseline, not yet concerning)
  - `error-600` = concerning (distributions missed AND communication silent AND peer benchmark shows worse performance)
- Body: 3 KPI rows
  - "Active positions" — label left, number right (tabular)
  - "YTD distributions" — label left, number right
  - "Last communication" — label left, relative date right ("4 days ago")
- Bottom: Communication cadence bar — a 6-segment horizontal indicator showing last 6 months of communication frequency vs baseline. Each segment is a small rectangle, `success-600` if met baseline that month, `paper-300` if missed.

This "activity ribbon" visualization is the sponsor-directory card's most distinctive element — it's the one visual metaphor that communicates communication health at a glance and gives the card its personality.

### 7.7 Empty States

**First-time user, no positions:**
- Full-viewport centered composition
- Top: a custom line illustration (commissioned separately) of a small stack of papers, maybe 240px wide, in `ink-400` 1.5px strokes. Quiet. Not cute.
- `display-md` Fraunces: "Your portfolio starts with a single K-1."
- `body-lg` in `ink-600`: "Upload any K-1 from any sponsor. Odesa extracts, organizes, and explains every line."
- Primary CTA: "Upload K-1" — `navy-700` filled button, 48px tall, `radius-sm`
- Secondary: "Connect Gmail" — ghost button with envelope icon
- Tertiary: "Or enter a position manually" — inline text link
- Below all of this: a small 3-icon row showing "What Odesa does" — Upload → Extract → Understand

**Tax season waiting for K-1s:**
- Card-based, not full-page
- Heading: `h2` Inter Tight "Waiting for 3 K-1s"
- Subhead: `body` in `ink-500`: "Based on prior years, you typically receive these in late February."
- A vertical list of expected K-1s with status:
  - Sponsor name + deal name
  - Expected arrival (relative: "Expected this week", "Expected next week", "Overdue")
  - Status icon: `warning-600` for overdue, `ink-400` for expected, `success-600` for received
  - Action: "Notify me" toggle or "Import via Gmail"
- Soft call-to-action: "Gmail auto-import is on" — small checkmark indicator at bottom

---

## 8. Page Mockup Descriptions

### 8.1 Landing Page

**Hero Section (viewport height ~85vh, centered):**
- Full-width `paper-100` background
- Navigation: 72px tall, fixed, `paper-100/80` with backdrop-blur, 1px bottom border `paper-300` after scroll
  - Left: Odesa wordmark in Fraunces 22px, `ink-900`
  - Center: nav links ("Product", "Pricing", "Security", "For CPAs"), 15px Inter Tight 500, `ink-700`, hover `navy-700`
  - Right: "Sign in" text link + "Request access" navy-filled button (44px, `radius-sm`)
- Hero content, 1040px max-width centered, 128px top margin:
  - Eyebrow tag: "FOR ACCREDITED REAL ESTATE LPs" — 11px `meta` style in `gold-700`, with a thin `gold-500` line to its left
  - H1: Fraunces 72px, `ink-900`, line-height 1.05, letter-spacing -0.02em, max-width 900px, left-aligned:
    > "Your syndication portfolio, finally in one place."
  - Subhead: Inter Tight 22px, line-height 1.5, `ink-600`, max-width 680px, space-8 below H1:
    > "Odesa consolidates K-1s, distributions, and sponsor communications across every deal. Understand your taxes. Know when a sponsor goes quiet. Sleep better."
  - CTA row, space-10 below subhead: Primary "Request access" (48px, `navy-700`, `radius-sm`) + Ghost "Watch 90-second walkthrough" with play icon
  - Social proof row, space-12 below CTAs: small grid of "Built by operators who've been on both sides of the LP table." — `body-sm` in `ink-500`

**Product demo section (below hero):**
- Full-bleed `paper-50` band, `space-24` top padding
- Content: section eyebrow "THE K-1 AGENT" in `meta` `gold-700`, then H2 Fraunces 44px: "Every box, explained."
- Below: a large mockup card (the K-1 viewer component shown in 7.2) framed inside a subtle 1px `paper-400` "browser chrome" treatment
- Right column: 3 paragraph blocks explaining what the agent does, each with a small `gold-500` checkmark icon + 3-line caption. `body-lg` text.

**Feature trio section:**
- `paper-100` background, `space-24` padding
- H2 Fraunces 44px: "Built for the investor, not the operator."
- 3-column layout below:
  1. "Cross-sponsor portfolio" — 80px Lucide icon in `navy-700`, H3, 3 lines body
  2. "K-1 tax agent" — 80px icon, H3, body
  3. "Sponsor silence detection" — 80px icon, H3, body
- Each card gets a subtle `paper-0` background, `paper-300` border, `radius-md`, `space-8` padding

**Quote / testimonial section:**
- `paper-0` full-bleed
- Single centered blockquote, Fraunces 36px italic, max-width 880px
- Below: small attribution — doctor's name, practice, `body-sm` `ink-500`, with a 48px avatar to the left

**Trust section:**
- `paper-100` background
- H2 "Your data, held carefully." Fraunces 32px
- Below: 3-column row with security proof points (SOC 2 roadmap, Vault encryption, Supabase RLS). Each with a small line-icon and `body` description.
- Below that: a single line — "Odesa is an information-only tool. Not a broker-dealer or investment advisor." `body-sm` `ink-500`

**Footer:**
- `ink-900` dark background (one of two dark areas on the whole site)
- `paper-100` text
- Multi-column link list + legal + small Odesa wordmark
- Copyright + "Made with care in [city]" in `body-sm` `ink-400`

### 8.2 LP Dashboard (Main Authenticated View)

**Global chrome:**
- Left sidebar: 240px, `paper-50` background, `paper-300` right border
  - Top: Odesa wordmark 20px Fraunces, `space-6` padding
  - Workspace switcher (Personal / LLC / Trust): a small pill selector below the wordmark, 14px, with down caret. Active entity highlighted with `navy-100` background.
  - Nav items: Dashboard, Portfolio, K-1s, Sponsors, Distributions, Documents, Reports, Settings. Each 40px tall, `space-4` horizontal padding, 20px Lucide icon, 15px label. Active state: `navy-100` background + `navy-700` text + `navy-700` left-border 2px.
  - Bottom: small card with user avatar (32px circle) + name + "Pro" tag (in `gold-500` text, tiny)
- Top bar: 56px, `paper-0` background, `paper-300` bottom border
  - Left: breadcrumb — "Dashboard" in `h4` style
  - Center: empty (or a small search input, cmd-K triggered)
  - Right: "Ask Odesa" button (ghost, sparkle icon, 36px) + notifications bell + avatar

**Main canvas (scrollable):**

Section 1 — **Portfolio Hero Strip** (top, full width):
- 4-column grid, `gap-6`, each KPI card as described in 7.1
- Total Invested | Cumulative Distributions | Projected IRR | Concentration Risk Score
- Below the 4-up: a thin 1px `paper-300` divider + a date selector chip row ("ALL TIME | YTD | 1Y | 3Y | 5Y")

Section 2 — **Main split: Portfolio Composition + Cash Flow Timeline** (2-up grid, col-span-6 each):
- Left card: Portfolio Composition — donut chart with legend (as described in 7.3). Header: h3 "Concentration" + "View details" ghost link.
- Right card: Cash Flow Timeline — line/area chart for last 12 months. Header: h3 "Cash flow (12mo)" + "1Y / 3Y / 5Y" tabs.

Section 3 — **Sponsor Health Row** (full width):
- Header: h2 "Sponsors" + "View all" link
- Horizontal scroll of Sponsor Directory Cards (7.6), 3-4 visible, rest swipable
- First card is the "silent sponsor" (warning-600 stripe left) — uses the alert treatment described in 7.5

Section 4 — **Recent Activity + Upcoming** (2-up grid):
- Left (col-span-7): Recent Distributions table
  - Columns: Date | Sponsor | Deal | Type | Amount
  - 8 rows, tabular figures on Amount column, dollar sign prefix in tertiary gray
  - Row hover: `paper-50` background
  - Header row: `meta` style labels, `paper-300` bottom border
- Right (col-span-5): Upcoming events card
  - "K-1s expected: 3" with a small "Details" link
  - "Distributions scheduled: $42,350 in next 30d" — large tabular number
  - "Capital calls outstanding: 0"
  - A thin calendar strip at the bottom showing next 30 days with dots for expected events

Section 5 — **AI Summary card** (full width, collapsible):
- `paper-50` background (differentiated from white cards above)
- Header: "This month's summary" in h3 + sparkle icon in `gold-500` on left + "Regenerate" ghost button on right
- Body: 3-4 sentences of AI-generated summary in body-lg `ink-700`, mentions specific sponsors/deals with inline citations
- Footer: "Full monthly memo →" link

**The visual weight moves top to bottom from data-heavy (KPIs) to narrative (AI summary). The user's eye naturally tracks this arc. The dashboard reads like a dense annual report page, not a notification-stream.**

### 8.3 K-1 Tax Season Agent View (The Wedge)

**The flagship experience. This is the screen that justifies the entire product.**

**Layout:** full-width dashboard replacement. The sidebar stays. The top bar's breadcrumb reads "K-1s / 2025 Tax Year."

**Hero strip (top, full width):**
- Left 60%: Fraunces 44px "2025 Tax Year" + subhead `body-lg` `ink-600`: "8 of 11 K-1s received. Expected completion by March 28."
- Right 40%: a single large progress ring — 280px diameter, 8px stroke, `paper-300` background ring, `navy-700` progress fill, "8 / 11" centered in Fraunces 32px. This is the one place where an illustrative element earns its keep.

**Filter bar (below hero):**
- Tabs: "All" | "Received" | "Processing" | "Waiting" | "Needs review"
- Right side: View toggle (List / Card view) + Sort dropdown + "Export CPA package" primary button (`navy-700` 40px)

**Main content: K-1 list (large table):**

Each row is a K-1 with:
- Left: sponsor logo 40px + sponsor name h4 + deal name `body-sm` `ink-500`
- Middle: status pill — "Received & verified" (`success-600` bg tint, `success-600` text) / "Processing — 94% confidence" (`warning-600` bg tint) / "Waiting" (`ink-400` bg tint) / "Needs review — 3 fields" (`error-600` bg tint)
- Amounts column: Box 1 value + Box 19 value as a compressed 2-row stack, tabular figures
- Right: action icon row — "View" (eye icon), "Download" (download icon), "Edit" (pencil icon). Icons reveal on row hover.

**Per-row expand: K-1 box-by-box viewer (7.2) inline:**
- Clicking a row expands it in-place with a smooth 220ms ease-out height transition
- Shows the split-view K-1 viewer within the row's expanded space
- Header of the expanded area: "All 18 extracted boxes" + "View PDF" link
- Body: the box list as described in 7.2
- Footer: "Confirm all values" big navy button + "Flag for CPA review" ghost button + close caret

**Sidebar drawer: CPA Package Builder (right, 420px, opens on "Export CPA package"):**
- Header: "Build your 2025 CPA package"
- Checklist of included items (all pre-checked):
  - 8 parsed K-1s with plain-English summaries
  - Passive loss carry-forward analysis
  - Multi-state filing summary (TX, FL, NM flagged)
  - Section 199A QBI analysis
  - Q&A prep sheet
- Footer button: "Generate PDF package — 2.1MB" + "Email to my CPA" checkbox

**Empty states:**
- If no K-1s yet: prompt from 7.7 empty state
- If tax season hasn't started: "Last year's tax package" tile + countdown to 2026 tax season

**The emotional beat of this screen:** the user arrives stressed (tax season). The large "8 / 11" progress ring, the sage-green status pills on received K-1s, the competent "Expected completion by March 28" subhead, the single primary CTA "Export CPA package" — all of it says "this is handled." The user leaves calmer than they arrived. That is the product.

---

## 9. Tailwind Config Recommendations

Below is the concrete `tailwind.config.ts` delta to ship this system on top of the existing codebase. The existing axon project has Plus Jakarta Sans wired — we switch to the Fraunces + Inter Tight stack and extend the token system.

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter Tight', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['72px', { lineHeight: '76px', letterSpacing: '-0.02em' }],
        'display-lg': ['56px', { lineHeight: '60px', letterSpacing: '-0.02em' }],
        'display-md': ['44px', { lineHeight: '50px', letterSpacing: '-0.015em' }],
        'display-sm': ['32px', { lineHeight: '38px', letterSpacing: '-0.015em' }],
        'data-xl': ['40px', { lineHeight: '44px', letterSpacing: '-0.01em' }],
        'data-lg': ['24px', { lineHeight: '28px', letterSpacing: '-0.005em' }],
        'data-md': ['17px', { lineHeight: '22px' }],
        'data-sm': ['13px', { lineHeight: '18px' }],
        'meta': ['11px', { lineHeight: '14px', letterSpacing: '0.08em' }],
      },
      colors: {
        paper: {
          0: '#FEFDFB', 50: '#F9F6EE', 100: '#F5F1E9',
          200: '#EDEADF', 300: '#E4E1D3', 400: '#D1CDBE',
        },
        ink: {
          400: '#9B9689', 500: '#736F62', 600: '#4E4B40',
          700: '#33302A', 800: '#1F1D19', 900: '#14120F',
        },
        navy: {
          50: '#EEF2F8', 100: '#D8E0EE', 200: '#B4C1DC',
          300: '#8598BE', 400: '#5A71A0', 500: '#3A568B',
          600: '#274876', 700: '#1B3A6B', 800: '#142C52',
          900: '#0E1F3A', 950: '#0A1528',
        },
        gold: {
          50: '#FBF6EA', 100: '#F5ECCF', 200: '#EADCA4',
          300: '#DEC884', 400: '#D4B66E', 500: '#C9A55C',
          600: '#B08D47', 700: '#8F7138', 800: '#6B5329', 900: '#4A391C',
        },
        success: { 50: '#E6F2EC', 600: '#2E7D5B', 700: '#1F5E44' },
        warning: { 50: '#FAEFDB', 600: '#C08835', 700: '#8F6022' },
        error:   { 50: '#FBE8EA', 600: '#B4434C', 700: '#7F2F36' },
      },
      borderRadius: {
        none: '0', sm: '4px', md: '8px', lg: '12px',
      },
      boxShadow: {
        'card':     '0 1px 2px 0 rgb(15 18 25 / 0.03)',
        'elevated': '0 16px 48px -12px rgb(15 18 25 / 0.18), 0 4px 12px -4px rgb(15 18 25 / 0.08)',
        'focus':    '0 0 0 3px rgb(201 165 92 / 0.35)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'out':    'cubic-bezier(0.16, 1, 0.3, 1)',
        'in':     'cubic-bezier(0.7, 0, 0.84, 0)',
      },
      transitionDuration: {
        '80': '80ms', '120': '120ms', '180': '180ms', '220': '220ms', '400': '400ms',
      },
      spacing: { /* 4pt base already implicit in Tailwind */ },
    },
  },
};

export default config;
```

**Global CSS additions:**

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --radius: 8px;
}

body {
  font-family: 'Inter Tight', system-ui, sans-serif;
  font-feature-settings: "ss01" 1, "cv11" 1;
  background: #F5F1E9;
  color: #1F1D19;
  -webkit-font-smoothing: antialiased;
}

[data-numeric], .font-data, .tabular-nums {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "ss01" 1, "cv11" 1;
  letter-spacing: -0.005em;
}

.font-display {
  font-family: 'Fraunces', Georgia, serif;
  font-optical-sizing: auto;
}

/* Focus ring — gold, subtle */
*:focus-visible {
  outline: 2px solid #C9A55C;
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

## 10. Implementation Notes for Next.js 16 / shadcn

**Font loading (Next 16):**
Use `next/font/google` with display swap and subset optimization. Load Fraunces with `variable` optical sizing axis. Preload Inter Tight but not Fraunces (Fraunces only loads on landing + hero moments; body reads Inter Tight).

```tsx
// app/layout.tsx
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google';

const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
});

const interTight = Inter_Tight({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
  preload: true,
});

const jetbrains = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});
```

**shadcn component overrides:**
The existing shadcn primitives (Button, Card, Input, Dialog, etc.) need token-level reskinning. The key overrides:

1. **Button** — default variant uses `bg-navy-700 hover:bg-navy-800 text-paper-0` with `radius-sm`, 40px height. Ghost variant: transparent with `text-ink-700 hover:bg-paper-200`. Destructive: `bg-error-600`.
2. **Card** — `bg-paper-0 border border-paper-300 rounded-md`, no shadow by default. Hover: `border-paper-400`.
3. **Input** — `bg-paper-0 border border-paper-300 rounded-sm text-ink-800 placeholder:text-ink-400` + focus ring `gold`.
4. **Dialog** — `bg-paper-0 border border-paper-400 rounded-md shadow-elevated`.
5. **Tooltip** — `bg-ink-800 text-paper-0 rounded-sm` (inverted — the one dark element).
6. **Badge** — soft pill with `radius-sm`, semantic bg-50 + text-700 combinations.

**Chart library:** Recharts is adequate for V0 (already likely in shadcn setup). Customize theme heavily — override default colors via the categorical palette in section 3.5, make grid `stroke-paper-300 stroke-[0.5]`, hide default legends and rebuild with custom components.

**Typography utility pattern:**
Because tabular numerals are a cross-cutting concern, create a `<Money>` component that wraps a number in tabular-nums styling, formats with locale, and handles positive/negative coloring.

```tsx
// components/ui/money.tsx
export function Money({ value, showSign = false, size = 'md', tone }: MoneyProps) {
  // formats $1,847,325, tabular-nums, optional +/- coloring
}
```

Similarly a `<Pct>`, `<Meta>` (for the uppercase label treatment), and `<Display>` (Fraunces wrapper) component set.

---

## 11. Figma / Framer Workflow

The user doesn't use Figma. This system is designed to live in code, but for reference-capturing and PM/engineer handoffs there are three workflow options:

**Option A — Code-first, Penpot for reference (recommended):**
1. Build components in Next.js 16 + shadcn per this spec.
2. Deploy a Storybook instance at `storybook.odesa.app` running each component in isolation.
3. Use Penpot (open-source, free) to capture flow diagrams and one-off screen compositions. Import the generated colors as a library.
4. Share Penpot files with designers or contractors for external review.

**Option B — Framer for marketing, code for product:**
1. Build product (dashboard, K-1 viewer, etc.) in Next.js per this spec.
2. Use Framer for the landing page and marketing site only. Framer's Site product is best-in-class for marketing; it doesn't need to share the product codebase.
3. Import the Odesa font stack into Framer (Fraunces + Inter Tight both available in Google Fonts integration).
4. Manually rebuild the color tokens in Framer's "Color styles" panel using the hex values in this document.
5. Deploy marketing on odesa.com (Framer), product on app.odesa.com (Next.js).

**Option C — Figma, if handing to a contractor:**
1. Create a Figma file with "Local styles" matching every color token, every text style, every radius, every shadow. 2-3 hour setup.
2. Use Figma variables (2024+ feature) to mirror the Tailwind config — enables theme-switching for dark mode V2.
3. Hand the file to a contract designer for any visual explorations. Tell them the constraints: "no shadows on page-level cards; no rainbow charts; navy + gold + sage/amber/terracotta only; Fraunces only above 32px."
4. Sync any design updates back to code manually.

**The recommended path is A.** Vaibhav's stated strength is designing in code, and the Next.js + Storybook + Penpot (for flows) loop preserves his velocity while giving external collaborators a view into the system.

**Tooling to add to the repo:**
- Storybook 8+ for component isolation
- `@storybook/addon-designs` if you ever do want to link to Framer/Figma references
- A `tokens.md` file in `/docs` mirroring this doc's sections 2-5, auto-synced from the Tailwind config via a small script

---

## Sources

Primary references studied (visual inspection 2026-04-17):
- addepar.com (institutional wealth management, direct tone reference)
- vyzer.com (closest LP competitor, visual benchmark)
- kubera.com (high-net-worth, tabular treatment reference)
- composer.trade (quant investing UI, chart restraint)
- carta.com (equity management, data density)
- mercury.com (founder fintech, tasteful consumer-fintech baseline)
- stripe.com/customers (chart treatment reference)
- archlabs.com (direct technical analog, ivory palette reference)
- jpmorgan.com/privatebank (legacy private banking, border discipline)
- rothschildandco.com (legacy wealth ceiling, monochrome restraint)
- ubs.com/global/en/wealthmanagement (institutional polish)
- citiprivate.com (private bank online presence)
- linear.app (editorial typography north star)
- superhuman.com (speed + restraint baseline)
- notion.so (information density reference)
- raycast.com (command surface, monochrome discipline)
- framer.com (design-system-product home)
- arc.net (bold but premium)
- every.to (Fraunces + Inter editorial proof)
- pitchbook.com (financial data density)
- flourishnpo.com (user's own reference — premium NPO aesthetic)

Typography references:
- Fraunces type family (Undercase Type, open-source)
- Inter Tight (Rasmus Andersson, Google Fonts)
- JetBrains Mono (JetBrains, open-source)
- GT Alpina + Söhne (Grilli Type, Klim — V2 upgrade path)

Color references:
- Tailwind CSS v4 color system structure
- Material Design 3 tonal palette structure
- Apple Human Interface Guidelines (warm-neutral mode)

Accessibility validation:
- WCAG 2.2 AA contrast requirements (validated on primary text/bg combinations)
- APCA contrast (supplementary check for warm-on-warm combinations)

Codebase context:
- `/Users/vaibhav/testofgithubrepo/axon/src/app/globals.css` (existing token foundation)
- `/Users/vaibhav/testofgithubrepo/ODESA_SPEC.md` (product spec)
- `/Users/vaibhav/testofgithubrepo/odesa_product_architecture.md` (technical architecture)
