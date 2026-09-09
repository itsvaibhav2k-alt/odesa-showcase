import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createUnitAction } from '../actions';
import { OnboardingProgressIndicator } from '../progress-indicator';
import { UnitForm } from './unit-form';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ propertyId?: string }>;
}

export default async function OnboardingUnitPage({ searchParams }: Props) {
  const params = await searchParams;
  let propertyId = params.propertyId;

  // Resume path: no propertyId in the URL. Look up the org's most-
  // recent property and hydrate it rather than bouncing the user back.
  if (!propertyId) {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from('properties')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      redirect('/onboarding/property');
    }
    propertyId = data.id;
  }

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-unit'>
      <OnboardingProgressIndicator step={2} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>Add a unit</h2>
        <p className='text-sm text-muted-foreground'>
          One unit at a time — we just need something representative
          to wire up your first tenant and lease.
        </p>
      </div>
      <UnitForm propertyId={propertyId} action={createUnitAction} />
    </div>
  );
}
