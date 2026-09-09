import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createTenantAction } from '../actions';
import { OnboardingProgressIndicator } from '../progress-indicator';
import { TenantForm } from './tenant-form';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ unitId?: string }>;
}

export default async function OnboardingTenantPage({ searchParams }: Props) {
  const params = await searchParams;
  let unitId = params.unitId;

  // Resume path: hydrate from the most-recent unit.
  if (!unitId) {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from('units')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      redirect('/onboarding/property');
    }
    unitId = data.id;
  }

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-tenant'>
      <OnboardingProgressIndicator step={3} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>
          Add your first tenant
        </h2>
        <p className='text-sm text-muted-foreground'>
          Phone number is how Odesa routes inbound calls and texts to
          the right lease. US numbers only in v1.
        </p>
      </div>
      <TenantForm unitId={unitId} action={createTenantAction} />
    </div>
  );
}
