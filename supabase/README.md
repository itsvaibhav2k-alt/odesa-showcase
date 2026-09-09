# Odesa Supabase

Schema + seed + Row Level Security policies for Odesa v1.

## Layout

```
supabase/
  config.toml                              # Local Supabase CLI config
  migrations/
    20260421000000_odesa_initial.sql       # 12 tables + enums + v_org_pulse_kpis view
    20260421000001_rls.sql                 # RLS policies + post-signup trigger
  seed.sql                                 # Galaxy Estates fixture (dev only)
```

The 12 tables mirror spec §6 of
[`docs/superpowers/specs/2026-04-21-odesa-property-operator-design.md`](../docs/superpowers/specs/2026-04-21-odesa-property-operator-design.md):

| Table             | Purpose                                                |
|-------------------|--------------------------------------------------------|
| `organizations`   | Landlord accounts (one per customer)                   |
| `users`           | App users; FK to `auth.users` (`role`: owner/manager/va) |
| `properties`      | Buildings or single-family homes                       |
| `units`           | Units inside a property                                |
| `tenants`         | `(org, phone_e164)` unique — primary caller-ID key     |
| `leases`          | Active/historical; rent amount, due day, policy jsonb  |
| `conversations`   | Inbound thread (voice / sms / imessage)                |
| `messages`        | Per-conversation; `provider` enum and `draft_status`   |
| `work_orders`     | Maintenance state machine                              |
| `vendors`         | Preferred contractors by category                      |
| `rent_events`     | Monthly rent cycle state machine                       |
| `weekly_reports`  | Cached per-org Monday briefings                        |

Plus one view:

- `v_org_pulse_kpis` — occupancy %, rent collected/due this month (cents),
  open work orders count, late tenants count. RLS inherits from the underlying
  tables, so this view is safe to query from the browser client under a user
  session.

## RLS model

- Every table carries `organization_id`.
- The SQL function `public.current_user_org_id()` resolves the caller's org:
  1. First tries the `organization_id` custom JWT claim.
  2. Falls back to `SELECT organization_id FROM users WHERE id = auth.uid()`.
- Every policy gates on `organization_id = public.current_user_org_id()`,
  both `USING` (for read/update/delete) and `WITH CHECK` (for insert/update).
- The `users` table has one extra `SELECT` clause — `id = auth.uid()` — so a
  freshly-authenticated user can bootstrap their own row before any JWT
  claim is populated.

## Post-signup trigger

`public.handle_new_auth_user()` fires `AFTER INSERT ON auth.users`:

1. Reads `raw_user_meta_data->>'organization_name'` (falls back to the
   email local part if missing).
2. Creates an `organizations` row.
3. Creates a `users` row with `role='owner'`, pointing at the
   `auth.users.id`.

Sign the user up with metadata to pick the org name:

```ts
await supabase.auth.signUp({
  email,
  password,
  options: { data: { organization_name: 'Galaxy Estates', full_name: 'Vaibhav' } },
});
```

## Local development

```bash
npx supabase start          # Postgres 15 + Auth + Storage, ports 54321-54323
npx supabase db reset       # Drops + reapplies migrations + runs seed.sql
npx supabase db diff        # Generate a migration from current state
```

Regenerate the TypeScript types after any schema change:

```bash
npx supabase gen types typescript --local > src/types/database.ts
```

`src/types/database.ts` is currently hand-written to match the migrations
exactly (Supabase CLI was not available in the environment where the
initial schema landed). Prefer the CLI command above for all future
regenerations.

## Seed fixture

`seed.sql` is the "Galaxy Estates" shape used by Playwright fixtures:

- 1 organization
- 2 properties (Oakwood Commons, 17th Street Row)
- 10 units, 10 tenants, 10 leases (all active)
- 5 work orders in varied states (open emergency, assigned urgent,
  in_progress routine, completed, cancelled)
- 3 vendors (plumbing, hvac, general)
- 3 `rent_events` per lease (= 30 rows). Eight leases are fully paid; one is
  `late_3`, one is `escalated` to make the Pulse KPIs non-trivial.

All IDs are deterministic (e.g. organization is
`11111111-1111-1111-1111-111111111101`) so Playwright and Vitest specs can
reference them without extra round-trips. Auth users are **not** created by
`seed.sql`; they are provisioned per-test in `e2e/supabase/rls.spec.ts`
via `supabase.auth.admin.createUser()`.

## Tests

`e2e/supabase/rls.spec.ts` is the RLS isolation regression suite: it seeds
two orgs, logs in as each org's owner, and asserts that cross-org reads
return zero rows and cross-org inserts are rejected. The suite auto-skips
when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is not set in the
environment (common on CI for agents that only touch UI).
