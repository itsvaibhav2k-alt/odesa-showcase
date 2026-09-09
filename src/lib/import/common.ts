/**
 * Shared parsing utilities for CSV importers (Wave 7 Stream C).
 *
 * These helpers are intentionally pure / synchronous so source-specific
 * mappers stay easy to test in isolation.  Every parser returns `null`
 * (not throws) on a soft failure so the mapper can decide whether to
 * skip the row or surface a warning.
 */

/** Strip everything but digits + leading `+` from a phone-ish string. */
function digitsOnly(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

/**
 * Normalize a phone number to E.164.  Today this only handles US numbers
 * (the only locale the importer is expected to see in the launch window),
 * but the shape leaves room for future locale resolution.
 *
 * Accepts:
 *   - "202-555-0101"        → "+12025550101"
 *   - "(202) 555-0101"      → "+12025550101"
 *   - "1-202-555-0101"      → "+12025550101"
 *   - "+12025550101"        → "+12025550101" (idempotent)
 *
 * Returns null if the input doesn't look like a US phone (so callers can
 * surface a clean per-row error in the importer preview).
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const stripped = digitsOnly(trimmed);
  if (!stripped) return null;

  // Already E.164 (+1XXXXXXXXXX).
  if (stripped.startsWith('+')) {
    if (/^\+1\d{10}$/.test(stripped)) return stripped;
    return null;
  }

  // Bare 10-digit: assume US.
  if (/^\d{10}$/.test(stripped)) return `+1${stripped}`;

  // 11-digit starting with `1`: US with country code.
  if (/^1\d{10}$/.test(stripped)) return `+${stripped}`;

  return null;
}

/**
 * Best-effort parse of a single-line postal address.  Recognizes the
 * common US shape "Street, City, ST 12345" (zip can be omitted).
 *
 * Returns null if the input doesn't look like an address (no commas).
 */
export function parseAddress(raw: string | null | undefined): {
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
} | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { street: parts[0], city: null, state: null, zip: null };
  }

  const street = parts[0];
  const city = parts.length >= 2 ? parts[1] : null;

  let state: string | null = null;
  let zip: string | null = null;
  if (parts.length >= 3) {
    const stateZip = parts[2].trim();
    const match = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      state = match[1].toUpperCase();
      zip = match[2];
    } else {
      state = stateZip;
    }
  }

  return { street, city, state, zip };
}

/**
 * Parse a date string into ISO `YYYY-MM-DD`.  Accepts:
 *   - "2026-05-08"           (ISO already)
 *   - "5/8/2026"  / "05/08/2026"  (US m/d/yyyy)
 *   - "2026/05/08"           (yyyy/m/d)
 *   - "May 8, 2026"          (long form — falls through to Date parse)
 *
 * Returns null on parse failure.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already ISO date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // m/d/yyyy or mm/dd/yyyy.
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    return `${usMatch[3]}-${month}-${day}`;
  }

  // yyyy/m/d.
  const isoSlash = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlash) {
    const month = isoSlash[2].padStart(2, '0');
    const day = isoSlash[3].padStart(2, '0');
    return `${isoSlash[1]}-${month}-${day}`;
  }

  // Long-form fallback. Date.parse handles "May 8, 2026" etc.
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a currency string into integer cents.
 *
 *   "$1,800.00"   → 180000
 *   "1800"        → 180000
 *   "1,800.5"     → 180050
 *
 * Returns null if the input has no parseable numeric portion.
 */
export function parseCurrencyToCents(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!str) return null;

  const cleaned = str.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;

  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return null;

  return Math.round(num * 100);
}

/**
 * Slugify a free-text name for natural-key matching.  Lowercase, trim,
 * collapse whitespace + punctuation to single hyphens.
 *
 *   "vaba House #2" → "vaba-house-2"
 */
export function slugify(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Helper for picking a column out of a CSV row tolerantly — case-insensitive
 * and whitespace-trimmed on the keys.  Returns the first matching key's
 * value (or empty string).
 */
export function pickColumn(
  row: Record<string, string | undefined>,
  candidates: ReadonlyArray<string>,
): string {
  const lookup = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase();
    if (!lookup.has(normalized) && value !== undefined && value !== null) {
      lookup.set(normalized, String(value).trim());
    }
  }

  for (const candidate of candidates) {
    const value = lookup.get(candidate.trim().toLowerCase());
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

/**
 * Parse an integer column.  Returns null on empty / unparseable input.
 */
export function parseIntOrNull(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const num = Number.parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse a number column (allows decimals).  Returns null on empty / NaN.
 */
export function parseFloatOrNull(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const num = Number.parseFloat(str);
  return Number.isFinite(num) ? num : null;
}
