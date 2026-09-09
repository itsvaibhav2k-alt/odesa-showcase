/**
 * Action proposal commit route — wave 3.
 *
 * POST /api/action-proposals/:id/commit
 *
 * Mints an outbound message + sends via Sendblue (with failover) +
 * marks the proposal `status='committed'`. v1 supports only
 * `action_type='draft_sms_reply'`.
 *
 * Response envelope:
 *   200 → { success: true, data: { ... } }
 *   4xx/5xx → { success: false, error: string }
 */
import { NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { commitProposal } from '@/lib/inbox/proposal-mutations';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const { data: me } = await admin
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!me?.organization_id) {
    return NextResponse.json(
      { success: false, error: 'User has no organization' },
      { status: 403 },
    );
  }

  if (me.role !== 'owner') {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  const result = await commitProposal(admin, id, user.id, me.organization_id, {
    kind: 'user',
    role: me.role ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: statusForError(result.error) },
    );
  }
  return NextResponse.json({ success: true, data: result.data });
}

function statusForError(error: string): number {
  if (error === 'Proposal not found') return 404;
  if (error === 'Forbidden') return 403;
  if (error.startsWith('Unsupported proposal action_type')) return 400;
  if (error.startsWith('Proposal status is')) return 409;
  if (error === 'Proposal is already being committed') return 409;
  if (error === 'Proposal changed before the edit could be saved') return 409;
  if (error.startsWith('Proposal edit_diff.body_after')) return 422;
  if (error.startsWith('Proposal payload missing')) return 422;
  if (error.startsWith('Proposal missing')) return 422;
  if (error === 'All providers failed') return 502;
  return 500;
}
