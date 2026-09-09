/**
 * Assigned residents — live, RLS-scoped property-manager workspace.
 */

import { listTenantsDirectory } from "@/lib/tenants/queries";
import { createServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

import { TenantsDirectory } from "./tenants-directory";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const supabase = await createServerClient();
  const [{ header, facets, rows }, { data: currentRole }] = await Promise.all([
    listTenantsDirectory(),
    supabase.rpc("current_user_role"),
  ]);

  return (
    <TenantsDirectory
      rows={rows}
      facets={facets}
      header={header}
      role={(currentRole ?? null) as UserRole | null}
    />
  );
}
