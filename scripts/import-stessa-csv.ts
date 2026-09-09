/**
 * Stessa rent-roll CSV importer.
 *
 * Reads a CSV with header row `Unit,Tenant,Rent,Due Day` and updates the
 * matching `leases` row(s) in Odesa with `rent_amount` + `rent_due_day`.
 *
 * Matching strategy: for each CSV row, find an active lease in the
 * target org whose unit.label == row.Unit AND whose tenant.full_name
 * matches (case-insensitive, trimmed). If there's no match, log and
 * skip — do NOT fail the run; rent rolls frequently contain stale rows
 * that Aero has already moved out.
 *
 * Phase-3 scaffold: no UI wiring, no Inngest job. Ships as a script you
 * can run by hand once the Aero migrator has populated the org.
 */

import * as fs from 'node:fs';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '../src/lib/supabase/admin';
import type { Database } from '../src/types/database';

export interface StessaRow {
  unit: string;
  tenant: string;
  rent: number;
  dueDay: number;
}

export interface StessaImportResult {
  rowsParsed: number;
  leasesUpdated: number;
  skipped: Array<{ row: StessaRow; reason: string }>;
}

export interface StessaImportOptions {
  csvPath: string;
  organizationId: string;
  client?: SupabaseClient<Database>;
  logger?: {
    info: (msg: string, meta?: unknown) => void;
    warn: (msg: string, meta?: unknown) => void;
  };
}

const defaultLogger = {
  info: (msg: string, meta?: unknown) => console.log(`[stessa] ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[stessa] ${msg}`, meta ?? ''),
};

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Minimal CSV parser. Handles double-quoted fields with embedded commas
 * and doubled-quote escapes (`""`). Doesn't support multiline quoted
 * fields — Stessa exports are single-line rows.
 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

export function parseStessaCsv(raw: string): StessaRow[] {
  const rows = parseCsv(raw);
  if (rows.length === 0) return [];
  const header = rows[0];
  if (!header) return [];
  const idx = {
    unit: findHeader(header, ['unit']),
    tenant: findHeader(header, ['tenant', 'tenant name', 'resident']),
    rent: findHeader(header, ['rent', 'rent amount', 'monthly rent']),
    dueDay: findHeader(header, ['due day', 'due date', 'day']),
  };
  if (idx.unit < 0 || idx.tenant < 0 || idx.rent < 0 || idx.dueDay < 0) {
    throw new Error(
      `Stessa CSV missing required columns. Got header: ${header.join(', ')}`,
    );
  }
  const out: StessaRow[] = [];
  for (const row of rows.slice(1)) {
    const unit = (row[idx.unit] ?? '').trim();
    const tenant = (row[idx.tenant] ?? '').trim();
    const rentStr = (row[idx.rent] ?? '').replace(/[$,]/g, '').trim();
    const dueStr = (row[idx.dueDay] ?? '').trim();
    if (!unit || !tenant || !rentStr) continue;
    const rent = Number.parseFloat(rentStr);
    const dueDay = Number.parseInt(dueStr, 10) || 1;
    if (!Number.isFinite(rent)) continue;
    out.push({ unit, tenant, rent, dueDay: clampDueDay(dueDay) });
  }
  return out;
}

function findHeader(header: readonly string[], aliases: readonly string[]): number {
  const lowers = header.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const i = lowers.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function clampDueDay(day: number): number {
  if (day < 1) return 1;
  if (day > 31) return 31;
  return day;
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * Canonicalises a name for matching: lowercase, strip punctuation,
 * collapse whitespace. Matches on normalized form, not raw text, so
 * "J. Kim" matches "J Kim" and "Marcus J. Alvarez" matches loosely.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * First + last name with any middle tokens dropped. Lets "Marcus Alvarez"
 * in a Stessa row match "Marcus J. Alvarez" in the tenants table — a
 * common shape after Aero dedupes tenants by phone and the winning row
 * carries the middle initial.
 */
export function firstLastKey(raw: string): string {
  const tokens = normalizeName(raw).split(' ').filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0];
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

export async function runStessaImport(
  opts: StessaImportOptions,
): Promise<StessaImportResult> {
  const client = opts.client ?? createAdminClient();
  const logger = opts.logger ?? defaultLogger;
  const raw = fs.readFileSync(opts.csvPath, 'utf8');
  const rows = parseStessaCsv(raw);

  logger.info(`Parsed ${rows.length} Stessa row(s) from ${opts.csvPath}`);

  const result: StessaImportResult = {
    rowsParsed: rows.length,
    leasesUpdated: 0,
    skipped: [],
  };

  if (rows.length === 0) return result;

  // Pull all active+pending leases for the org with their join fields.
  // Small data volume (< 200 leases per customer in practice), so one
  // shot is fine; we avoid a per-row roundtrip.
  const { data: leases, error } = await client
    .from('leases')
    .select('id, unit:units(label), tenant:tenants(full_name)')
    .eq('organization_id', opts.organizationId)
    .in('status', ['active', 'pending']);

  if (error) {
    throw new Error(`Failed to fetch leases for Stessa import: ${error.message}`);
  }

  type LeaseHit = { id: string; unitLabel: string; tenantName: string };
  const hits: LeaseHit[] = (leases ?? [])
    .map((l) => {
      const unit = Array.isArray(l.unit) ? l.unit[0] : l.unit;
      const tenant = Array.isArray(l.tenant) ? l.tenant[0] : l.tenant;
      if (!unit?.label || !tenant?.full_name) return null;
      return {
        id: l.id,
        unitLabel: unit.label,
        tenantName: tenant.full_name,
      };
    })
    .filter((x): x is LeaseHit => x !== null);

  for (const row of rows) {
    const rowTenantNorm = normalizeName(row.tenant);
    const rowFirstLast = firstLastKey(row.tenant);
    const match = hits.find((h) => {
      if (h.unitLabel !== row.unit) return false;
      const hitNorm = normalizeName(h.tenantName);
      if (hitNorm === rowTenantNorm) return true;
      return firstLastKey(h.tenantName) === rowFirstLast;
    });
    if (!match) {
      logger.warn(
        `No active lease matches unit="${row.unit}" tenant="${row.tenant}"; skipping`,
      );
      result.skipped.push({ row, reason: 'no-match' });
      continue;
    }

    const { error: updateErr } = await client
      .from('leases')
      .update({
        rent_amount: row.rent,
        rent_due_day: row.dueDay,
      })
      .eq('id', match.id);

    if (updateErr) {
      logger.warn(`Failed to update lease ${match.id}: ${updateErr.message}`);
      result.skipped.push({ row, reason: `update-failed: ${updateErr.message}` });
      continue;
    }

    result.leasesUpdated += 1;
  }

  logger.info('Stessa import complete', {
    parsed: result.rowsParsed,
    updated: result.leasesUpdated,
    skipped: result.skipped.length,
  });

  return result;
}
