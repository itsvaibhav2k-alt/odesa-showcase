/**
 * Vendor server-action input schemas.
 *
 * The Settings screen creates / updates / deletes vendors inline in a
 * table (no modal). These schemas enforce shape before we hit Supabase:
 * UUIDs, E.164 phone (optional on create — vendors Odesa never calls
 * can exist for reporting purposes), and the `work_order_category` enum.
 *
 * Kept free of DB / Supabase imports so the file can be unit-tested in
 * isolation.
 */

import { z } from 'zod/v4';

import type { WorkOrderCategory } from '@/types/database';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Full list of vendor categories; mirrors the `work_order_category` enum. */
export const VENDOR_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliances',
  'flooring',
  'painting',
  'landscaping',
  'security',
  'cleaning',
  'general',
  'other',
] as const satisfies readonly WorkOrderCategory[];

/**
 * Vendor phone — optional on create. When a landlord adds a vendor for
 * reporting only, they may not have a callable number yet. When present,
 * must normalise to E.164.
 */
const optionalPhone = z
  .union([
    z
      .string()
      .regex(/^\+?1?\d{10,15}$/, 'Phone must be in E.164 format (e.g. +15715551234)'),
    z.literal(''),
  ])
  .optional();

/** Vendor category — one of the `work_order_category` enum values. */
const categorySchema = z.enum(VENDOR_CATEGORIES);

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export const vendorCreateSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').max(200),
  category: categorySchema,
  phoneE164: optionalPhone,
});

export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = z.object({
  id: z.uuid('Invalid vendor id'),
  name: z.string().min(1, 'Vendor name is required').max(200),
  category: categorySchema,
  phoneE164: optionalPhone,
});

export type VendorUpdateInput = z.infer<typeof vendorUpdateSchema>;

export const vendorDeleteSchema = z.object({
  id: z.uuid('Invalid vendor id'),
});

export type VendorDeleteInput = z.infer<typeof vendorDeleteSchema>;

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a user-entered phone to strict E.164. Matches the
 * onboarding helper so two code paths stay consistent.
 *
 * Returns `null` for empty input so we can pass a clean `null` to the
 * DB column rather than the literal empty string.
 */
export function normalizeVendorPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** Human-readable label for a vendor category (Title Case). */
export function categoryLabel(category: WorkOrderCategory): string {
  switch (category) {
    case 'hvac':
      return 'HVAC';
    case 'general':
      return 'General';
    case 'other':
      return 'Other';
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}
