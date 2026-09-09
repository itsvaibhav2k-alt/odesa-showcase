#!/usr/bin/env node
/**
 * Seeds realistic `/inbox` conversations + messages for Galaxy Estates so the
 * "Tenant signal desk" renders a believable CURRENT STATE instead of an empty
 * surface (the cloud project ships with ~0 conversations).
 *
 * Mirrors the service-role pattern in `scripts/seed-owner-queue-proposals.mjs`:
 *   - env loaded via `--env-file=.env.local` (with a fallback loader below)
 *   - createClient(SUPABASE_URL, SERVICE_ROLE), autoRefresh/persist off
 *   - idempotent: every row keyed on a deterministic UUID + upsert
 *     ignoreDuplicates, so re-runs never duplicate or overwrite.
 *
 * WHAT IT MODELS (wave-4 inbox = conversation viewer + manual outlet — "with
 * the AI auto-sending almost all replies"):
 *   - 6 conversations on REAL Galaxy tenants where the AI already handled the
 *     reply (`auto_sent` / `sent_by_human`). Several are coherently tied to the
 *     real seeded work orders (water-heater emergency WO #701, HVAC WO #702,
 *     dishwasher WO #703) so the desk reads as one connected operation.
 *   - 1 conversation with a `pending_review` AI draft that drives the
 *     "N need you" count and lets the owner exercise the manual review/send
 *     flow.
 *
 * SAFETY (inbox approval calls `sendWithFailover` — a REAL send):
 *   - Seeding `messages` rows NEVER sends (messages are append-only with no
 *     trigger; sends only happen through app server actions). So historical
 *     `auto_sent` rows on real tenants are pure display data and cannot fire.
 *   - The ONLY row an owner could turn into a real send is the `pending_review`
 *     draft (Approve → send). That draft is attached ONLY to the dedicated demo
 *     tenant with a NON-DELIVERABLE +1555 number, and we re-read that tenant's
 *     phone from the DB and ABORT if it is not in the reserved +1555 range
 *     before inserting the draft. Fail closed.
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/seed-inbox-conversations.mjs
 *   # or: npm run seed:inbox
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadDotEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

if (process.env.ODESA_SKIP_DOTENV_LOCAL !== '1') loadDotEnvLocal();

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Real Galaxy ids (from supabase/seed.sql) — never invented.
// ---------------------------------------------------------------------------

const GALAXY = '11111111-1111-1111-1111-111111111101';

const T_ALVAREZ = '55555555-5555-5555-5555-555555555501'; // Unit 101 (water heater WO #701)
const T_BANERJEE = '55555555-5555-5555-5555-555555555502'; // Unit 102
const T_CHEN = '55555555-5555-5555-5555-555555555503'; // Unit 103
const T_DIALLO = '55555555-5555-5555-5555-555555555504'; // Unit 201 (HVAC WO #702)
const T_ELLIS = '55555555-5555-5555-5555-555555555505'; // Unit 202
const T_FARID = '55555555-5555-5555-5555-555555555506'; // Unit 203 (dishwasher WO #703)

// Dedicated demo tenant (created by seed-owner-queue-proposals.mjs) with a
// NON-DELIVERABLE +1555 number — the ONLY tenant a sendable draft attaches to.
const DEMO_TENANT_REVIEW = 'aaaa2222-0000-4000-8000-000000000001'; // +15550100001

// ---------------------------------------------------------------------------
// Deterministic ids for the rows this script owns (valid v4-shaped UUIDs).
// ---------------------------------------------------------------------------

const CONV = {
  alvarez: 'bbbb0001-0000-4000-8000-000000000001',
  banerjee: 'bbbb0001-0000-4000-8000-000000000002',
  chen: 'bbbb0001-0000-4000-8000-000000000003',
  diallo: 'bbbb0001-0000-4000-8000-000000000004',
  ellis: 'bbbb0001-0000-4000-8000-000000000005',
  farid: 'bbbb0001-0000-4000-8000-000000000006',
  review: 'bbbb0001-0000-4000-8000-000000000007',
};

let msgSeq = 0;
function nextMsgId() {
  msgSeq += 1;
  const hex = msgSeq.toString(16).padStart(12, '0');
  return `bbbb0002-0000-4000-8000-${hex}`;
}

const TEST_PHONE_REGEX = /^\+1555\d{7}$/;

// ---------------------------------------------------------------------------
// Time helpers. (Plain Node Date is fine in a standalone script.) The
// "today" timestamps are clamped to [start-of-day-UTC, now) so the
// activity-strip "handled today" count is reliably non-zero without ever
// landing a message in the future.
// ---------------------------------------------------------------------------

const NOW = Date.now();
const startOfTodayUtc = new Date();
startOfTodayUtc.setUTCHours(0, 0, 0, 0);

function todayAt(hourUtc) {
  const t = startOfTodayUtc.getTime() + hourUtc * 3600_000;
  return new Date(Math.min(t, NOW - 60_000)).toISOString();
}
function hoursAgo(h) {
  return new Date(NOW - h * 3600_000).toISOString();
}
function daysAgo(d) {
  return new Date(NOW - d * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Conversation + message builders
// ---------------------------------------------------------------------------

const conversations = [];
const messages = [];

/**
 * Register a conversation + its messages. `msgs` are given in chronological
 * order; `last_message_at` is taken from the final message. `provider` defaults
 * to the org's channel ('linq').
 */
