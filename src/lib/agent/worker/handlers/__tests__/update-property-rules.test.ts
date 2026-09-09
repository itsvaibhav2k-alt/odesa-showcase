/**
 * Unit tests for handleUpdatePropertyRules.
 *
 * Covers: happy path with propertyId, idempotent no-op when rules
 * unchanged, name resolution path, ambiguous property error, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleUpdatePropertyRules } from '../update-property-rules';
import { ORG_ID, PROPERTY_ID, makeAdmin } from './__helpers';

const NEW_RULES = 'No pets after 10pm. Quiet hours 9pm-7am.';

describe('handleUpdatePropertyRules', () => {
  it('updates rules_text when propertyRef is propertyId', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: { id: PROPERTY_ID }, error: null }, // verify
        { data: { id: PROPERTY_ID, name: 'Vaba', rules_text: 'old rules' }, error: null }, // current
        { data: { id: PROPERTY_ID, name: 'Vaba', rules_text: NEW_RULES }, error: null }, // update
      ],
    });

    const result = await handleUpdatePropertyRules({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        rulesText: NEW_RULES,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.idempotent).toBeUndefined();

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toEqual({ rules_text: NEW_RULES });
  });

  it('returns idempotent: true when rules_text already matches', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: { id: PROPERTY_ID }, error: null },
        { data: { id: PROPERTY_ID, name: 'Vaba', rules_text: NEW_RULES }, error: null },
      ],
    });

    const result = await handleUpdatePropertyRules({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        rulesText: NEW_RULES,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    // No update call.
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('rejects rules_text > 4000 chars', async () => {
    const { admin } = makeAdmin({});
    const result = await handleUpdatePropertyRules({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        rulesText: 'x'.repeat(4001),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('exceeds');
  });

  it('returns ambiguous_property when name matches multiple', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'p1' }, { id: 'p2' }], error: null }],
    });

    const result = await handleUpdatePropertyRules({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyName: 'house' },
        rulesText: NEW_RULES,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_property');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every property query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: { id: PROPERTY_ID }, error: null },
        { data: { id: PROPERTY_ID, name: 'Vaba', rules_text: 'old' }, error: null },
        { data: { id: PROPERTY_ID, name: 'Vaba', rules_text: NEW_RULES }, error: null },
      ],
    });

    await handleUpdatePropertyRules({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        rulesText: NEW_RULES,
      },
    });

    for (const call of calls) {
      expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
    }
  });
});
