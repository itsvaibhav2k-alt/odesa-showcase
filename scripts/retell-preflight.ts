/**
 * Retell sandbox PREFLIGHT gate — "no preflight, no call".
 *
 * Prints a REDACTED PASS/FAIL matrix proving the LOCAL sandbox is safe to
 * point a real Retell agent at, and exits NON-ZERO if ANY row FAILs. This is
 * a gate, not a diagnostic: a single red row blocks the call.
 *
 * SECRET & PII HYGIENE (part of the spec): this script NEVER prints env
 * values, the RETELL_API_KEY, Authorization / x-retell-* headers, DB
 * connection strings, or full phone numbers. Phones are redacted to last-4,
 * DB vars are printed as name + local/cloud classification only, and a final
 * self-check (`no_secret_logging`) scans this script's own output for leaks.
 *
 * Usage:
 *   npx tsx scripts/retell-preflight.ts \
 *     --base http://localhost:3211 --tunnel https://xxx.ngrok.io --cell +1...
 *
 * All args optional; missing inputs FAIL their row (fail-closed) rather than
 * silently passing. Load env the same way the server does, e.g.
 *   npx tsx --env-file=.env.local scripts/retell-preflight.ts ...
 */

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { resolveCaller } from '@/lib/voice/resolve-caller';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Explicit environment routing; publication examples must never pass preflight. */
const ROUTED_NUMBER = process.env.RETELL_ROUTED_NUMBER ?? '';
const CLOUD_REF = 'utuzgcgfuzxmpvqgqdvl';
const PLACEHOLDER_RETELL_KEY = 'retell-dev-test-key';
const DEFAULT_BASE = 'http://localhost:3211';
const HTTP_TIMEOUT_MS = 4000;

/** DB / Supabase connection vars we classify as local-vs-cloud. */
const DB_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'DIRECT_URL',
] as const;

/**
 * Un-mocked outbound channels the agent paths could reach. SMS (linq/twilio)
 * is neutralised by the messaging mock; these would each be a REAL egress if
 * configured, so their presence FAILs `no_real_email_or_owner_notify`.
 */
const OTHER_OUTBOUND_ENV = [
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'POSTMARK_API_TOKEN',
  'POSTMARK_SERVER_TOKEN',
  'MAILGUN_API_KEY',
  'SMTP_URL',
  'SMTP_HOST',
  'FCM_SERVER_KEY',
  'EXPO_ACCESS_TOKEN',
  'ONESIGNAL_API_KEY',
  'WEB_PUSH_PRIVATE_KEY',
] as const;

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  /** Informational REPORT row — printed but never gates the exit code. */
  info?: boolean;
}

// ---------------------------------------------------------------------------
// Output buffer (every printed line lands here for the self-check scan)
// ---------------------------------------------------------------------------

const output: string[] = [];
function emit(line: string): void {
  output.push(line);
  // eslint-disable-next-line no-console
  console.log(line);
}

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/** Redact any phone-ish string to `***<last4>`; empty/short → `***`. */
function redactPhone(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { base: string; tunnel?: string; cell?: string } {
  let base = process.env.PREFLIGHT_BASE_URL ?? DEFAULT_BASE;
  let tunnel: string | undefined;
  let cell: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === '--base' && next) {
      base = next;
      i += 1;
    } else if (argv[i] === '--tunnel' && next) {
      tunnel = next;
      i += 1;
    } else if (argv[i] === '--cell' && next) {
      cell = next;
      i += 1;
    }
  }
  return { base, tunnel, cell };
}

// ---------------------------------------------------------------------------
// HTTP helper (short timeout so a down server FAILs fast, never hangs)
// ---------------------------------------------------------------------------

