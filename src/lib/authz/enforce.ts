import {
  requiredCapabilityForRoute,
  type Capability,
} from './access-policy';
import type { AccessContext, PropertyScope } from './context';

/**
 * Return whether an exact property id is included in an explicit scope.
 * An empty list is deliberately no access; only the `all` sentinel widens it.
 */
export function propertyInScope(
  scope: PropertyScope,
  propertyId: string | null | undefined,
): boolean {
  if (typeof propertyId !== 'string' || propertyId.length === 0) return false;
  return scope === 'all' || scope.includes(propertyId);
}

/**
 * Application-side counterpart to database RLS. Callers that operate on a
 * property must satisfy both independent dimensions: capability and scope.
 */
export function accessAllows(
  context: AccessContext,
  capability: Capability,
  propertyId?: string,
): boolean {
  if (!context.capabilities.has(capability)) return false;
  return propertyId === undefined
    ? true
    : propertyInScope(context.propertyScope, propertyId);
}

/**
 * Normalize explicit ids for query builders. `null` means an intentionally
 * all-properties context; `[]` must remain a deny-all query scope.
 */
export function scopeQueryPropertyIds(
  scope: PropertyScope,
): string[] | null {
  if (scope === 'all') return null;
  return [...new Set(scope.filter((id) => id.length > 0))].sort();
}

/** Server-layout route gate using the already-resolved effective capability set. */
export function accessContextAllowsRoute(
  context: AccessContext,
  pathname: string,
): boolean {
  const capability = requiredCapabilityForRoute(pathname);
  return capability !== null && context.capabilities.has(capability);
}
