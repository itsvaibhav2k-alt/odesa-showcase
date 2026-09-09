/**
 * Action proposal reject route — wave 3.
 *
 * POST /api/action-proposals/:id/reject
 *
 * Marks the proposal `status='rejected'` and stamps `rejected_at`. No
 * outbound traffic; the row is preserved so the reflection loop can
 * learn from rejection patterns.
 */
import { NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectProposal } from '@/lib/inbox/proposal-mutations';
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

  const result = await rejectProposal(admin, id, user.id, me.organization_id);
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
  if (error.includes('already being decided')) return 409;
  return 500;
}
