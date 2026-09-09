import { can, FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';

export interface ImportAuthContext {
  userId: string;
  organizationId: string;
  role: string;
}

export async function requireImportAuthContext(): Promise<
  | { ok: true; context: ImportAuthContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' };

  const { data: userRow, error: membershipError } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (membershipError || !userRow?.organization_id || !userRow.role) {
    return { ok: false, status: 403, error: FORBIDDEN_MESSAGE };
  }
  if (!can(userRow.role, 'import_portfolio')) {
    return { ok: false, status: 403, error: FORBIDDEN_MESSAGE };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role,
    },
  };
}
