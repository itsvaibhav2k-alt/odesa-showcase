import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthPanel } from '@/components/shared';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Onboarding shell.
 *
 * Wraps every step in a centred, paper-coloured card and runs auth +
 * completion checks before rendering children:
 *
 *   1. Unauthenticated → /login (middleware catches this too; we double-
 *      up so direct calls like /onboarding/property never rely solely on
 *      middleware cookie parsing).
 *   2. VA member → /today. Portfolio setup is an owner workflow; Today
 *      renders a bounded empty-shift state when the org has no property yet.
 *   3. Fully onboarded — org has `odesa_phone_number` AND user has
 *      `phone_verified_at` — → /today.
 *   4. Number assigned but personal phone not yet verified — funnel the
 *      operator to `/onboarding/verify-phone`. Any other onboarding URL
 *      (e.g. directly hitting `/onboarding/property` after the messaging
 *      step finished) bounces forward to the verify step.
 *   4. Otherwise: render children — partial progress through earlier
 *      steps is allowed.
 */

interface Props {
  children: ReactNode;
}

const VERIFY_PHONE_PATH = '/onboarding/verify-phone';

export const dynamic = 'force-dynamic';

export default async function OnboardingLayout({ children }: Props) {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Resolve which onboarding subroute the operator is currently on so we
  // can avoid a redirect loop on the verify-phone step itself. The
  // `x-pathname` header is set by `src/lib/supabase/middleware.ts`.
  const headerList = await headers();
  const currentPath = headerList.get('x-pathname') ?? '';

  // Check onboarding completion. A user is fully done only when their
  // org has an `odesa_phone_number` AND their personal phone has been
  // verified (`users.phone_verified_at IS NOT NULL`). Earlier steps are
  // reachable as long as the messaging step hasn't completed; the index
  // page (`./page.tsx`) routes to the furthest-right unfinished step.
  const { data: userRow } = await supabase
    .from('users')
    .select('organization_id, phone_verified_at, role')
    .eq('id', user.id)
    .single();

  if (userRow) {
    if (userRow.role === 'va') {
      redirect('/today');
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('odesa_phone_number')
      .eq('id', userRow.organization_id)
      .single();

    const hasOdesaNumber = Boolean(org?.odesa_phone_number);
    const hasVerifiedPhone = Boolean(userRow.phone_verified_at);

    if (hasOdesaNumber && hasVerifiedPhone) {
      redirect('/today');
    }

    if (
      hasOdesaNumber &&
      !hasVerifiedPhone &&
      currentPath !== VERIFY_PHONE_PATH
    ) {
      redirect(VERIFY_PHONE_PATH);
    }
  }

  return (
    <div
      className='min-h-screen flex items-center justify-center bg-background p-6'
      data-testid='onboarding-shell'
    >
      <AuthPanel
        eyebrow='Odesa setup'
        title='Get your portfolio online'
        description='Add your first property, lease, and messaging line — about 2 minutes.'
      >
        {children}
      </AuthPanel>
    </div>
  );
}
