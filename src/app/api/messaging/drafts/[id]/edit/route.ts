/**
 * Draft edit route — Phase 4.
 *
 * PATCH /api/messaging/drafts/:id/edit
 * Body: { body: string }
 *
 * Updates the draft's `body` while keeping `draft_status='pending_review'`
 * so the human can keep iterating before the send.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { validateBody } from '@/lib/api-validation';
import { requireAccessContext } from '@/lib/authz/context';
import { accessAllows } from '@/lib/authz/enforce';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { lookupCanonicalProposalForMessage } from '@/lib/messaging/canonical-draft';

interface Params {
  params: Promise<{ id: string }>;
}

const editSchema = z.object({
  body: z.string().min(1).max(2_000),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }
  if (!access.context.capabilities.has('draft_messages')) {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  const parsed = await validateBody(req, editSchema);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

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

  if (access.context.organizationId !== draft.organization_id) {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  const { data: conversation } = await admin
    .from('conversations')
    .select('id, organization_id, property_id')
    .eq('id', draft.conversation_id)
    .maybeSingle();
  if (
    !conversation ||
    conversation.organization_id !== draft.organization_id ||
    !conversation.property_id ||
    !accessAllows(
      access.context,
      'draft_messages',
      conversation.property_id,
    )
  ) {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
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

  const { data: edited, error: updateErr } = await admin
    .from('messages')
    .update({
      body: parsed.data.body.trim(),
      draft_status: 'pending_review',
    })
    .eq('id', id)
    .eq('organization_id', access.context.organizationId)
    .eq('conversation_id', draft.conversation_id)
    .eq('draft_status', 'pending_review')
    .select('id')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json(
      { success: false, error: 'Failed to update draft' },
      { status: 500 },
    );
  }
  if (!edited) {
    return NextResponse.json(
      { success: false, error: 'Draft changed before it could be edited' },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, data: { messageId: id } });
}
