/**
 * Onboarding server-action input schemas.
 *
 * Each step's form posts a minimal, human-facing payload. These schemas
 * enforce shape + domain constraints (E.164 phone, 1-31 rent due day,
 * ISO date strings, 5 or 9-digit US ZIP, 2-letter state) before the
 * server action ever touches Supabase.
 *
 * Kept free of DB/Supabase imports so unit tests can exercise them in
 * isolation without a running Postgres.
 */

import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** US ZIP, 5 digits or 9-digit (ZIP+4) with optional hyphen. */
const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'ZIP must be 5 digits or 9 digits (12345 or 12345-6789)');

/** Two-letter US state code (uppercase). */
const stateSchema = z
  .string()
  .length(2, 'State must be the 2-letter abbreviation (e.g. VA)')
  .regex(/^[A-Z]{2}$/, 'State must be uppercase 2-letter abbreviation');

/**
 * E.164-ish phone. We accept US 10-digit with or without +1 and
 * normalise downstream. Internationally, 10-15 digits after the
 * leading +.
 */
const phoneSchema = z
  .string()
  .regex(/^\+?1?\d{10,15}$/, 'Phone must be in E.164 format (e.g. +15715551234)');

/** ISO-8601 date (YYYY-MM-DD). */
const dateSchema = z.iso.date();

/** Optional email: accepts valid email or empty string (treated as undefined). */
const optionalEmail = z
  .union([z.email('Email must be a valid address'), z.literal('')])
  .optional();

/** Optional ISO date: accepts valid YYYY-MM-DD or empty string. */
const optionalDate = z.union([dateSchema, z.literal('')]).optional();

// ---------------------------------------------------------------------------
// Step 1: Property
// ---------------------------------------------------------------------------

export const propertySchema = z.object({
  name: z.string().min(1, 'Property name is required').max(200),
  addressStreet: z.string().min(1, 'Street address is required').max(200),
  addressCity: z.string().min(1, 'City is required').max(100),
  addressState: stateSchema,
  addressZip: zipSchema,
  timezone: z.string().min(1).default('America/New_York'),
});

export type PropertyInput = z.infer<typeof propertySchema>;

// ---------------------------------------------------------------------------
// Step 2: Unit
// ---------------------------------------------------------------------------

export const unitSchema = z.object({
  propertyId: z.uuid('Invalid property id'),
  label: z.string().min(1, 'Unit label is required').max(50),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  bathrooms: z.coerce.number().min(0).max(20).optional(),
  squareFeet: z.coerce.number().int().min(0).max(20000).optional(),
});

export type UnitInput = z.infer<typeof unitSchema>;

// ---------------------------------------------------------------------------
// Step 3: Tenant
// ---------------------------------------------------------------------------

export const tenantSchema = z.object({
  fullName: z.string().min(1, 'Tenant name is required').max(200),
  phoneE164: phoneSchema,
  email: optionalEmail,
  dateOfBirth: optionalDate,
});

export type TenantInput = z.infer<typeof tenantSchema>;

// ---------------------------------------------------------------------------
// Step 4: Lease
// ---------------------------------------------------------------------------

export const leaseSchema = z
  .object({
    unitId: z.uuid('Invalid unit id'),
    tenantId: z.uuid('Invalid tenant id'),
    rentAmount: z.coerce.number().positive('Rent amount must be positive'),
    rentDueDay: z.coerce
      .number()
      .int('Rent due day must be a whole number')
      .min(1, 'Rent due day must be 1 or greater')
      .max(31, 'Rent due day must be 31 or less'),
    startDate: dateSchema,
    endDate: dateSchema,
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export type LeaseInput = z.infer<typeof leaseSchema>;

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a user-entered phone to strict E.164, or return null when the
 * input contains letters, has no digits, or cannot form an 8-15 digit E.164
 * identity. US 10-digit numbers receive the +1 country code.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[a-z]/i.test(trimmed) || /[^\d\s()+.\-]/.test(trimmed)) {
    return null;
  }
  const digits = raw.replace(/\D/g, '');
  const validNanp = (value: string) => /^[2-9]\d{2}[2-9]\d{6}$/.test(value);
  if (digits.length === 10 && validNanp(digits)) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1') && validNanp(digits.slice(1))) {
    return `+${digits}`;
  }
  if (digits.startsWith('1')) return null;
  if (trimmed.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}
