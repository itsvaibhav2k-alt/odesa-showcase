import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

import type { Database, Json } from '../../src/types/database';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const isLocal = (() => {
  try {
    const host = new URL(SUPABASE_URL).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
})();

function plan(stamp: string, invalidLeaseStatus = false): Json {
  const propertyKey = `wave2-${stamp}::1-atomic-way`;
  const unitKey = `${propertyKey}::1`;
  const tenantKey = `phone::+1571555${stamp.slice(-4).padStart(4, '0')}`;
  return {
    properties: [{ naturalKey: propertyKey, action: 'will_insert', data: {
      name: `WAVE2-${stamp}`, addressStreet: '1 Atomic Way', addressCity: 'Arlington',
      addressState: 'VA', addressZip: '22201',
    } }],
    units: [{ naturalKey: unitKey, action: 'will_insert', data: {
      propertyName: `WAVE2-${stamp}`, label: '1', bedrooms: 1, bathrooms: 1,
    } }],
    tenants: [{ naturalKey: tenantKey, action: 'will_insert', data: {
      fullName: `Wave Two ${stamp}`, phoneE164: `+1571555${stamp.slice(-4).padStart(4, '0')}`,
      email: `wave2-${stamp}@odesa.test`, dateOfBirth: null,
    } }],
    leases: [{ naturalKey: `${unitKey}::${tenantKey}::2026-01-01`, action: 'will_insert', data: {
      propertyName: `WAVE2-${stamp}`, unitLabel: '1',
      tenantPhoneE164: `+1571555${stamp.slice(-4).padStart(4, '0')}`,
      tenantEmail: `wave2-${stamp}@odesa.test`, rentAmount: 1800, rentDueDay: 1,
      startDate: '2026-01-01', endDate: '2026-12-31',
      status: invalidLeaseStatus ? 'not_a_lease_status' : 'active',
    } }],
  };
}

function rawPayloadHash(bytes: Uint8Array): string {
  return createHash('sha256').update('generic').update('\0').update(bytes).digest('hex');
}

test.describe('Wave 2 import transaction and durable idempotency', () => {
  test.describe.configure({ mode: 'serial' });
  const stamp = `${Date.now()}`;
  let db: ReturnType<typeof createClient<Database>>;
  let organizationId = '';

  test.beforeAll(async () => {
    // Safety invariant: no test-owned writes unless both API and DB-facing URL
    // are explicitly local. This suite never invokes reset or link commands.
    if (!SERVICE_ROLE_KEY || !isLocal) {
      throw new Error('ABORTED: Wave 2 DB tests require an explicit localhost/127.0.0.1 Supabase URL and service key');
    }
    db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await db.from('organizations').insert({
      name: `WAVE2 Atomicity ${stamp}`,
      slug: `wave2-atomicity-${stamp}`,
    }).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'organization insert failed');
    organizationId = data.id;
  });

  test.afterAll(async () => {
    if (!organizationId) return;
    const { error } = await db.from('organizations').delete().eq('id', organizationId);
    if (error) throw new Error(`Wave 2 teardown failed: ${error.message}`);
    for (const table of ['properties', 'units', 'tenants', 'leases', 'import_requests', 'import_entities'] as const) {
      const { count, error: countError } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId);
      if (countError) throw new Error(`cleanup count ${table}: ${countError.message}`);
      expect(count, `${table} cleanup`).toBe(0);
    }
  });

  test('50 simultaneous duplicates converge and timeout-style replay is canonical', async () => {
    const args = {
      p_organization_id: organizationId,
      p_idempotency_key: `wave2-concurrent-${stamp}`,
      p_source: 'generic',
      p_payload_hash: 'a'.repeat(64),
      p_plan: plan(stamp),
    };
    const results = await Promise.all(Array.from({ length: 50 }, () => db.rpc('commit_portfolio_import', args)));
    expect(results.filter((r) => r.error)).toHaveLength(0);
    const payloads = results.map((r) => r.data as { replay: boolean; summary: unknown });
    expect(payloads.filter((r) => !r.replay)).toHaveLength(1);
    expect(payloads.filter((r) => r.replay)).toHaveLength(49);

    for (const table of ['properties', 'units', 'tenants', 'leases'] as const) {
      const { count } = await db.from(table).select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId);
      expect(count, `${table} after 50 retries`).toBe(1);
    }

    // Discarding the first response models an ambiguous client timeout. The
    // retry must replay the stored canonical result rather than re-execute.
    const retry = await db.rpc('commit_portfolio_import', args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ replay: true, summary: payloads[0].summary });
  });

  test('an injected mid-import lease failure rolls every parent row back', async () => {
    const failedStamp = `${stamp}9`;
    const { error } = await db.rpc('commit_portfolio_import', {
      p_organization_id: organizationId,
      p_idempotency_key: `wave2-rollback-${stamp}`,
      p_source: 'generic',
      p_payload_hash: 'b'.repeat(64),
      p_plan: plan(failedStamp, true),
    });
    expect(error).not.toBeNull();

    const { count: properties } = await db.from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('name', `WAVE2-${failedStamp}`);
    expect(properties).toBe(0);
    const { count: requests } = await db.from('import_requests')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('idempotency_key', `wave2-rollback-${stamp}`);
    expect(requests).toBe(0);
  });

  test('same key with different invalid raw byte is rejected as a payload conflict', async () => {
    const byteStamp = `${stamp}7`;
    const key = `wave2-raw-byte-${stamp}`;
    const args = {
      p_organization_id: organizationId,
      p_idempotency_key: key,
      p_source: 'generic',
      p_payload_hash: rawPayloadHash(Uint8Array.of(0xef, 0xbf, 0xbd)),
      p_plan: plan(byteStamp),
    };
    const first = await db.rpc('commit_portfolio_import', args);
    expect(first.error).toBeNull();
    const second = await db.rpc('commit_portfolio_import', {
      ...args,
      p_payload_hash: rawPayloadHash(Uint8Array.of(0xff)),
    });
    expect(second.error?.message).toContain('idempotency key already used with a different payload');
    const { count } = await db.from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('name', `WAVE2-${byteStamp}`);
    expect(count).toBe(1);
  });

  test('a malformed required row rolls back earlier valid rows and its request record', async () => {
    const malformedStamp = `${stamp}8`;
    const malformed = plan(malformedStamp) as Record<string, Json>;
    const properties = malformed.properties as Json[];
    properties.push({
      naturalKey: `wave2-${malformedStamp}-bad::2-atomic-way`,
      action: 'will_insert',
      data: { name: '', addressStreet: '2 Atomic Way' },
    });
    const key = `wave2-malformed-${stamp}`;
    const { error } = await db.rpc('commit_portfolio_import', {
      p_organization_id: organizationId,
      p_idempotency_key: key,
      p_source: 'generic',
      p_payload_hash: 'c'.repeat(64),
      p_plan: malformed,
    });
    expect(error).not.toBeNull();

    const { count: propertiesAfter } = await db.from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('name', `WAVE2-${malformedStamp}`);
    expect(propertiesAfter).toBe(0);
    const { count: requestsAfter } = await db.from('import_requests')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('idempotency_key', key);
    expect(requestsAfter).toBe(0);
  });

  for (const [existingStatus, importedStatus] of [
    ['active', 'active'],
    ['active', 'pending'],
    ['pending', 'active'],
    ['pending', 'pending'],
  ] as const) {
    test(`rejects unit_not_vacant for ${existingStatus} → ${importedStatus}`, async () => {
      const caseStamp = `${stamp}-${existingStatus}-${importedStatus}`;
      const propertyName = `WAVE2 Occupancy ${caseStamp}`;
      const street = `${Math.floor(Math.random() * 100000)} Lock Row`;
      const { data: property, error: propertyError } = await db.from('properties').insert({
        organization_id: organizationId, name: propertyName, address_street: street,
      }).select('id').single();
      if (propertyError || !property) throw new Error(propertyError?.message ?? 'property insert failed');
      const { data: unit, error: unitError } = await db.from('units').insert({
        organization_id: organizationId, property_id: property.id, label: '1',
      }).select('id').single();
      if (unitError || !unit) throw new Error(unitError?.message ?? 'unit insert failed');
      const { data: existingTenant, error: tenantError } = await db.from('tenants').insert({
        organization_id: organizationId,
        full_name: `Existing ${caseStamp}`,
        phone_e164: `+1${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`,
      }).select('id').single();
      if (tenantError || !existingTenant) throw new Error(tenantError?.message ?? 'tenant insert failed');
      const { error: leaseError } = await db.from('leases').insert({
        organization_id: organizationId, unit_id: unit.id, tenant_id: existingTenant.id,
        rent_amount: 1200, rent_due_day: 1, status: existingStatus,
      });
      if (leaseError) throw new Error(`existing lease insert failed: ${leaseError.message}`);

      const propertyKey = `occupancy-${caseStamp}::lock-row`;
      const unitKey = `${propertyKey}::1`;
      const phone = `+1${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
      const tenantKey = `phone::${phone}`;
      const importedEmail = `imported-${caseStamp}@odesa.test`;
      const importPlan: Json = {
        properties: [{ naturalKey: propertyKey, action: 'will_insert', data: {
          name: propertyName, addressStreet: street, addressCity: null,
          addressState: null, addressZip: null,
        } }],
        units: [{ naturalKey: unitKey, action: 'will_insert', data: {
          propertyName, label: '1', bedrooms: null, bathrooms: null,
        } }],
        tenants: [{ naturalKey: tenantKey, action: 'will_insert', data: {
          fullName: `Imported ${caseStamp}`, phoneE164: phone,
          email: importedEmail, dateOfBirth: null,
        } }],
        leases: [{ naturalKey: `${unitKey}::${tenantKey}::2027-01-01`, action: 'will_insert', data: {
          propertyName, unitLabel: '1', tenantPhoneE164: phone,
          tenantEmail: importedEmail, rentAmount: 1300, rentDueDay: 1,
          startDate: '2027-01-01', endDate: null, status: importedStatus,
        } }],
      };
      const key = `occupancy-${caseStamp}`;
      const { error } = await db.rpc('commit_portfolio_import', {
        p_organization_id: organizationId,
        p_idempotency_key: key,
        p_source: 'generic',
        p_payload_hash: 'd'.repeat(64),
        p_plan: importPlan,
      });
      expect(error?.message).toContain('unit_not_vacant');
      const { count: leaseCount } = await db.from('leases')
        .select('*', { count: 'exact', head: true }).eq('unit_id', unit.id);
      expect(leaseCount).toBe(1);
      const { count: importedTenantCount } = await db.from('tenants')
        .select('*', { count: 'exact', head: true }).eq('email', importedEmail);
      expect(importedTenantCount).toBe(0);
      const { count: requestCount } = await db.from('import_requests')
        .select('*', { count: 'exact', head: true }).eq('idempotency_key', key);
      expect(requestCount).toBe(0);
    });
  }
});
