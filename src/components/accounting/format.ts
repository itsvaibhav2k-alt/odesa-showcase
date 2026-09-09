export function formatAccountingMoney(
  cents: number,
  currency: 'USD' = 'USD',
): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatAccountingDate(
  iso: string | null,
  fallback = 'Unavailable',
): string {
  if (!iso) return fallback;
  const input = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso}T12:00:00.000Z`
    : iso;
  const date = new Date(input);
  if (Number.isNaN(date.valueOf())) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatAccountingTimestamp(
  iso: string | null,
  fallback = 'Unavailable',
): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

export function sentenceCase(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}
