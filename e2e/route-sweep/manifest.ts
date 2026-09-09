/**
 * Route-sweep manifest — the single source of truth for "every route the
 * app exposes" and how to exercise it. `scripts/check-route-manifest.mjs`
 * fails CI if a `src/app/**\/page.tsx` route is missing here, so this list
 * stays in lockstep with the app.
 *
 * `path` is the concrete URL with params already resolved to canonical seed
 * UUIDs (mirror of e2e/fixtures/manifest.ts / supabase/seed.sql); `pattern` is
 * the app-router route pattern the checker diffs. Detail routes now pin real
 * seeded UUIDs (property/unit/tenant/vendor/work-order/call), not mock slugs.
 *
 * Categories drive acceptance (see build-sweep-report.mjs):
 *   - customer-data: must render real Supabase data, demo-string-clean
 *   - static / dev / key-backed: render + console checks only
 */

import {
  OAKWOOD_PROPERTY_ID,
} from '../properties/helpers';

export type RouteCategory = 'customer-data' | 'static' | 'dev' | 'key-backed';
export type DataSource = 'mock' | 'mixed' | 'real' | 'static';

export interface RouteCase {
  /** Concrete URL to visit (params already resolved). */
  path: string;
  /** App-router route pattern (with [param] placeholders) — used by the manifest checker. */
  pattern: string;
  category: RouteCategory;
  dataSource: DataSource;
  needsAuth: boolean;
  needsSupabase: boolean;
  /** Preferred root selector. Falls back to `dashboard-main` when absent. */
  rootTestId?: string;
  /** Text/CSS fallback when no testid fits (public pages). */
  rootFallback?: string;
  /** True when a dedicated spec already covers this route. */
  hasExistingSpec: boolean;
  /**
   * Lenient routes assert only "no 5xx + rendered something" — used for
   * routes whose access or status is environment-dependent: admin (role-
   * gated), embed (needs a minted key), dev (404s in a prod build), and
   * onboarding (redirects for an already-onboarded org).
   */
  lenient?: boolean;
}

const OAK = OAKWOOD_PROPERTY_ID;

