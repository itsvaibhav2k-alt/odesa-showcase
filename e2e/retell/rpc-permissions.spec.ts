import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '@/types/database';
import { HAVE_SUPABASE, provisionGalaxyOwner } from '../today/helpers';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

test.describe('Wave 3 SECURITY DEFINER permissions', () => {
  test.skip(!HAVE_SUPABASE, 'requires isolated local Supabase');

  test('anon and authenticated roles cannot claim, renew, complete, or finalize', async () => {
    const owner = await provisionGalaxyOwner();
    try {
      const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
      const authenticated = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
      const signedIn = await authenticated.auth.signInWithPassword({ email: owner.email, password: owner.password });
      expect(signedIn.error).toBeNull();

      for (const client of [anon, authenticated]) {
        const claim = await client.rpc('claim_retell_tool_invocation', {
          p_organization_id: owner.organizationId, p_call_id: 'permission-denied',
          p_tool_name: 'create_work_order', p_idempotency_key: 'denied', p_request_hash: 'denied',
        });
        expect(claim.error?.message).toMatch(/permission denied/i);
        const renew = await client.rpc('renew_retell_tool_invocation_lease', {
          p_invocation_id: crypto.randomUUID(), p_claim_token: crypto.randomUUID(), p_claim_generation: 1,
        });
        expect(renew.error?.message).toMatch(/permission denied/i);
        const complete = await client.rpc('complete_retell_tool_invocation', {
          p_invocation_id: crypto.randomUUID(), p_claim_token: crypto.randomUUID(), p_claim_generation: 1, p_status: 'completed',
          p_canonical_result: {}, p_http_status: 200,
        });
        expect(complete.error?.message).toMatch(/permission denied/i);
        const finalize = await client.rpc('finalize_retell_call_artifacts', {
          p_retell_call_id: 'permission-denied', p_session: {}, p_transcript: null,
          p_summary: 'denied', p_outcome: {}, p_message_body: 'denied',
          p_ended_at: new Date().toISOString(), p_needs_review: false,
          p_property_id: null, p_tenant_id: null, p_richness: 0,
        });
        expect(finalize.error?.message).toMatch(/permission denied/i);
      }
    } finally {
      await owner.teardown();
    }
  });
});
