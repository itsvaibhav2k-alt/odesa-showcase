/**
 * Demo-safe display normalization.
 *
 * Converts seeded demo/test artifacts into credible, client-facing labels
 * at the DISPLAY boundary only. These helpers exist so the dashboard never
 * shows raw "(demo)" suffixes, obvious e2e/test users, or placeholder
 * tenant names to a real owner.
 *
 * SCOPE (critical): the returned strings are for human eyes only. Never use
 * a normalized value as a lookup key, ID, query predicate, join condition,
 * or financial-aggregation key — that would silently change data identity.
 * Normalize a name/label exactly at the point it becomes a display string.
 */

/** Trailing "(demo)" / "(test)" suffix, with optional surrounding space. */
const DEMO_SUFFIX = /\s*\((?:demo|test)\)\s*$/i;

/**
 * Known seeded demo tenants → credible names. These deliberately avoid
 * colliding with real Galaxy tenants: Oakwood already has a Marcus Alvarez,
 * so the demo "Alvarez" maps to a distinct given name ("Nora") rather than
 * another Alvarez household. Keyed on the legacy seeded `full_name` so the
 * mapping still fixes pre-existing cloud rows; freshly re-seeded rows already
 * carry the credible name and fall through unchanged.
 */
const KNOWN_TENANT_NAMES: Readonly<Record<string, string>> = {
  'Demo Tenant Alvarez (demo)': 'Nora Alvarez',
  'Demo Tenant Okafor (demo)': 'Grace Okafor',
};

/**
 * Returns a client-safe display name for a tenant/person.
 *
 * Maps known demo tenants to credible names, otherwise strips a trailing
 * "(demo)"/"(test)" suffix. Returns the input unchanged when there is
 * nothing to normalize.
 *
 * @param raw - The raw `full_name` value from the database.
 * @returns The display name (never used as a key — display only).
 *
 * @example
 * displayName('Demo Tenant Alvarez (demo)'); // 'Nora Alvarez'
 * displayName('Marcus Alvarez (demo)');       // 'Marcus Alvarez'
 * displayName('Marcus Alvarez');              // 'Marcus Alvarez'
 */
export function displayName(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const mapped = KNOWN_TENANT_NAMES[trimmed];
  if (mapped) return mapped;
  return trimmed.replace(DEMO_SUFFIX, '').trim();
}

/**
 * Returns a client-safe display label for a unit.
 *
 * Strips a trailing "(demo)"/"(test)" suffix. Returns the input unchanged
 * when there is nothing to normalize.
 *
 * @param raw - The raw `units.label` value from the database.
 * @returns The display label (display only — never a lookup key).
 *
 * @example
 * displayUnitLabel('D1 (demo)'); // 'D1'
 * displayUnitLabel('201');       // '201'
 */
export function displayUnitLabel(raw: string): string {
  if (!raw) return raw;
  return raw.trim().replace(DEMO_SUFFIX, '').trim();
}

/** Minimal shape needed to decide team-member visibility. */
export interface ClientVisibleTeamMemberInput {
  fullName?: string | null;
  email?: string | null;
}

/**
 * Full-name patterns that only seeded/provisioned test users produce.
 * Kept deliberately narrow so we never hide the genuine client owner
 * (full name "Galaxy Owner") — only the demo/test/settings provisioned
 * owners and inbox-viewer fixtures match.
 */
const HIDDEN_NAME_PATTERNS: readonly RegExp[] = [
  /Galaxy (Demo|Test|Settings) Owner/i,
  /^Galaxy (Test|Demo)/i,
  /Inbox Viewer/i,
];

/**
 * Email patterns that belong to e2e/test harness users. Note this does NOT
 * include `galaxy-estates.test` — that domain hosts the genuine seeded
 * client owner (owner@galaxy-estates.test) and its manager/VA teammates.
 */
const HIDDEN_EMAIL_PATTERNS: readonly RegExp[] = [
  /galaxy-properties\.test$/i,
  /inbox\.test$/i,
  /@example\.(com|test)$/i,
];

/**
 * Detects timestamp-/uuid-style generated local parts (e.g.
 * `settings-owner.1749600000000.483921` or a raw uuid). Provisioning
 * helpers stamp `Date.now()` / random ids into the local part; real owners
 * use a human handle like `owner`.
 */
function hasGeneratedLocalPart(email: string): boolean {
  const at = email.indexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  // 8+ consecutive digits → epoch-ms timestamp or large random suffix.
  if (/\d{8,}/.test(local)) return true;
  // uuid-style hex grouping in the local part.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(local)) return true;
  return false;
}

/**
 * Decides whether a team member should be shown in the client-facing
 * Settings → Team list.
 *
 * Hides obvious e2e/test/provisioned users by explicit, narrow patterns.
 * When nothing matches, the member is kept visible — if unsure, show it.
 * The genuine seeded client owner (owner@galaxy-estates.test, "Galaxy
 * Owner") and its manager/VA always remain visible.
 *
 * @param member - The team member's display name + email.
 * @returns `true` when the member is client-visible, `false` to hide it.
 */
export function isClientVisibleTeamMember(
  member: ClientVisibleTeamMemberInput,
): boolean {
  const name = member.fullName?.trim() ?? '';
  const email = member.email?.trim() ?? '';

  if (name && HIDDEN_NAME_PATTERNS.some((re) => re.test(name))) {
    return false;
  }

  if (email) {
    if (HIDDEN_EMAIL_PATTERNS.some((re) => re.test(email))) return false;
    if (hasGeneratedLocalPart(email)) return false;
  }

  return true;
}
