/**
 * Settings → Integrations (Phase 5 + v1.8 Messaging card).
 *
 * Three operator-onboarding cards plus the Poke setup walkthrough:
 *
 *   1. Personal phone — shows the operator's stored `users.phone_e164`
 *      + verified status; embeds `PhoneVerificationCard` if unverified.
 *      Without a verified phone, the inbound Linq router can't match
 *      the operator → tenant flow runs instead.
 *
 *   2. Tenant messaging — mirrors the onboarding messaging step so an
 *      operator can change their assistant name post-onboarding and
 *      retest the wiring (assigned number is read-only; pool sourced).
 *
 *   3. Poke MCP integration — shows the public MCP SSE URL, lists
 *      existing keys (label, prefix, last_used_at, Revoke button),
 *      offers a "Generate Poke key" button that returns the plaintext
 *      via the `ApiKeyDisplay` modal.
 *
 *   4. PokeSetupCard — static instructions for pasting the URL +
 *      key into Poke.
 *
 * This is a Server Component. Interactive bits are isolated in client
 * components (`PhoneVerificationCard`, `IntegrationsKeysCard`,
 * `MessagingCard`).
 */

import { redirect } from 'next/navigation';

import { PageContainer, PageHeader, PageSection } from '@/components/shared';
import { createServerClient } from '@/lib/supabase/server';
import { GoogleCalendarCard } from '@/components/settings/google-calendar-card';
import { IntegrationsKeysCard } from '@/components/settings/integrations-keys-card';
import { MessagingCard } from '@/components/settings/messaging-card';
import { PersonalPhoneCard } from '@/components/settings/personal-phone-card';
import { PokeSetupCard } from '@/components/settings/poke-setup-card';
import { DEFAULT_ASSISTANT_NAME } from '@/app/(dashboard)/onboarding/messaging/constants';

export const dynamic = 'force-dynamic';

export interface ApiKeyRow {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface IntegrationsPageProps {
  searchParams: Promise<{
    google_calendar?: string;
    reason?: string;
  }>;
}

export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  const params = await searchParams;
  const googleCalendarStatus = params.google_calendar ?? null;
  const googleCalendarReason = params.reason ?? null;

  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('id, organization_id, phone_e164, phone_verified_at, role')
    .eq('id', user.id)
    .single();
  if (userRow?.role === 'va') redirect('/today');

  const { data: orgRow } = userRow
    ? await supabase
        .from('organizations')
        .select('odesa_phone_number, assistant_name')
        .eq('id', userRow.organization_id)
        .single()
    : { data: null };

  const { data: keyRows } = await supabase
    .from('mcp_api_keys')
    .select('id, label, key_prefix, last_used_at, created_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  // Per-user google_calendar OAuth row (RLS scopes to auth.uid()).
  const { data: googleRow } = await supabase
    .from('oauth_tokens')
    .select('account_email')
    .eq('user_id', user.id)
    .eq('provider', 'google_calendar')
    .maybeSingle();

  const keys: ApiKeyRow[] = (keyRows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    prefix: row.key_prefix,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));

  const mcpPublicUrl = process.env.MCP_PUBLIC_URL ?? '';
  const mcpSseUrl = mcpPublicUrl
    ? `${mcpPublicUrl.replace(/\/$/, '')}/api/mcp/sse`
    : '/api/mcp/sse';

  return (
    // !gap-24 mirrors the 96px section rhythm used on /settings.
    <PageContainer width="default" className="!gap-24" data-testid="integrations-page">
      <PageHeader
        eyebrow="Settings"
        title="Integrations."
        description="Connect Odesa to your phone and Poke so you can text the property agent from anywhere."
      />

      <PageSection
        eyebrow="Section 1"
        title="Personal phone"
        data-testid="integrations-section-phone"
      >
        <PersonalPhoneCard
          phoneE164={userRow?.phone_e164 ?? null}
          verifiedAt={userRow?.phone_verified_at ?? null}
        />
      </PageSection>

      <PageSection
        eyebrow="Section 2"
        title="Tenant messaging"
        data-testid="integrations-section-messaging"
      >
        <MessagingCard
          assignedNumber={orgRow?.odesa_phone_number ?? null}
          assistantName={orgRow?.assistant_name ?? DEFAULT_ASSISTANT_NAME}
          hasVerifiedPhone={Boolean(
            userRow?.phone_e164 && userRow?.phone_verified_at,
          )}
        />
      </PageSection>

      <PageSection
        eyebrow="Section 3"
        title="Google Calendar"
        data-testid="integrations-section-google-calendar"
      >
        <GoogleCalendarCard
          connectedEmail={googleRow?.account_email ?? null}
          errorReason={
            googleCalendarStatus === 'error' ? googleCalendarReason : null
          }
          justConnected={googleCalendarStatus === 'connected'}
        />
      </PageSection>

      <PageSection
        eyebrow="Section 4"
        title="Poke MCP integration"
        data-testid="integrations-section-mcp"
      >
        <IntegrationsKeysCard mcpSseUrl={mcpSseUrl} keys={keys} />
        <PokeSetupCard mcpUrl={mcpSseUrl} />
      </PageSection>
    </PageContainer>
  );
}
