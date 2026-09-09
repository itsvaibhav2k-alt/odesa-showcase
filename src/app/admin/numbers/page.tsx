/**
 * Admin — Phone Number Pool top-up.
 *
 * Allows Odesa operators (listed in ADMIN_EMAILS) to add new Sendblue
 * numbers to the shared pool. Numbers must first be purchased in the
 * Sendblue dashboard, then pasted here in E.164 format.
 *
 * Auth: requires an authenticated Supabase session AND the user's email
 * must be in the ADMIN_EMAILS env var. Returns 403 otherwise.
 *
 * T2b (2026-05-17): created for pool-based provisioning v1.
 */

import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { countAvailableNumbers } from '@/lib/messaging/provisioning';
import { PoolTopUpForm } from './pool-top-up-form';
import { addPoolNumbersAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminNumbersPage() {
  // Auth check: must be logged in and in ADMIN_EMAILS list.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    notFound();
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmails.includes(user.email.toLowerCase())) {
    notFound();
  }

  // Load current pool count.
  const admin = createAdminClient();
  const countResult = await countAvailableNumbers(admin);
  const availableCount = countResult.ok ? countResult.count : 0;

  // Load full pool for the view table.
  const { data: poolRows } = await admin
    .from('sendblue_number_pool')
    .select('id, e164, status, assigned_to_organization_id, assigned_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <main className='mx-auto max-w-2xl px-4 py-10 space-y-8' data-testid='admin-numbers-page'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>Phone number pool</h1>
        <p className='text-sm text-muted-foreground'>
          Legacy Sendblue pool (deprecated for V1). Numbers here are
          assigned automatically to new organizations during onboarding.
        </p>
      </div>

      <PoolTopUpForm
        addNumbers={addPoolNumbersAction}
        availableCount={availableCount}
      />

      {/* Pool table — read-only view of all rows */}
      {poolRows && poolRows.length > 0 && (
        <div className='space-y-2' data-testid='admin-pool-table'>
          <h2 className='text-base font-medium'>All pool numbers ({poolRows.length})</h2>
          <div className='rounded-md border overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b bg-muted/50'>
                  <th className='px-3 py-2 text-left font-medium text-muted-foreground'>E.164</th>
                  <th className='px-3 py-2 text-left font-medium text-muted-foreground'>Status</th>
                  <th className='px-3 py-2 text-left font-medium text-muted-foreground'>Assigned to org</th>
                  <th className='px-3 py-2 text-left font-medium text-muted-foreground'>Added</th>
                </tr>
              </thead>
              <tbody>
                {poolRows.map((row) => (
                  <tr key={row.id} className='border-b last:border-0'>
                    <td className='px-3 py-2 font-mono'>{row.e164}</td>
                    <td className='px-3 py-2'>
                      <span
                        className={[
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          row.status === 'available'
                            ? 'bg-green-50 text-green-700'
                            : row.status === 'assigned'
              ? 'bg-blue-50 text-blue-700'
                            : 'bg-muted text-muted-foreground',
                        ].join(' ')}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className='px-3 py-2 font-mono text-xs text-muted-foreground'>
                      {row.assigned_to_organization_id ?? '—'}
                    </td>
                    <td className='px-3 py-2 text-muted-foreground'>
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {poolRows && poolRows.length === 0 && (
        <p className='text-sm text-muted-foreground' data-testid='admin-pool-empty'>
          No numbers in the pool yet. Add some above.
        </p>
      )}
    </main>
  );
}
