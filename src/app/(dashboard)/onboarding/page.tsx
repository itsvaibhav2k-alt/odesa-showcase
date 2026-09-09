import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Onboarding entry point. Route the user to the furthest-right step
 * they haven't completed yet so partial progress always resumes
 * where it left off.
 *
 * Resolution order (first row-present wins the "next step" slot):
 *
 *   no property                         → /onboarding/property
 *   property, no unit                   → /onboarding/unit?propertyId=...
 *   unit, no tenant                     → /onboarding/tenant?unitId=...
 *   tenant, no lease                    → /onboarding/lease?unitId=...&tenantId=...
 *   lease, no odesa_phone_number        → /onboarding/messaging
 *   messaging complete                  → layout redirects to /today
 */

export const dynamic = 'force-dynamic';

export default async function OnboardingIndexPage() {
  const supabase = await createServerClient();

  // Check progress via one round-trip per table — still cheap (tables
  // are tiny for a new org) and keeps the redirect logic transparent.
  const { data: property } = await supabase
    .from('properties')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (!property) {
    redirect('/onboarding/property');
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id, property_id')
    .limit(1)
    .maybeSingle();

  if (!unit) {
    redirect(`/onboarding/unit?propertyId=${property.id}`);
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (!tenant) {
    redirect(`/onboarding/tenant?unitId=${unit.id}`);
  }

  const { data: lease } = await supabase
    .from('leases')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (!lease) {
    redirect(`/onboarding/lease?unitId=${unit.id}&tenantId=${tenant.id}`);
  }

  // Lease present — operator still needs to land on the messaging step
  // unless their org already has an odesa_phone_number assigned (the
  // layout will then forward them straight to /today).
  redirect('/onboarding/messaging');
}
