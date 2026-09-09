/**
 * Settings — a single scrollable page with six sections (spec §11.4):
 *
 *   1. Odesa Phone Number
 *   2. Preferred Vendors
 *   3. Landlord Preferences
 *   4. Billing
 *   5. Team
 *   6. Operator Reliability (Phase 6 — real job/notification/worker health)
 *
 * No tabs, no modals. Each section is a Fraunces display-sm title plus
 * a card / table, separated by 96px of vertical whitespace so the
 * landlord scrolls through the org's whole operational surface in one
 * pass.
 *
 * No "Save" button anywhere — each field saves optimistically with the
 * 120ms `OptimisticSaveBadge` meta indicator. Vendor CRUD flows through
 * `actions.ts`; every other toggle is local-state only until its Phase
 * 4 / 6 / 8 backing column lands.
 *
 * Chrome is the warm operator shell (ListPageShell, no activeTab so the
 * portfolio tab bar is omitted); the inner PageSection cards are untouched
 * and keep their current look inside the `.today-theme` scope.
 *
 * This is a Server Component; the interactive cards (vendors table,
 * preferences, billing, team) are client components that hydrate from
 * the props we pass in here.
 */

import type { CSSProperties } from 'react';
import { redirect } from 'next/navigation';

import { PageSection } from '@/components/shared';
import { ListPageShell } from '@/components/properties/list/list-page-shell';
import type { BreadcrumbItem } from '@/components/properties/detail/detail-global-bar';
import { PhoneCard } from '@/components/settings/phone-card';
import { VendorsTable } from '@/components/settings/vendors-table';
import { PreferencesCard } from '@/components/settings/preferences-card';
import { BillingCard } from '@/components/settings/billing-card';
import { TeamCard } from '@/components/settings/team-card';
import { ReliabilityCard } from '@/components/settings/reliability-card';
import {
  getSettingsOrganization,
  getSettingsTeam,
  getSettingsVendors,
} from '@/lib/settings/queries';
import { getReliabilityStatus } from '@/lib/reliability/queries';
import { createServerClient } from '@/lib/supabase/server';
import { getTeamInviteStateAction } from './actions';

export const dynamic = 'force-dynamic';

const BREADCRUMB: BreadcrumbItem[] = [
  { label: 'Odesa', href: '/properties' },
  { label: 'Settings' },
];

// Replaces PageContainer's !gap-24 (96px) so the original section rhythm holds.
const sectionsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 96,
};

export default async function SettingsPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  if (currentRole === 'va') redirect('/today');

  const [org, vendors, team, reliability, inviteState] = await Promise.all([
    getSettingsOrganization(),
    getSettingsVendors(),
    getSettingsTeam(),
    getReliabilityStatus(),
    getTeamInviteStateAction(),
  ]);

  return (
    <ListPageShell
      breadcrumb={BREADCRUMB}
      eyebrow="Workspace"
      title="How Odesa works for you."
      titleMeta={['6 sections']}
    >
      <div data-testid="settings-page" style={sectionsStyle}>
        <PageSection
          eyebrow="Section 1"
          title="Odesa phone number"
          data-testid="settings-section-phone"
        >
          <PhoneCard
            odesaPhoneNumber={org?.odesaPhoneNumber ?? null}
            voiceEnabled={org?.voiceEnabled ?? null}
          />
        </PageSection>

        <PageSection
          eyebrow="Section 2"
          title="Preferred vendors"
          data-testid="settings-section-vendors"
        >
          <VendorsTable initialRows={vendors} />
        </PageSection>

        <PageSection
          eyebrow="Section 3"
          title="Landlord preferences"
          data-testid="settings-section-preferences"
        >
          <PreferencesCard />
        </PageSection>

        <PageSection
          eyebrow="Section 4"
          title="Billing"
          data-testid="settings-section-billing"
        >
          <BillingCard plan={org?.plan ?? 'starter'} />
        </PageSection>

        <PageSection
          eyebrow="Section 5"
          title="Team"
          data-testid="settings-section-team"
        >
          <TeamCard
            members={team}
            initialInviteState={
              inviteState.success
                ? inviteState.data
                : { canInvite: false, invitations: [], properties: [] }
            }
            initialError={inviteState.success ? null : inviteState.error}
          />
        </PageSection>

        <PageSection
          eyebrow="Section 6"
          title="Operator reliability"
          data-testid="settings-section-reliability"
        >
          <ReliabilityCard status={reliability} />
        </PageSection>
      </div>
    </ListPageShell>
  );
}
