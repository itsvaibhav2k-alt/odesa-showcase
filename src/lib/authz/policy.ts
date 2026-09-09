/**
 * Role→capability policy for sensitive (money / tenant-facing / lease) writes.
 *
 * Binding matrix (conservative until product says otherwise): ONLY the
 * 'owner' role may exercise a sensitive capability. 'manager' and 'va' are
 * read + draft-prep roles; a missing or unknown role fails CLOSED. UI hiding
 * is not authorization — every sensitive server surface must check `can()`
 * before its first write.
 *
 * Pure and dependency-free so it is trivially unit-testable and importable
 * from server actions, API routes, and tests alike.
 */

export type SensitiveCapability =
  | 'record_payment'
  | 'waive_balance'
  | 'change_lease_terms'
  | 'approve_tenant_message'
  | 'approve_payment_request'
  | 'approve_vendor_dispatch'
  | 'import_portfolio'
  | 'mutate_work_order';

/**
 * The stable caller-visible message every surface returns on a role denial.
 * Matches the existing cross-org denial copy so a denial never leaks whether
 * the target row exists or why exactly access was refused.
 */
export const FORBIDDEN_MESSAGE = 'Forbidden';

/**
 * True iff `role` may exercise `capability`. Owner ⇒ true for every
 * capabilities; anything else (manager, va, null, undefined, garbage) ⇒
 * false. Fail closed: an unknown role is a denial, never a pass.
 */
export function can(
  role: string | null | undefined,
  capability: SensitiveCapability,
): boolean {
  void capability; // owner-only for ALL capabilities today; param keeps call sites honest.
  return role === 'owner';
}

/**
 * Who is invoking a shared commit primitive.
 *
 * `system` = autonomy pipeline / worker / Inngest paths, which own their own
 * gate (gate_decision) — the role gate does not apply. `user` = any
 * authenticated human-driven surface; `role` comes from `public.users.role`
 * and a null/unknown role fails CLOSED on sensitive commits.
 */
export type CommitActor =
  | { kind: 'system' }
  | { kind: 'user'; role: string | null };

/**
 * True iff `actor` may NOT commit a proposal of `actionType`. System actors
 * are never role-blocked; user actors are blocked when the action_type maps
 * to a sensitive capability their role lacks (fail closed).
 */
export function commitActorForbidden(
  actor: CommitActor,
  actionType: string | null | undefined,
): boolean {
  if (actor.kind !== 'user') return false;
  const capability = proposalCommitCapability(actionType);
  return capability !== null && !can(actor.role, capability);
}

/**
 * Sensitive capability required to COMMIT an `action_proposals` row of the
 * given `action_type`, or null when the commit is an internal record
 * (health_flag, voice_call_review, rulebook, property/unit/tenant data, …)
 * that any org member may record. Shared by /owner-queue, /review, and the
 * inbox proposal-approval path so the mapping can never drift per surface.
 */
export function proposalCommitCapability(
  actionType: string | null | undefined,
): SensitiveCapability | null {
  switch (actionType) {
    case 'draft_sms_reply':
    case 'send_tenant_message':
      return 'approve_tenant_message';
    case 'request_rent_payment':
      return 'approve_payment_request';
    case 'dispatch_vendor':
      return 'approve_vendor_dispatch';
    case 'set_lease_terms':
    case 'update_rent':
      return 'change_lease_terms';
    case 'waive_rent':
      return 'waive_balance';
    default:
      return null;
  }
}
