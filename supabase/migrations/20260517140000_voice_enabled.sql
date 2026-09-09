-- Voice opt-in column for explicit Retell consent per-org.
-- T2a built the onboarding/settings UX against this column; T2c's Retell
-- tools currently gate on odesa_phone_number presence — when we later
-- gate Retell dispatch on voice_enabled, tenants whose org hasn't opted in
-- will fall back to SMS even with a number assigned.

ALTER TABLE organizations
  ADD COLUMN voice_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.voice_enabled IS
  'Whether the org has explicitly opted into Retell voice. Defaults false; set via /onboarding/voice or /settings.';
