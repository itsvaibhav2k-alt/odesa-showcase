export const ACCOUNTANT_CAPABILITY_CEILING = [
  'view_dashboard',
  'view_rent',
  'view_financials',
  'view_documents',
  'export_financials',
] as const;

export type AccountantCapability =
  (typeof ACCOUNTANT_CAPABILITY_CEILING)[number];

const ACCOUNTANT_CAPABILITIES = new Set<string>(
  ACCOUNTANT_CAPABILITY_CEILING,
);

export function isAccountantCapability(
  value: unknown,
): value is AccountantCapability {
  return typeof value === 'string' && ACCOUNTANT_CAPABILITIES.has(value);
}

export interface AccountantCapabilityOverride {
  capability: unknown;
  effect: unknown;
}

/**
 * Resolve only inside the immutable Accountant ceiling. Explicit denial is
 * dominant and order-independent; malformed or out-of-ceiling allows fail
 * closed. The shared access policy and SQL capability helper must mirror this
 * contract after the Manager foundation is reconciled.
 */
export function resolveAccountantCapabilities(
  preset: Iterable<unknown>,
  overrides: readonly AccountantCapabilityOverride[],
): Set<AccountantCapability> {
  const enabled = new Set<AccountantCapability>();
  const denied = new Set<AccountantCapability>();

  for (const capability of preset) {
    if (isAccountantCapability(capability)) enabled.add(capability);
  }
  for (const override of overrides) {
    if (!isAccountantCapability(override.capability)) continue;
    if (override.effect === 'deny') {
      denied.add(override.capability);
    } else if (override.effect === 'allow') {
      enabled.add(override.capability);
    }
  }

  return new Set(
    ACCOUNTANT_CAPABILITY_CEILING.filter(
      (capability) => enabled.has(capability) && !denied.has(capability),
    ),
  );
}
