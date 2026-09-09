/**
 * Repair script for live-org data damaged by pre-guard agent writes
 * (Trust Sprint, Stage 5). Conventions of `scripts/diag-org-routing.mjs`:
 * service-role client from env — scripts are the only allowed
 * service-role context. Run manually; never part of CI.
 *
 * Usage:
 *   node scripts/repair-org-data.mjs --org <uuid>                       # dry-run (default)
 *   node scripts/repair-org-data.mjs --org <uuid> --apply \
 *     --rename <unitId>=<newLabel> [--rename <unitId>=<newLabel> ...]   # write
 *   node scripts/repair-org-data.mjs --org <uuid> --apply --force       # override safety refusal
 *
 * What it does (all org-scoped):
 *   1. Reports units whose label matches a same-org tenant name
 *      (same normalization as the add-unit handler guard) with their
 *      lease / rent_event / work_order counts. Renames happen ONLY via
 *      explicit --rename <unitId>=<newLabel> — never auto-guessed.
 *   2. Fixes the property-name spelling 'Ranson Appartment Building'
 *      → 'Ranson Apartment Building' via exact match (idempotent).
 *   3. Reports orphan leases with status='pending' AND rent_amount=0
 *      (report only — no deletes).
 *
 * Safety: --dry-run is the default. With --apply, the script refuses
 * when more rows match than were explicitly targeted (flagged units
 * without a --rename, or >1 misspelled property row) unless --force.
 */

import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// CLI parsing + validation
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROPERTY_NAME_TYPO = 'Ranson Appartment Building';
const PROPERTY_NAME_FIXED = 'Ranson Apartment Building';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      org: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      rename: { type: 'string', multiple: true, default: [] },
      force: { type: 'boolean', default: false },
    },
  });
} catch (err) {
  fail(err.message);
}

const { values } = parsed;

if (!values.org) fail('--org <uuid> is required');
if (!UUID_RE.test(values.org)) fail(`--org is not a valid UUID: ${values.org}`);
if (values.apply && values['dry-run']) {
  fail('--apply and --dry-run are mutually exclusive');
}

const orgId = values.org;
const apply = values.apply === true; // dry-run is the DEFAULT
const force = values.force === true;

/** Map unitId → newLabel from repeated --rename unitId=newLabel flags. */
const renames = new Map();
for (const raw of values.rename) {
  const idx = raw.indexOf('=');
  if (idx <= 0 || idx === raw.length - 1) {
    fail(`--rename must be <unitId>=<newLabel>, got: ${raw}`);
  }
  const unitId = raw.slice(0, idx).trim();
  const newLabel = raw.slice(idx + 1).trim();
  if (!UUID_RE.test(unitId)) fail(`--rename unit id is not a UUID: ${unitId}`);
  if (newLabel.length === 0) fail(`--rename new label is empty for ${unitId}`);
  if (renames.has(unitId)) fail(`duplicate --rename for unit ${unitId}`);
  renames.set(unitId, newLabel);
}

// ---------------------------------------------------------------------------
// Service-role client (scripts are the only allowed service-role context)
// ---------------------------------------------------------------------------

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  fail('NEXT_PUBLIC_SUPABASE_URL is not set');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  fail('SUPABASE_SERVICE_ROLE_KEY is not set');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

