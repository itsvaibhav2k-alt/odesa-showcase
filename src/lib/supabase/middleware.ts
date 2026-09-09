import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  // Forward the current pathname through a request header so server
  // layouts can read it via `next/headers`. Next.js 16 does not surface
  // the active path to layouts otherwise.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Tenant portal — handled BEFORE any Supabase logic. Portal identity is
  // the HMAC-signed `odesa_portal` cookie (src/lib/portal/session.ts —
  // constant kept literal here so the edge bundle never imports
  // node:crypto), never a Supabase session: a staff login must not grant
  // /portal, and the portal cookie (path=/portal) never reaches staff
  // routes. Cookie *presence* gates here; real HMAC verify + tenant
  // revalidation happen server-side in requirePortalSession().
  if (request.nextUrl.pathname.startsWith("/portal")) {
    const publicPortalRoutes = [
      "/portal/login",
      "/portal/payment-success",
      "/portal/payment-cancel",
    ];
    const isPublicPortalRoute = publicPortalRoutes.some((route) =>
      request.nextUrl.pathname.startsWith(route),
    );
    if (!isPublicPortalRoute && !request.cookies.get("odesa_portal")) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/login";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const earlyPathname = request.nextUrl.pathname;
  const earlyPublicRoutes = [
    "/login",
    "/signup",
    "/invite/",
    "/auth/callback",
    "/landing.html",
    "/night-garden/",
    "/api/webhooks",
    "/api/inngest",
    "/api/messaging/inbound",
    "/api/messaging/delivery",
    "/api/messaging/test-hooks",
    "/api/retell",
    "/api/waitlist",
    "/api/healthz",
    "/api/agent/test-hooks",
    "/api/agent/trust/recompute",
    "/api/agent/worker/spawn",
    "/api/agent/reflection/run",
    "/api/agent/synthesis/run",
    "/api/agent/meta-learning/run",
    "/api/agent/privacy/health-check",
    "/api/briefing/run",
    "/dev/",
  ];
  const earlyPublicMarketingRoutes = new Set([
    "/work",
    "/method",
    "/demo",
    "/owners",
    "/pilot",
  ]);
  const earlyPublic =
    earlyPathname === "/" ||
    earlyPathname.startsWith("/_next") ||
    earlyPathname.startsWith("/favicon.ico") ||
    earlyPublicMarketingRoutes.has(earlyPathname) ||
    earlyPublicRoutes.some((route) => earlyPathname.startsWith(route));

  // Missing auth configuration must never turn a protected route public.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    if (earlyPublic) return supabaseResponse;
    return NextResponse.json(
      { error: "Authentication service unavailable" },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh the session - use getUser() not getSession() for security
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes that don't require cookie-bound auth. Inbound webhooks
  // (Sendblue/Twilio/Stripe), Retell phone-agent tool callbacks, and
  // Inngest event endpoints all use their own signature verification on
  // the request body — gating them on user cookies would 307 them to
  // /login and silently drop real traffic.
  const publicRoutes = [
    "/login",
    "/signup",
    // Invitation details remain opaque and claims still require an authenticated,
    // exact verified-email session. The page itself must be reachable so a new
    // invitee can choose sign in or account creation.
    "/invite/",
    // PKCE code exchange — the visitor is by definition not yet
    // authenticated when arriving here from Google / confirmation links.
    "/auth/callback",
    "/landing.html",
    "/night-garden/",
    "/api/webhooks",
    "/api/inngest",
    "/api/messaging/inbound",
    "/api/messaging/delivery",
    "/api/messaging/test-hooks",
    "/api/retell",
    "/api/waitlist",
    "/api/healthz",
    // Dev/test-only endpoints (each handler self-gates on
    // NODE_ENV !== 'production' and returns 404 in real deploys).
    "/api/agent/test-hooks",
    "/api/agent/trust/recompute",
    "/api/agent/worker/spawn",
    "/api/agent/reflection/run",
    "/api/agent/synthesis/run",
    "/api/agent/meta-learning/run",
    "/api/agent/privacy/health-check",
    "/api/briefing/run",
    // Dev-only UI previews (page self-gates via NODE_ENV).
    "/dev/",
  ];
  const publicMarketingRoutes = new Set([
    "/work",
    "/method",
    "/demo",
    "/owners",
    "/pilot",
  ]);
  const isPublicRoute =
    publicMarketingRoutes.has(pathname) ||
    publicRoutes.some((route) => pathname.startsWith(route));

  // An authenticated Accountant is projection-only. Deny every hidden API
  // before broad webhook/tool prefixes (notably `/api/retell`) can make a
  // provider or mutation endpoint appear public to a cookie-bound browser.
  // Signature-only provider calls have no Odesa user session and continue to
  // the handlers unchanged.
  const isServerAction = request.headers.has('next-action');
  if (user && (pathname.startsWith('/api/') || isServerAction)) {
    const { data: role, error: roleError } = await supabase.rpc(
      'current_user_role',
    );
    if (
      (role === 'accountant' &&
        (isServerAction || pathname !== '/api/accounting/export')) ||
      ((roleError || role === null) &&
        !isPublicRoute &&
        !(isServerAction && pathname.startsWith('/invite/')))
    ) {
      return NextResponse.json(
        { error: 'Forbidden' },
        {
          status: 403,
          headers: {
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        },
      );
    }
  }

  // Allow public assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/"
  ) {
    return supabaseResponse;
  }

  // Dev-only auth bypass: opt-in via SKIP_AUTH_IN_DEV=1 so a missing
  // session doesn't silently mask real auth bugs during local work.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.SKIP_AUTH_IN_DEV === "1" &&
    !user
  ) {
    return supabaseResponse;
  }

  // Redirect unauthenticated users to login (production)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages into the app
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    // Root resolves the exact role/capability-aware landing server-side.
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
