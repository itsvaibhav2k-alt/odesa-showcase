/**
 * Assigned properties — live portfolio operations workspace (`/properties`).
 *
 * The server owns authenticated, RLS-scoped loading. The client island owns
 * finite selection, search, operational filters, and the add-property dialog.
 */

import {
  getProperties,
  getPortfolioSummary,
  getAskPrompts,
} from "@/lib/properties/portfolio-queries";
import { PropertiesClient } from "@/components/properties/portfolio/properties-client";
import { createServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc("current_user_role");
  const role: UserRole | null = currentRole ?? null;
  const isVa = role === "va";
  const [summary, properties] = await Promise.all([
    getPortfolioSummary(),
    getProperties(),
  ]);
  const askPrompts = isVa
    ? [
        "Summarize open work by property",
        "What needs owner follow-up?",
        "Draft a portfolio handoff",
      ]
    : getAskPrompts();

  return (
    <PropertiesClient
      summary={summary}
      properties={properties}
      askPrompts={askPrompts}
      role={role}
      readOnly={isVa}
    />
  );
}