async function http(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function classifyDbVar(value: string): 'local' | 'cloud' {
  if (value.includes(CLOUD_REF)) return 'cloud';
  let host = '';
  try {
    host = new URL(value).hostname;
  } catch {
    const m = value.match(/@([^/:?]+)/);
    host = m ? m[1] : '';
  }
  if (host === '127.0.0.1' || host === 'localhost' || host.endsWith('.localhost')) {
    return 'local';
  }
  return 'cloud';
}

function checkLocalDbEnv(): CheckResult {
  const present = DB_VARS.filter((v) => (process.env[v] ?? '').length > 0);
  // NEXT_PUBLIC_SUPABASE_URL is the DB the sandbox server actually reads; if it
  // is absent nothing is verified local, so fail closed instead of reading green.
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()) {
    return {
      name: 'local_db_env',
      pass: false,
      detail: 'NEXT_PUBLIC_SUPABASE_URL not set — cannot confirm local DB (fail closed)',
    };
  }
  const parts: string[] = [];
  let anyCloud = false;
  for (const v of present) {
    const klass = classifyDbVar(process.env[v]!);
    if (klass === 'cloud') anyCloud = true;
    parts.push(`${v}=${klass}`); // name + classification only, NEVER the value
  }
  return { name: 'local_db_env', pass: !anyCloud, detail: parts.join(', ') };
}

async function checkNoRealSms(base: string): Promise<CheckResult> {
  const name = 'no_real_sms';
  const url = `${base}/api/messaging/test-hooks`;
  try {
    // Install the process-global messaging mock so every provider send()
    // short-circuits into recordMockSend (recorded, not transmitted).
    const installRes = await http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'install' }),
    });
    if (installRes.status !== 200) {
      return { name, pass: false, detail: `install returned HTTP ${installRes.status} (mock unavailable)` };
    }
    // Confirm the mock is actually installed on the server process AND that a
    // recording sink exists — the guarantee that any send is recorded, not
    // transmitted. (No public "trigger send" hook exists without driving the
    // full inbound agent loop; installed + sink present is the correct probe.)
    // ponytail: recorded-count assertion needs an inbound trigger to move; the
    // sink's presence + short-circuit path is what makes a live SMS impossible.
    const getRes = await http(url, { method: 'GET' });
    let installed = false;
    let hasSink = false;
    try {
      const parsed = JSON.parse(getRes.body) as {
        data?: { installed?: boolean; recorded?: unknown };
      };
      installed = parsed.data?.installed === true;
      hasSink = Array.isArray(parsed.data?.recorded);
    } catch {
      /* fall through to FAIL below */
    }
    if (getRes.status !== 200 || !installed || !hasSink) {
      return { name, pass: false, detail: 'mock not confirmed installed on server' };
    }
    return { name, pass: true, detail: 'messaging mock installed; sends recorded not transmitted' };
  } catch {
    // Server down / unreachable — cannot prove the mock is on. FAIL closed.
    return { name, pass: false, detail: 'test-hooks unreachable (server down?) — fail closed' };
  }
}

function checkNoRealEmailOrOwnerNotify(smsMocked: boolean): CheckResult {
  const name = 'no_real_email_or_owner_notify';
  // Owner + tenant notifications route through sendWithFailover → linq/twilio,
  // i.e. the SAME mocked SMS path. Any OTHER outbound sender env is a real,
  // un-mocked egress the agent could reach → FAIL. Conservative: uncertain=FAIL.
  const configured = OTHER_OUTBOUND_ENV.filter((v) => (process.env[v] ?? '').length > 0);
  if (!smsMocked) {
    return { name, pass: false, detail: 'SMS not mocked (see no_real_sms) — cannot clear outbound' };
  }
  if (configured.length > 0) {
    return { name, pass: false, detail: `un-mocked outbound sender(s) configured: ${configured.join(', ')}` };
  }
  return { name, pass: true, detail: 'SMS mocked; no email/push/vendor sender configured' };
}