function thread({ id, tenantId, channel, status, msgs, provider = 'linq' }) {
  const built = msgs.map((m) => ({
    id: nextMsgId(),
    organization_id: GALAXY,
    conversation_id: id,
    direction: m.direction,
    provider,
    body: m.body,
    draft_status: m.draftStatus,
    sent_at: m.sentAt ?? null,
    created_at: m.createdAt,
  }));
  messages.push(...built);
  conversations.push({
    id,
    organization_id: GALAXY,
    tenant_id: tenantId,
    channel,
    status,
    summary: null,
    last_message_at: built[built.length - 1].created_at,
  });
}

// 1. Marcus Alvarez — water-heater emergency (ties to real WO #701). Handled
//    today; escalated.
thread({
  id: CONV.alvarez,
  tenantId: T_ALVAREZ,
  channel: 'sms',
  status: 'escalated',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'Hey, the water heater in the utility closet started leaking again this morning — there’s standing water on the floor.',
      createdAt: todayAt(7),
      sentAt: todayAt(7),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Thanks for flagging this, Marcus — that’s an emergency and I’ve logged it for Unit 101. I’m arranging a same-day plumber and will text you the arrival window shortly. Please keep the area clear and shut the closet door if you can.',
      createdAt: todayAt(7.1),
      sentAt: todayAt(7.1),
    },
  ],
});

// 2. Priya Banerjee — rent-receipt confirmation. Handled today; resolved.
thread({
  id: CONV.banerjee,
  tenantId: T_BANERJEE,
  channel: 'sms',
  status: 'resolved',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'Hi, can you confirm you got my rent payment for this month? Just want to make sure it went through.',
      createdAt: todayAt(9),
      sentAt: todayAt(9),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Hi Priya — yes, your $1,950 payment for Unit 102 posted on the 1st. You’re all set for this month. Thanks for staying on top of it!',
      createdAt: todayAt(9.05),
      sentAt: todayAt(9.05),
    },
  ],
});

// 3. Jordan Chen — guest parking question over iMessage. Resolved yesterday.
thread({
  id: CONV.chen,
  tenantId: T_CHEN,
  channel: 'imessage',
  status: 'resolved',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'Is guest parking still available on weekends? My family is visiting this weekend.',
      createdAt: daysAgo(1),
      sentAt: daysAgo(1),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Hi Jordan! Yes — guest parking in the rear lot is first-come on weekends, no permit needed until 8am Monday. Enjoy the visit!',
      createdAt: new Date(NOW - 1 * 86_400_000 + 4 * 60_000).toISOString(),
      sentAt: new Date(NOW - 1 * 86_400_000 + 4 * 60_000).toISOString(),
    },
  ],
});

// 4. Linda Diallo — AC still warm (ties to real assigned HVAC WO #702).
//    Handled today; escalated.
thread({
  id: CONV.diallo,
  tenantId: T_DIALLO,
  channel: 'sms',
  status: 'escalated',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'The AC still isn’t cooling — blowing warm air even though the outside unit is running. It was supposed to be looked at.',
      createdAt: todayAt(11),
      sentAt: todayAt(11),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Thanks Linda — I see Capital HVAC is already assigned to your AC issue in Unit 201. I’ve flagged that it’s still blowing warm and asked them to prioritize, and I’ll confirm their arrival window with you today.',
      createdAt: todayAt(11.07),
      sentAt: todayAt(11.07),
    },
  ],
});

// 5. Ethan Ellis — noise complaint. Resolved two days ago.
thread({
  id: CONV.ellis,
  tenantId: T_ELLIS,
  channel: 'sms',
  status: 'resolved',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'Quick noise complaint — the unit above me had loud music past midnight again last night.',
      createdAt: daysAgo(2),
      sentAt: daysAgo(2),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Sorry about the disturbance, Ethan. I’ve logged a quiet-hours reminder for the upstairs unit. If it happens again tonight, reply here and I’ll escalate it directly.',
      createdAt: new Date(NOW - 2 * 86_400_000 + 3 * 60_000).toISOString(),
      sentAt: new Date(NOW - 2 * 86_400_000 + 3 * 60_000).toISOString(),
    },
  ],
});

