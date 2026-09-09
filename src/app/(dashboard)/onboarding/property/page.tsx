import { createPropertyAction } from '../actions';
import { OnboardingProgressIndicator } from '../progress-indicator';
import { PropertyForm } from './property-form';

export const dynamic = 'force-dynamic';

export default function OnboardingPropertyPage() {
  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-property'>
      <OnboardingProgressIndicator step={1} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>
          Add your first property
        </h2>
        <p className='text-sm text-muted-foreground'>
          Start with the building you manage most closely. You can add
          more later.
        </p>
      </div>
      <PropertyForm action={createPropertyAction} />
    </div>
  );
}