async function checkRetellAuthFailClosed(base: string): Promise<CheckResult> {
  const name = 'retell_auth_fail_closed';
  const url = `${base}/api/retell/webhook`;
  const fails: string[] = [];

  // 1) Unsigned request must 401.
  try {
    const unsigned = await http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (unsigned.status !== 401) fails.push(`unsigned=${unsigned.status}!=401`);
  } catch {
    fails.push('unsigned request unreachable');
  }

  // 2) Bad-signature request must 401.
  try {
    const badSig = await http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-retell-signature': 'v=1,t=1,invalid' },
      body: '{}',
    });
    if (badSig.status !== 401) fails.push(`bad-sig=${badSig.status}!=401`);
  } catch {
    fails.push('bad-sig request unreachable');
  }

  // 3) Enforcement flag must be true-ish.
  const reqSig = process.env.RETELL_REQUIRE_SIGNATURE;
  if (reqSig !== '1' && reqSig !== 'true') fails.push('RETELL_REQUIRE_SIGNATURE not enforced');

  // 4) Real key present and not the placeholder (value never printed).
  const key = process.env.RETELL_API_KEY ?? '';
  if (key.length === 0) fails.push('RETELL_API_KEY missing');
  else if (key === PLACEHOLDER_RETELL_KEY) fails.push('RETELL_API_KEY is placeholder');

  return fails.length === 0
    ? { name, pass: true, detail: 'unsigned+bad-sig → 401; enforcement on; real key present' }
    : { name, pass: false, detail: fails.join('; ') };
}

/**
 * The Retell SMS inbound route must fail closed exactly like the voice
 * webhook: an unsigned POST to /api/messaging/inbound/retell is 401, always —
 * the route exists regardless of SMS env, so this is a hard gate.
 */
