/**
 * Shared types for the vendors tab.
 */

export const VENDOR_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'landscaping',
  'general',
  'pest',
  'roof',
  'cleaning',
  'locksmith',
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
