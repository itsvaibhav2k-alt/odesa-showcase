import { describe, expect, it } from 'vitest';

import { deriveIdempotencyKey } from '../retell-auth';

/**
 * The idempotency key is the safety net that stops a Retell retry from
 * duplicating a work order / SMS / escalation. It MUST be deterministic for
 * the same logical invocation and MUST NOT collide across different calls,
 * tools, or arguments — including when the LLM serializes the same args with
 * a different key order.
 */
describe('deriveIdempotencyKey', () => {
  const CALL = 'call_abc';
  const ARGS = { description: 'leak under sink', category: 'plumbing', urgency: 'routine' };

  it('is deterministic for identical inputs', () => {
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).toBe(
      deriveIdempotencyKey(CALL, 'create_work_order', ARGS),
    );
  });

  it('is stable regardless of argument key order', () => {
    const reordered = { urgency: 'routine', category: 'plumbing', description: 'leak under sink' };
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).toBe(
      deriveIdempotencyKey(CALL, 'create_work_order', reordered),
    );
  });

  it('differs when the call id differs', () => {
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).not.toBe(
      deriveIdempotencyKey('call_xyz', 'create_work_order', ARGS),
    );
  });

  it('differs when the tool name differs', () => {
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).not.toBe(
      deriveIdempotencyKey(CALL, 'escalate_to_landlord', ARGS),
    );
  });

  it('differs when any argument value differs', () => {
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).not.toBe(
      deriveIdempotencyKey(CALL, 'create_work_order', { ...ARGS, urgency: 'emergency' }),
    );
  });

  it('produces a lowercase hex sha256 digest', () => {
    expect(deriveIdempotencyKey(CALL, 'create_work_order', ARGS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty and nested args without throwing', () => {
    expect(deriveIdempotencyKey(CALL, 'get_rent_status', {})).toMatch(/^[0-9a-f]{64}$/);
    expect(
      deriveIdempotencyKey(CALL, 'create_work_order', { nested: { a: [1, 2], b: null } }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