async function checkSmsAuthFailClosed(base: string): Promise<CheckResult> {
  const name = 'sms_auth_fail_closed';
  try {
    const unsigned = await http(`${base}/api/messaging/inbound/retell`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return unsigned.status === 401
      ? { name, pass: true, detail: 'unsigned → 401 (fail closed)' }
      : { name, pass: false, detail: `unsigned=${unsigned.status}!=401` };
  } catch {
    return { name, pass: false, detail: 'sms inbound route unreachable — fail closed' };
  }
}

/**
 * SMS env presence REPORT — informational only. SMS simply not being
 * configured is a valid voice-only deployment, so this row never FAILs the
 * gate; it just states which SMS vars are set (names only, never values).
 */
function reportSmsEnv(): CheckResult {
  const vars = ['RETELL_SMS_AGENT_ID', 'RETELL_SMS_DISPATCH_AGENT_ID', 'RETELL_SMS_A2P_APPROVED'];
  const parts = vars.map((v) => `${v}=${(process.env[v] ?? '').trim() ? 'set' : 'unset'}`);
  return { name: 'sms_env_report', pass: true, info: true, detail: parts.join(', ') };
}

async function checkCallerResolution(cell: string | undefined): Promise<CheckResult> {
  const name = 'caller_resolution';
  if (!cell) {
    return { name, pass: false, detail: 'no --cell provided' };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceKey) {
    return { name, pass: false, detail: 'service-role env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' };
  }

  const db = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cellRedacted = redactPhone(cell);
  // Random unassigned area-code number that cannot match a seeded tenant.
  const randomE164 = `+1999${String(Math.floor(1e6 + Math.random() * 9e6))}`;

  try {
    // The routed org must exist (proves odesa_phone_number === ROUTED_NUMBER).
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id')
      .eq('odesa_phone_number', ROUTED_NUMBER)
      .maybeSingle();
    if (orgErr) return { name, pass: false, detail: 'org lookup db error' };
    if (!org) return { name, pass: false, detail: `no org routes ${redactPhone(ROUTED_NUMBER)}` };

    const known = await resolveCaller(db, cell, ROUTED_NUMBER);
    const unknown = await resolveCaller(db, randomE164, ROUTED_NUMBER);
    const knownKind = known?.callerKind ?? 'null';
    const unknownKind = unknown?.callerKind ?? 'null';

    const pass = knownKind === 'verified_tenant' && unknownKind === 'unknown_caller';
    const detail =
      `cell ${cellRedacted}→${knownKind}, random ${redactPhone(randomE164)}→${unknownKind}` +
      `, org routes ${redactPhone(ROUTED_NUMBER)}`;
    return { name, pass, detail };
  } catch {
    return { name, pass: false, detail: 'resolveCaller threw (db unreachable?) — fail closed' };
  }
}

async function checkTunnelCurrent(tunnel: string | undefined): Promise<CheckResult> {
  const name = 'tunnel_current';
  if (!tunnel) {
    return { name, pass: false, detail: 'no --tunnel provided' };
  }
  try {
    const res = await http(tunnel, { method: 'GET' });
    if (res.status !== 200) {
      return { name, pass: false, detail: `tunnel GET → HTTP ${res.status} (expected 200)` };
    }
    // TODO(retell-readback): compare this tunnel against the Retell phone
    // number's configured webhook_url via the Retell API — deferred, that
    // readback is RETELL_API_KEY-dependent (no live API calls in this phase).
    return { name, pass: true, detail: 'tunnel reaches local server (200); phone-readback TODO' };
  } catch {
    return { name, pass: false, detail: 'tunnel unreachable — fail closed' };
  }
}

function checkNoSecretLogging(): CheckResult {
  const name = 'no_secret_logging';
  const haystack = output.join('\n');
  const leaks: string[] = [];

  // Explicit env values that must never appear verbatim in output.
  const secretVars = [
    'RETELL_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'LINQ_API_KEY_ID',
    'LINQ_API_SECRET_KEY',
    'LINQ_WEBHOOK_SECRET',
    'ANTHROPIC_API_KEY',
    'TWILIO_AUTH_TOKEN',
  ];
  for (const v of secretVars) {
    const val = process.env[v];
    if (val && val.length >= 6 && haystack.includes(val)) leaks.push(`env:${v}`);
  }

  // Structural leaks: un-redacted E.164 phone, Authorization/bearer, retell sig.
  if (/\+\d{7,}/.test(haystack)) leaks.push('phone');
  if (/bearer\s+\S/i.test(haystack)) leaks.push('bearer-token');
  if (/x-retell-signature:\s*\S/i.test(haystack)) leaks.push('retell-signature');

  return leaks.length === 0
    ? { name, pass: true, detail: 'no secrets/PII in output' }
    : { name, pass: false, detail: `LEAK: ${leaks.join(', ')}` };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!/^\+1[2-9]\d{9}$/.test(ROUTED_NUMBER) || /^\+1\d{3}55501\d{2}$/.test(ROUTED_NUMBER)) {
    throw new Error('Set RETELL_ROUTED_NUMBER to your provisioned US number; fictional examples are not allowed.');
  }
  const { base, tunnel, cell } = parseArgs(process.argv.slice(2));

  emit('Retell sandbox PREFLIGHT — no preflight, no call');
  emit(`base:   ${base}`);
  emit(`tunnel: ${tunnel ?? '(none)'}`);
  emit(`cell:   ${cell ? redactPhone(cell) : '(none)'}`);
  emit('');

  const results: CheckResult[] = [];
  results.push(checkLocalDbEnv());
  const sms = await checkNoRealSms(base);
  results.push(sms);
  results.push(checkNoRealEmailOrOwnerNotify(sms.pass));
  results.push(await checkRetellAuthFailClosed(base));
  results.push(await checkSmsAuthFailClosed(base));
  results.push(reportSmsEnv());
  results.push(await checkCallerResolution(cell));
  results.push(await checkTunnelCurrent(tunnel));

  const width = Math.max(...results.map((r) => r.name.length), 'no_secret_logging'.length);
  for (const r of results) {
    emit(`  [${r.info ? 'INFO' : r.pass ? 'PASS' : 'FAIL'}] ${r.name.padEnd(width)}  ${r.detail}`);
  }

  // Self-check runs LAST so it scans every row printed above.
  const selfCheck = checkNoSecretLogging();
  results.push(selfCheck);
  emit(`  [${selfCheck.pass ? 'PASS' : 'FAIL'}] ${selfCheck.name.padEnd(width)}  ${selfCheck.detail}`);

  const passed = results.filter((r) => r.pass).length;
  const allPass = passed === results.length;
  emit('');
  emit(`RESULT: ${allPass ? 'PASS' : 'FAIL'} (${passed}/${results.length} passed)`);

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  emit(`RESULT: FAIL (preflight crashed: ${message})`);
  process.exit(1);
});
