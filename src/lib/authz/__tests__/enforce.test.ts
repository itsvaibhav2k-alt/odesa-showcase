import { describe, expect, it } from 'vitest';

import type { AccessContext } from '../context';
import {
  accessContextAllowsRoute,
  accessAllows,
  propertyInScope,
  scopeQueryPropertyIds,
} from '../enforce';

function context(
  overrides: Partial<AccessContext> = {},
): AccessContext {
  return {
    userId: 'user-1',
    membershipId: 'membership-1',
    organizationId: 'org-1',
    role: 'manager',
    capabilities: new Set(['view_properties', 'manage_work_orders']),
    propertyScope: ['property-a'],
    ...overrides,
  };
}

describe('authz/enforce', () => {
  it('treats all-properties as explicit and never infers it from an empty list', () => {
    expect(propertyInScope('all', 'property-z')).toBe(true);
    expect(propertyInScope([], 'property-z')).toBe(false);
    expect(propertyInScope(['property-a'], 'property-z')).toBe(false);
  });

  it('matches only exact non-empty property ids', () => {
    expect(propertyInScope(['property-a'], 'property-a')).toBe(true);
    expect(propertyInScope(['property-a'], '')).toBe(false);
    expect(propertyInScope(['property-a'], null)).toBe(false);
    expect(propertyInScope(['property-a'], undefined)).toBe(false);
  });

  it('requires both capability and property scope when a property is supplied', () => {
    const access = context();

    expect(accessAllows(access, 'manage_work_orders', 'property-a')).toBe(true);
    expect(accessAllows(access, 'manage_work_orders', 'property-b')).toBe(false);
    expect(accessAllows(access, 'record_payment', 'property-a')).toBe(false);
  });

  it('requires the capability even when no property dimension applies', () => {
    const access = context();

    expect(accessAllows(access, 'view_properties')).toBe(true);
    expect(accessAllows(access, 'manage_team_access')).toBe(false);
  });

  it('returns a defensive copy of explicit scope for query builders', () => {
    const ids = ['property-b', 'property-a', 'property-b'];
    const normalized = scopeQueryPropertyIds(ids);

    expect(normalized).toEqual(['property-a', 'property-b']);
    expect(normalized).not.toBe(ids);
    expect(scopeQueryPropertyIds([])).toEqual([]);
    expect(scopeQueryPropertyIds('all')).toBeNull();
  });

  it('gates routes from effective capabilities and fails closed for unknown paths', () => {
    const access = context();

    expect(accessContextAllowsRoute(access, '/properties/property-a')).toBe(true);
    expect(accessContextAllowsRoute(access, '/work-orders')).toBe(false);
    expect(accessContextAllowsRoute(access, '/properties/property-a/chat')).toBe(false);
    expect(accessContextAllowsRoute(access, '/not-a-route')).toBe(false);
    expect(
      accessContextAllowsRoute(
        context({ capabilities: new Set(['view_assistant']) }),
        '/properties/property-a/chat',
      ),
    ).toBe(true);
  });
});
