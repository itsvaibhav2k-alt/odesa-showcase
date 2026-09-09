/**
 * Root route — authenticated users go to /today; anonymous visitors see the
 * Odesa Night Garden marketing landing.
 *
 * `public/landing.html` is preserved as a static fallback but is no longer
 * the primary entry point.
 */

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';
import { requireAccessContext } from '@/lib/authz/context';
import { landingRouteForAccess } from '@/lib/authz/access-policy';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = await createServerClient();
  const { data } = await db.auth.getUser();
  if (data?.user) {
    const access = await requireAccessContext({ auth: db, db });
    const landing = access.ok
      ? landingRouteForAccess(
          access.context.role,
          access.context.capabilities,
        )
      : null;
    // A signed-in identity with no unique active staff membership, or an
    // Accountant with every readable surface denied, lands on the guarded
    // shell and receives its normal fail-closed not-found response.
    redirect(landing ?? '/today');
  }
  return <NightGardenPage page="index" />;
}
