# Odesa Tenant Portal — UAE resident-app reference hunt

Date: 2026-08-06

## Hunt target

A premium, mobile-native resident companion for small-landlord tenants. It should feel home-specific, reassuring, service-oriented, and materially useful without becoming a property-developer sales app. Preserve Odesa's warm paper identity and verified tenant security boundaries. Avoid copying DAMAC, Emaar, or Sobha branding, assets, exact layouts, marketing copy, or sales funnels.

## Live sources inspected

### DAMAC Living

Official App Store: https://apps.apple.com/ae/app/damac-living/id1446489552

Evidence board: `qa-output/2026-08-06-tenant-uae-reference-hunt/references/damac-board.png`

Screens inspected:
- Property home with photographic property selector, current handover step, What's New, and five-tab navigation
- Digital handover task form
- Amenity booking history

Use for:
- Put the resident's property identity at the top
- Give current obligations/status a visible continuation state
- Treat resident services as first-class destinations
- Show past/upcoming service records as compact status-rich rows

Avoid:
- Developer promotions and sales content
- Gold-on-black branding
- Tiny gray labels and overloaded forms

### Emaar One

Official App Store: https://apps.apple.com/ae/app/emaar-one/id1445056033

Evidence board: `qa-output/2026-08-06-tenant-uae-reference-hunt/references/emaar-board.png`

Screens inspected:
- Home with selected property, What's New, Requests, quick services, and five-tab navigation
- Property detail with strong image/context header and structured facts
- Payments with selected property, account-balance categories, pay-now actions, upcoming and invoice history

Use for:
- A selected-home header that anchors every task
- One-glance property facts
- Payment summary before payment history
- Quick actions for common resident jobs
- Stable five-tab app architecture

Avoid:
- Generic blue corporate shell
- Overloaded icon trays
- Promotions competing with operational resident needs

### ONE | Sobha

Official App Store: https://apps.apple.com/ae/app/one-sobha-property-community/id6453471270

Evidence board: `qa-output/2026-08-06-tenant-uae-reference-hunt/references/sobha-board.png`

Screens inspected:
- Luxury-living branded home/property imagery
- Map-based property discovery
- Buying-journey detail with relationship manager, milestone progress, payments, schedule, and statements

Use for:
- Calm editorial typography and generous but purposeful spacing
- A journey/status model with explicit stages
- Contextual contact/support access
- A clear primary action inside a structured account view

Avoid:
- Purchase/sales journey concepts irrelevant to tenants
- Map and development-discovery features with no Odesa data
- Decorative luxury cues that displace the tenant's real work

## Extracted principles

1. **Home before account:** lead with the resident's actual address/unit and current home state, not only “Hi, Marcus.”
2. **One dominant obligation:** rent standing, amount, due date, and next action form the primary surface.
3. **Services within one thumb:** Pay, report an issue, view lease, and text the property team are immediate actions on Home.
4. **Status-rich records:** maintenance and payments need compact rows with date, amount/category, status, and next implication.
5. **Five stable destinations:** Home, Payments, Maintenance, Messages, and Lease should all be directly discoverable.
6. **Premium through restraint:** warm color fields, precise typography, thin borders, controlled radius, and one accent—not glass, gradients, or generic bento cards.
7. **Progressive detail:** Home summarizes; destination screens provide complete facts/history.
8. **Real data only:** no amenity bookings, concierge, community events, manager avatars, progress percentages, property imagery, or service promises unless backed by Odesa data.
9. **Mobile first, not mobile only:** retain a focused phone canvas while making wider browser review feel intentional through a subtle surrounding stage and app-like frame.

## Chosen direction: The Resident Keyring

A warm, premium resident companion organized around one home and four recurring jobs: understand rent, pay, report/track maintenance, and communicate. The visual identity is Odesa—not a UAE developer clone.

### Information architecture

Bottom navigation:
1. Home
2. Payments
3. Maintenance
4. Messages
5. Lease

Home:
- Compact Odesa masthead and selected-home identity
- Rent-standing hero with amount/due/paid state and one primary CTA
- Four immediate resident actions
- Active maintenance status or honest no-active-request state
- Recent account activity derived only from existing payments/work orders/messages
- Lease/home summary with direct link

Payments:
- Current account status summary
- Pay action only when balance exists
- Payment history as one ruled account ledger with receipt affordances
- Honest recorded-vs-online provenance

Maintenance:
- Active/past request ledger with consumer status and urgency
- Better coherence between emergency/urgent state and visual prominence
- Report-an-issue form retained and fully functional

Messages:
- Clean resident/property conversation
- Stronger thread chronology and readable timestamps
- Sticky SMS handoff retained because V1 replies use the normal SMS rail

Lease:
- Selected-home header
- Key monthly terms and lease period grouped by resident meaning
- Document action when available

Login and return pages:
- Same resident-app shell and premium hierarchy
- No staff-product visual leakage

### Visual language

- Odesa warm cream canvas with a subtle dark/navy home-identity field and terracotta action color
- Instrument Serif for the Odesa wordmark and rare display moments; IBM Plex Sans for resident copy; IBM Plex Mono only for dates/labels when useful
- 16–20px body/action typography; no low-contrast 11px operational metadata
- 12–18px radii, thin warm borders, minimal shadows
- Purposeful section rhythm; no giant empty beige field
- Touch targets at least 44px
- Responsive centered app stage: excellent at 390×844 and intentional up to tablet/desktop review widths

### Motion

- No scroll-jacking, parallax, or staged content delays
- Optional control transitions under 180ms
- Respect `prefers-reduced-motion`

## Acceptance criteria

- Marcus Alvarez's seeded Home visibly reflects Oakwood Commons Unit 101 and coherent rent/service/message context.
- Every destination is reachable directly from the five-item bottom bar.
- All current portal security/query boundaries remain unchanged or stronger.
- No fabricated amenities, community events, property photos, managers, SLAs, or payment timestamps.
- Existing login, pay, maintenance-write, privacy, session-isolation, accessibility, and route tests remain green.
- Portal-focused unit tests, TypeScript, touched-file lint, and production build pass.
- Full portal Playwright suite passes against loopback local Supabase.
- New mobile screenshots for login, home owing/paid, payments, lease, maintenance, and messages are reviewed visually.
- Marcus's authenticated visible browser is refreshed to the redesigned portal and left running.
