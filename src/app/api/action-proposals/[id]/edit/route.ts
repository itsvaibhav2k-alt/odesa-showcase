/**
 * Action proposal edit route — wave 3.
 *
 * PATCH /api/action-proposals/:id/edit
 * Body: { body: string }   // 1–2000 chars
 *
 * Records the edit in `action_proposals.edit_diff` JSONB so the
 * reflection loop can learn what operators rewrite. The original
 * `payload` is preserved unchanged (it is a model-output snapshot).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { validateBody } from '@/lib/api-validation';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { editProposal } from '@/lib/inbox/proposal-mutations';

interface Params {
  params: Promise<{ id: string }>;
}

const editSchema = z.object({
  body: z.string().min(1).max(2_000),
});

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const { data: me } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!me?.organization_id || me.role === 'va') {
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

  const result = await editProposal(
    admin,
    id,
    user.id,
    me.organization_id,
    parsed.data.body,
  );
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
  if (error.startsWith('Proposal status is')) return 409;
  if (error.includes('changed before the edit could be saved')) return 409;
  if (error.startsWith('Body must be')) return 400;
  return 500;
}
