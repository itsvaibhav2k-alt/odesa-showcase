export type ProviderDeliveryStatus =
  | "queued"
  | "provider_accepted"
  | "delivered"
  | "undelivered"
  | "failed";

export interface DeliveryEvent {
  status: ProviderDeliveryStatus;
  occurredAt: string;
}

const STATUS_MAP: Record<string, ProviderDeliveryStatus> = {
  queued: "queued",
  accepted: "provider_accepted",
  sent: "provider_accepted",
  provider_accepted: "provider_accepted",
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
  canceled: "failed",
};

const TIE_RANK: Record<ProviderDeliveryStatus, number> = {
  queued: 1,
  provider_accepted: 2,
  failed: 3,
  undelivered: 4,
  delivered: 5,
};

export function normalizeDeliveryStatus(
  value: string,
): ProviderDeliveryStatus | null {
  return STATUS_MAP[value.trim().toLowerCase()] ?? null;
}

export function canonicalDeliveryEvent(
  events: readonly DeliveryEvent[],
): DeliveryEvent | null {
  return (
    [...events].sort((a, b) => {
      const time = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
      return time || TIE_RANK[b.status] - TIE_RANK[a.status];
    })[0] ?? null
  );
}