export const ROUTE_MANIFEST: RouteCase[] = [
  // ---- static / public ----
  { path: '/', pattern: '/', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: 'text=/Odesa/i', hasExistingSpec: true },
  { path: '/work', pattern: '/work', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: '.ng-site', hasExistingSpec: true },
  { path: '/method', pattern: '/method', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: '.ng-site', hasExistingSpec: true },
  { path: '/demo', pattern: '/demo', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: '.ng-site', hasExistingSpec: true },
  { path: '/owners', pattern: '/owners', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: '.ng-site', hasExistingSpec: true },
  { path: '/pilot', pattern: '/pilot', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootFallback: '.ng-site', hasExistingSpec: true },
  { path: '/login', pattern: '/login', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootTestId: 'login-form', hasExistingSpec: true },
  { path: '/signup', pattern: '/signup', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootTestId: 'signup-form', hasExistingSpec: true },
  // tenant portal (public login + session pages)
  { path: '/portal/login', pattern: '/portal/login', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootTestId: 'portal-login-page', hasExistingSpec: true },
  { path: '/portal/payment-success', pattern: '/portal/payment-success', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootTestId: 'portal-payment-success-page', hasExistingSpec: true },
  { path: '/portal/payment-cancel', pattern: '/portal/payment-cancel', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: false, rootTestId: 'portal-payment-cancel-page', hasExistingSpec: true },
  // Session pages are lenient: the sweep runner holds a STAFF session, which
  // correctly bounces to /portal/login. Real assertions live in e2e/portal/.
  { path: '/portal', pattern: '/portal', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'portal-home-page', hasExistingSpec: true, lenient: true },
  { path: '/portal/payments', pattern: '/portal/payments', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'portal-payments-page', hasExistingSpec: true, lenient: true },
  { path: '/portal/lease', pattern: '/portal/lease', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'portal-lease-page', hasExistingSpec: true, lenient: true },
  { path: '/portal/messages', pattern: '/portal/messages', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'portal-messages-page', hasExistingSpec: true, lenient: true },
  { path: '/portal/maintenance', pattern: '/portal/maintenance', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'portal-maintenance-page', hasExistingSpec: true, lenient: true },
  { path: '/invite/route-sweep-invalid-token', pattern: '/invite/[token]', category: 'static', dataSource: 'static', needsAuth: false, needsSupabase: true, rootTestId: 'invite-claim-page', hasExistingSpec: false },

  // ---- operator surface (customer-data, auth + Supabase) ----
  { path: '/today', pattern: '/today', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'today-page', hasExistingSpec: true },
  { path: '/inbox', pattern: '/inbox', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'inbox-page', hasExistingSpec: true },
  { path: '/assistant', pattern: '/assistant', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'assistant-page', hasExistingSpec: true },
  { path: '/owner-queue', pattern: '/owner-queue', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'owner-queue-page', hasExistingSpec: true },
  { path: '/escalations', pattern: '/escalations', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'va-escalations-desk', hasExistingSpec: false },
  // voice operator call log (+ seeded demo call, see supabase/seed.sql)
  { path: '/calls', pattern: '/calls', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'calls-page', hasExistingSpec: false },
  { path: '/calls/settings', pattern: '/calls/settings', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'calls-settings-page', hasExistingSpec: false },
  { path: '/calls/scripts', pattern: '/calls/scripts', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'calls-scripts-page', hasExistingSpec: false },
  { path: '/calls/test', pattern: '/calls/test', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'calls-test-page', hasExistingSpec: false },
  { path: '/calls/99999999-9999-9999-9999-999999999901', pattern: '/calls/[id]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'call-detail-page', hasExistingSpec: false },

  // properties list + brief (brief still mock-slug)
  { path: '/properties', pattern: '/properties', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'properties-page', hasExistingSpec: true },
  { path: `/properties/${OAK}`, pattern: '/properties/[id]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'property-detail-page', hasExistingSpec: true },

  // property subroutes — units|appliances|vendors|maintenance|payments|rulebook
  // are no longer routes: they fold into the interior overview as `?room=<key>`
  // drawers (see e2e/properties/room-drawers.spec.ts). Only the unit-brief page
  // and chat remain real sub-routes.
  { path: `/properties/${OAK}/units/44444444-4444-4444-4444-444444444401`, pattern: '/properties/[id]/units/[unitId]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'unit-detail-page', hasExistingSpec: true },
  { path: `/properties/${OAK}/chat`, pattern: '/properties/[id]/chat', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'property-chat-back', hasExistingSpec: true },

  // tenants / vendors (directories real-ish; detail still mock-slug)
  { path: '/tenants', pattern: '/tenants', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'tenants-page', hasExistingSpec: true },
  { path: '/tenants/55555555-5555-5555-5555-555555555501', pattern: '/tenants/[tenantId]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'tenant-detail-page', hasExistingSpec: true },
  { path: '/vendors', pattern: '/vendors', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'vendors-page', hasExistingSpec: true },
  { path: '/vendors/88888888-8888-8888-8888-888888888801', pattern: '/vendors/[vendorId]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'vendor-detail-page', hasExistingSpec: true },

  // ledger / lists
  { path: '/rent', pattern: '/rent', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'rent-page', hasExistingSpec: true },
  { path: '/financials', pattern: '/financials', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'financial-command-center', hasExistingSpec: true },
  { path: '/documents', pattern: '/documents', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'documents-page', hasExistingSpec: true },
  { path: '/open-items', pattern: '/open-items', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'open-items-page', hasExistingSpec: true },
  { path: '/work-orders/77777777-7777-7777-7777-777777777701', pattern: '/work-orders/[woId]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'work-order-page', hasExistingSpec: true },

  // owner review surface — keyed on the seeded emergency work order
  { path: '/review/work_order/77777777-7777-7777-7777-777777777701', pattern: '/review/[kind]/[id]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'review-page', hasExistingSpec: true },

  // settings
  { path: '/settings', pattern: '/settings', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'settings-page', hasExistingSpec: true },
  { path: '/settings/import', pattern: '/settings/import', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'import-page', hasExistingSpec: false },
  { path: '/settings/integrations', pattern: '/settings/integrations', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'integrations-page', hasExistingSpec: true },

  // onboarding (lenient — index redirects for an onboarded org; steps are forms)
  { path: '/onboarding', pattern: '/onboarding', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/property', pattern: '/onboarding/property', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/unit', pattern: '/onboarding/unit', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/tenant', pattern: '/onboarding/tenant', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/lease', pattern: '/onboarding/lease', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: false, lenient: true },
  { path: '/onboarding/messaging', pattern: '/onboarding/messaging', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/verify-phone', pattern: '/onboarding/verify-phone', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },
  { path: '/onboarding/voice', pattern: '/onboarding/voice', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'dashboard-main', hasExistingSpec: true, lenient: true },

  // admin (role-gated — lenient: the seeded test owner is not in ADMIN_EMAILS)
  { path: '/admin/numbers', pattern: '/admin/numbers', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'admin-numbers-page', hasExistingSpec: false, lenient: true },

  // dev (404s in a production build by design)
  { path: '/dev/chart-preview', pattern: '/dev/chart-preview', category: 'dev', dataSource: 'static', needsAuth: false, needsSupabase: false, hasExistingSpec: false, lenient: true },

  // key-backed embed widget (needs a minted api key — lenient until Phase 2)
  { path: '/embed/route-sweep-probe', pattern: '/embed/[apiKey]', category: 'key-backed', dataSource: 'real', needsAuth: false, needsSupabase: false, hasExistingSpec: false, lenient: true },
];

/** Convenience splits used by the spec. */
export const PUBLIC_ROUTES = ROUTE_MANIFEST.filter((r) => !r.needsAuth);
export const AUTHED_ROUTES = ROUTE_MANIFEST.filter((r) => r.needsAuth);
