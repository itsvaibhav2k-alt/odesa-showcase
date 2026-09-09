/**
 * Settings → Import (Wave 7 Stream C).
 *
 * Server component that gates auth then renders a single client form
 * (`ImportForm`) for uploading a CSV from a competitor (AppFolio,
 * Buildium, RentRedi, or Generic).
 *
 * The form is two-step:
 *   1. Upload + Preview → POSTs to `/api/import/csv` and renders a
 *      dry-run summary (counts of would-insert / would-skip per table).
 *   2. Apply → POSTs to `/api/import/commit` to perform the actual
 *      INSERTs in dependency order.
 *
 * Re-running step 2 on the same CSV is a no-op — the dedup logic in
 * `lib/import/diff` tags every previously-imported row as `will_skip`.
 */

import { redirect } from 'next/navigation';

import { PageContainer, PageHeader, PageSection } from '@/components/shared';
import { createServerClient } from '@/lib/supabase/server';

import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: currentRole } = await supabase.rpc('current_user_role');
  if (currentRole === 'va') redirect('/today');

  return (
    <PageContainer width="default" className="!gap-24" data-testid="import-page">
      <PageHeader
        eyebrow="Settings"
        title="Import."
        description="Migrate your portfolio from AppFolio, Buildium, RentRedi, or a hand-built spreadsheet. Preview before you apply — re-running on the same file is a no-op."
      />

      <PageSection
        eyebrow="Section 1"
        title="Upload your CSV"
        data-testid="import-section-upload"
      >
        <ImportForm />
      </PageSection>
    </PageContainer>
  );
}
