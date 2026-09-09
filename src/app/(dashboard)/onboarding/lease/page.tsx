import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createLeaseAction } from '../actions';
import { OnboardingProgressIndicator } from '../progress-indicator';
import { LeaseForm } from './lease-form';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ unitId?: string; tenantId?: string }>;
}

export default async function OnboardingLeasePage({ searchParams }: Props) {
  const params = await searchParams;
  let unitId = params.unitId;
  let tenantId = params.tenantId;

  if (!unitId || !tenantId) {
    const supabase = await createServerClient();
    const [unitRes, tenantRes] = await Promise.all([
      unitId
        ? Promise.resolve({ data: { id: unitId } as { id: string } | null })
        : supabase
            .from('units')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
      tenantId
        ? Promise.resolve({ data: { id: tenantId } as { id: string } | null })
        : supabase
            .from('tenants')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    if (!unitRes.data) {
      redirect('/onboarding/property');
    }
    if (!tenantRes.data) {
      redirect(`/onboarding/tenant?unitId=${unitRes.data.id}`);
    }
    unitId = unitRes.data.id;
    tenantId = tenantRes.data.id;
  }

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-lease'>
      <OnboardingProgressIndicator step={4} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>Set up the lease</h2>
        <p className='text-sm text-muted-foreground'>
          Odesa uses this to schedule rent reminders, due-day texts,
          and late-fee escalations.
        </p>
      </div>
      <LeaseForm
        unitId={unitId}
        tenantId={tenantId}
        action={createLeaseAction}
      />
    </div>
  );
}