// 6. Fatima Farid — dishwasher status (ties to real in-progress WO #703).
//    Handled today; open.
thread({
  id: CONV.farid,
  tenantId: T_FARID,
  channel: 'sms',
  status: 'open',
  msgs: [
    {
      direction: 'inbound',
      draftStatus: 'sent_by_human',
      body: 'Any update on the dishwasher? It’s been a few days now.',
      createdAt: todayAt(13),
      sentAt: todayAt(13),
    },
    {
      direction: 'outbound',
      draftStatus: 'auto_sent',
      body: 'Hi Fatima — the replacement part for your dishwasher in Unit 203 is on order with Handyman Hank and the job is in progress. As soon as the part arrives we’ll schedule the install and text you a window.',
      createdAt: todayAt(13.04),
      sentAt: todayAt(13.04),
    },
  ],
});

// 7. PENDING REVIEW — late-rent + late-fee-waiver request. The AI drafted a
//    concession reply; the gate held it for owner approval (financial
//    concession). Attached ONLY to the non-deliverable +1555 demo tenant.
function reviewThread() {
  thread({
    id: CONV.review,
    tenantId: DEMO_TENANT_REVIEW,
    channel: 'sms',
    status: 'open',
    msgs: [
      {
        direction: 'inbound',
        draftStatus: 'sent_by_human',
        body: 'I’m going to be about a week late on rent this month — had an unexpected medical bill come up. Is there any way to waive the late fee just this once?',
        createdAt: hoursAgo(2),
        sentAt: hoursAgo(2),
      },
      {
        direction: 'outbound',
        // Held for review: a fee waiver is a financial concession, so the gate
        // routes the AI's draft to the owner instead of auto-sending.
        draftStatus: 'pending_review',
        body: 'Hi — thanks for the heads up, and sorry to hear about the medical bill. Given your strong payment history I can hold off on the late fee this one time. Please plan to have rent in by the 8th, and reply here to confirm that works for you.',
        createdAt: hoursAgo(1.9),
        sentAt: null,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

async function upsertMany(table, rows) {
  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await admin
    .from(table)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
  return { inserted: count ?? rows.length };
}

async function assertReviewTenantSafe() {
  const { data, error } = await admin
    .from('tenants')
    .select('id, full_name, phone_e164')
    .eq('organization_id', GALAXY)
    .eq('id', DEMO_TENANT_REVIEW)
    .maybeSingle();
  if (error) throw new Error(`review tenant verify: ${error.message}`);
  if (!data) {
    throw new Error(
      'SAFETY ABORT: demo review tenant not found. Run `npm run seed:owner-queue` ' +
        'first (it creates the +1555 demo tenants), then re-run this seed.',
    );
  }
  if (!TEST_PHONE_REGEX.test(data.phone_e164 ?? '')) {
    throw new Error(
      `SAFETY ABORT: review tenant (${data.full_name}) phone ` +
        `"${data.phone_e164}" is not a non-deliverable +1555 number. Refusing ` +
        `to attach a pending_review (sendable) draft to a possibly-real contact.`,
    );
  }
  return data;
}

async function main() {
  console.log(`Seeding inbox conversations into ${SUPABASE_URL}`);
  try {
    // Build the 6 safe (display-only) threads first.
    // (Already registered above via top-level thread() calls.)

    // SAFETY GATE before the only sendable row.
    const reviewTenant = await assertReviewTenantSafe();
    reviewThread();

    const c = await upsertMany('conversations', conversations);
    console.log(`  conversations: +${c.inserted} (of ${conversations.length})`);
    const m = await upsertMany('messages', messages);
    console.log(`  messages:      +${m.inserted} (of ${messages.length})`);

    const pending = messages.filter((x) => x.draft_status === 'pending_review');
    const autoToday = messages.filter(
      (x) =>
        x.draft_status === 'auto_sent' &&
        x.sent_at &&
        x.sent_at >= startOfTodayUtc.toISOString(),
    );
    console.log('');
    console.log(`  threads:        ${conversations.length}`);
    console.log(
      `  need you:       ${pending.length} (pending_review draft → ${reviewTenant.full_name} ${reviewTenant.phone_e164})`,
    );
    console.log(`  handled today:  ${autoToday.length} (auto_sent today)`);
    console.log('Done.');
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
