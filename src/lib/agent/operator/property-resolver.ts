/**
 * Property name resolver — used by all 5 MCPs to map a model-supplied
 * `propertyName` string to a concrete `PropertySummary` from the already-
 * loaded `OrganizationContext.properties`.
 *
 * No DB access. Operates entirely on the in-memory list so resolution
 * is synchronous and fast. The dispatcher loads the list once per turn;
 * MCPs receive it via their factory args.
 *
 * Generalised from the substring-match logic in
 * `handle-operator-inbound.ts:248-284` (`disambiguateProperty`).
 *
 * Privacy note: callers pass the name the MODEL provided — a human-
 * readable substring, never a UUID. Resolution to `PropertySummary.id`
 * happens server-side, inside the MCP handler, and never travels back
 * to the model.
 */

import type { PropertySummary } from './org-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { kind: 'unique'; property: PropertySummary }
  | { kind: 'multiple'; matches: PropertySummary[] }
  | { kind: 'none' };

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring match of `name` against each property's
 * `name` field. Returns:
 * - `{ kind: 'unique', property }` when exactly one property matches.
 * - `{ kind: 'multiple', matches }` when two or more match.
 * - `{ kind: 'none' }` when no property matches.
 *
 * MCPs should convert `multiple` and `none` into a model-readable
 * clarification string so the model can ask the operator which property
 * they meant.
 *
 * @param properties - The org's property list from `OrganizationContext`.
 * @param name       - Raw string from the model's tool input.
 */
export function resolvePropertyName(
  properties: PropertySummary[],
  name: string,
): ResolveResult {
  const needle = name.trim().toLowerCase();
  if (needle === '') {
    return { kind: 'none' };
  }

  const matches = properties.filter((p) =>
    p.name.toLowerCase().includes(needle),
  );

  if (matches.length === 1) {
    return { kind: 'unique', property: matches[0] };
  }
  if (matches.length > 1) {
    return { kind: 'multiple', matches };
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// MCP helper — turn a non-unique result into a user-facing string
// ---------------------------------------------------------------------------

/**
 * Produce a model-readable error/clarification string for `multiple` and
 * `none` results. MCP handlers can `return resolveErrorText(result, name)`
 * as their tool output to let the model recover (ask the operator or
 * confirm which property they meant).
 */
export function resolveErrorText(result: ResolveResult, name: string): string {
  if (result.kind === 'none') {
    return `No property found matching "${name}". Please clarify the property name.`;
  }
  if (result.kind === 'multiple') {
    const names = result.matches.map((p) => `"${p.name}"`).join(', ');
    return `Multiple properties match "${name}": ${names}. Please specify which one you mean.`;
  }
  // 'unique' — should not be called for this case
  return '';
}