console.log('CLOUD URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('ORG:', orgId);
console.log('MODE:', apply ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)');

// ---------------------------------------------------------------------------
// Normalization — keep in sync with the tenant-name guard in
// src/lib/agent/worker/handlers/add-unit.ts
// ---------------------------------------------------------------------------

function normalizeLabel(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function labelMatchesTenantName(labelNorm, nameNorm) {
  if (labelNorm.length === 0 || nameNorm.length === 0) return false;
  if (labelNorm === nameNorm) return true;

  const nameTokens = nameNorm.split(' ');
  if (nameTokens.length < 2) return false;

  const first = nameTokens[0];
  const last = nameTokens[nameTokens.length - 1];
  if (labelNorm === `${first} ${last}`) return true;
  if (labelNorm === `${first}${last}`) return true;

  const labelTokens = labelNorm.split(' ');
  const isTwoAlphaWords =
    labelTokens.length === 2 &&
    labelTokens[0] !== labelTokens[1] &&
    labelTokens.every((token) => /^\p{L}+$/u.test(token));
  if (
    isTwoAlphaWords &&
    labelTokens.every((token) => nameTokens.includes(token))
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 1. Units whose label matches a same-org tenant name
// ---------------------------------------------------------------------------

const { data: tenants, error: tenantsError } = await supabase
  .from('tenants')
  .select('id, full_name')
  .eq('organization_id', orgId);
if (tenantsError) fail(`tenants query failed: ${tenantsError.message}`);

const { data: units, error: unitsError } = await supabase
  .from('units')
  .select('id, label, property_id')
  .eq('organization_id', orgId);
if (unitsError) fail(`units query failed: ${unitsError.message}`);

const flaggedUnits = (units ?? []).filter((unit) => {
  const labelNorm = normalizeLabel(unit.label ?? '');
  return (tenants ?? []).some((tenant) =>
    labelMatchesTenantName(labelNorm, normalizeLabel(tenant.full_name ?? '')),
  );
});

console.log(
  `\n[1] Units with tenant-name labels: ${flaggedUnits.length} flagged ` +
    `(of ${units?.length ?? 0} units, ${tenants?.length ?? 0} tenants)`,
);

async function countRows(table, filters) {
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  for (const [column, value] of filters) {
    query = Array.isArray(value)
      ? query.in(column, value)
      : query.eq(column, value);
  }
  const { count, error } = await query;
  if (error) fail(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

for (const unit of flaggedUnits) {
  const { data: leases, error: leasesError } = await supabase
    .from('leases')
    .select('id')
    .eq('organization_id', orgId)
    .eq('unit_id', unit.id);
  if (leasesError) fail(`leases query failed: ${leasesError.message}`);

  const leaseIds = (leases ?? []).map((l) => l.id);
  const rentEventCount =
    leaseIds.length === 0
      ? 0
      : await countRows('rent_events', [['lease_id', leaseIds]]);
  const workOrderCount = await countRows('work_orders', [['unit_id', unit.id]]);

  const target = renames.get(unit.id);
  console.log(
    `  unit ${unit.id}  label="${unit.label}"  property=${unit.property_id}` +
      `  leases=${leaseIds.length}  rent_events=${rentEventCount}` +
      `  work_orders=${workOrderCount}` +
      (target !== undefined
        ? `  → rename to "${target}"`
        : '  (no --rename given; will NOT touch)'),
  );
}
if (flaggedUnits.length === 0) console.log('  none');

// ---------------------------------------------------------------------------
// 2. Renames — only explicit --rename targets, never auto-guessed
// ---------------------------------------------------------------------------

console.log(`\n[2] Renames requested: ${renames.size}`);

const renameRows = [];
for (const [unitId, newLabel] of renames) {
  const { data: row, error } = await supabase
    .from('units')
    .select('id, label, property_id')
    .eq('organization_id', orgId)
    .eq('id', unitId)
    .maybeSingle();
  if (error) fail(`unit lookup failed for ${unitId}: ${error.message}`);
  if (!row) fail(`--rename target ${unitId} not found in org ${orgId}`);

  // Never replace one tenant-name label with another.
  const newNorm = normalizeLabel(newLabel);
  const collides = (tenants ?? []).some((tenant) =>
    labelMatchesTenantName(newNorm, normalizeLabel(tenant.full_name ?? '')),
  );
  if (collides && !force) {
    fail(
      `new label "${newLabel}" for unit ${unitId} also matches a tenant ` +
        `name — pick a short identifier, or pass --force to override`,
    );
  }

  renameRows.push({ before: row, newLabel });
  console.log(`  unit ${unitId}: "${row.label}" → "${newLabel}"`);
}
if (renames.size === 0) console.log('  none');

// ---------------------------------------------------------------------------
// 3. Property-name spelling fix (exact match, idempotent)
// ---------------------------------------------------------------------------

const { data: typoProperties, error: typoError } = await supabase
  .from('properties')
  .select('id, name')
  .eq('organization_id', orgId)
  .eq('name', PROPERTY_NAME_TYPO);
if (typoError) fail(`properties query failed: ${typoError.message}`);

console.log(
  `\n[3] Properties named "${PROPERTY_NAME_TYPO}": ${typoProperties?.length ?? 0}`,
);
for (const property of typoProperties ?? []) {
  console.log(`  property ${property.id}: "${property.name}" → "${PROPERTY_NAME_FIXED}"`);
}
if ((typoProperties?.length ?? 0) === 0) {
  console.log('  none (already fixed or never present — idempotent no-op)');
}

// ---------------------------------------------------------------------------
// 4. Orphan leases: status='pending' AND rent_amount=0 (report only)
// ---------------------------------------------------------------------------

const { data: orphanLeases, error: orphanError } = await supabase
  .from('leases')
  .select('id, tenant_id, unit_id, status, rent_amount, created_at')
  .eq('organization_id', orgId)
  .eq('status', 'pending')
  .eq('rent_amount', 0);
if (orphanError) fail(`orphan-lease query failed: ${orphanError.message}`);

console.log(
  `\n[4] Orphan leases (status='pending' AND rent_amount=0): ${orphanLeases?.length ?? 0}` +
    ' (report only — fix via the app or a follow-up flag)',
);
for (const lease of orphanLeases ?? []) {
  console.log(
    `  lease ${lease.id}  tenant=${lease.tenant_id}  unit=${lease.unit_id}` +
      `  created=${lease.created_at}`,
  );
}
if ((orphanLeases?.length ?? 0) === 0) console.log('  none');

// ---------------------------------------------------------------------------
// Apply (or stop at dry-run)
// ---------------------------------------------------------------------------

if (!apply) {
  console.log(
    '\nDRY-RUN complete. Nothing written. Re-run with --apply (and explicit' +
      ' --rename flags) to write.',
  );
  process.exit(0);
}

// Safety refusal: more rows match than were explicitly targeted.
const untargetedFlagged = flaggedUnits.filter((u) => !renames.has(u.id));
if (untargetedFlagged.length > 0 && !force) {
  fail(
    `refusing to apply: ${untargetedFlagged.length} flagged unit(s) have no` +
      ` explicit --rename (${untargetedFlagged.map((u) => u.id).join(', ')}).` +
      ' Target every flagged unit or pass --force to apply the rest anyway.',
  );
}
if ((typoProperties?.length ?? 0) > 1 && !force) {
  fail(
    `refusing to apply: ${typoProperties.length} properties match` +
      ` "${PROPERTY_NAME_TYPO}" (expected at most 1). Pass --force to fix all.`,
  );
}

console.log('\nAPPLYING…');

for (const { before, newLabel } of renameRows) {
  const { data: after, error } = await supabase
    .from('units')
    .update({ label: newLabel })
    .eq('organization_id', orgId)
    .eq('id', before.id)
    .select('id, label, property_id')
    .single();
  if (error || !after) {
    fail(`rename failed for unit ${before.id}: ${error?.message ?? 'no row'}`);
  }
  console.log('  unit rename:');
  console.log(`    before: ${JSON.stringify(before)}`);
  console.log(`    after:  ${JSON.stringify(after)}`);
}

if ((typoProperties?.length ?? 0) > 0) {
  const { data: after, error } = await supabase
    .from('properties')
    .update({ name: PROPERTY_NAME_FIXED })
    .eq('organization_id', orgId)
    .eq('name', PROPERTY_NAME_TYPO)
    .select('id, name');
  if (error) fail(`property rename failed: ${error.message}`);
  console.log('  property name fix:');
  for (const property of typoProperties) {
    console.log(`    before: ${JSON.stringify(property)}`);
  }
  for (const row of after ?? []) {
    console.log(`    after:  ${JSON.stringify(row)}`);
  }
}

console.log('\nAPPLY complete.');
