/**
 * /calls — the Voice Operator Review Desk.
 *
 * Async server component (force-dynamic), RLS-scoped. Fetches today's activity
 * summary + the complete call register + voice settings, then hands them to
 * `CallsOverview` — a line-status band, a Today signal strip, and a full-width
 * operational call log. Each row opens a dedicated Call Review Studio. Configuration,
 * scripts, and test calls each live on their own route (`/calls/settings`,
 * `/calls/scripts`, `/calls/test`), reached from the line-status band. Chrome
 * comes from `ListPageShell`.
 *
 * The readiness strip reads server-only env, so it is rendered here and passed
 * to the client workspace as a slot — never imported across the client boundary.
 *
 * All readiness copy is truthfully "simulated / local" — no live Retell is
 * claimed anywhere on this landlord-facing page.
 */

import { ListPageShell } from "@/components/properties/list/list-page-shell";
import { CallsOverview } from "@/components/calls/calls-overview";
import { VoiceReadinessStrip } from "@/components/calls/voice-readiness-strip";
import { createServerClient } from "@/lib/supabase/server";
import { getVoiceCallActivity, listVoiceCalls } from "@/lib/voice/queries";
import { getVoiceSettings } from "@/lib/voice/settings";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc("current_user_role");
  const isVa = currentRole === "va";
  const isOwner = currentRole === "owner";
  const [activity, calls, voiceSettings] = await Promise.all([
    getVoiceCallActivity(supabase),
    listVoiceCalls(supabase),
    getVoiceSettings(supabase),
  ]);

  const meta = `${activity.callsToday} today · ${calls.length} recorded`;

  return (
    <ListPageShell
      breadcrumb={[
        { label: isVa ? "My shift" : "Today", href: "/today" },
        { label: "Calls" },
      ]}
      eyebrow={isVa ? "Shift call log" : "Voice operations"}
      title="Calls"
      titleMeta={[meta]}
      maxWidth={1600}
      background="var(--panel)"
    >
      <CallsOverview
        activity={activity}
        calls={calls}
        voiceSettings={voiceSettings}
        readinessSlot={<VoiceReadinessStrip voiceSettings={voiceSettings} />}
        readOnly={isVa}
        canUseAssistant={isOwner}
      />
    </ListPageShell>
  );
}
