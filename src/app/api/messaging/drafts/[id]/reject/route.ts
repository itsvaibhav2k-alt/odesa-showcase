/**
 * Draft reject route — Phase 4.
 *
 * POST /api/messaging/drafts/:id/reject
 *
 * Marks the draft as `rejected`. No outbound send happens. The row
 * is kept for audit so the weekly briefing can surface rejection
 * rate (Phase 7).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { lookupCanonicalProposalForMessage } from '@/lib/messaging/canonical-draft';

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

  const { data: draft } = await admin
    .from('messages')
    .select(
      'id, organization_id, conversation_id, draft_status, retell_artifact_key',
    )
    .eq('id', id)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json(
      { success: false, error: 'Draft not found' },
      { status: 404 },
    );
  }

  if (draft.draft_status !== 'pending_review') {
    return NextResponse.json(
      {
        success: false,
        error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
      },
      { status: 409 },
    );
  }

  if (me.organization_id !== draft.organization_id) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 },
    );
  }

  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    draft.organization_id,
  );
  if (!canonical.ok) {
    return NextResponse.json(
      { success: false, error: 'Draft review status could not be verified. No action was taken' },
      { status: 503 },
    );
  }
  if (canonical.linked) {
    return NextResponse.json(
      { success: false, error: 'This draft is reviewed in Owner Queue' },
      { status: 409 },
    );
  }

  const { data: rejected, error: updateErr } = await admin
    .from('messages')
    .update({ draft_status: 'rejected' })
    .eq('id', id)
    .eq('draft_status', 'pending_review')
    .select('id')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json(
      { success: false, error: 'Failed to reject draft' },
      { status: 500 },
    );
  }
  if (!rejected) {
    return NextResponse.json(
      { success: false, error: 'Draft changed before it could be rejected' },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, data: { messageId: id } });
}
