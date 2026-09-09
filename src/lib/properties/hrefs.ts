/**
 * Pure URL builders for the portfolio detail routes. Extracted from
 * mock-detail.ts so real-data pages can link without importing a mock module
 * (these are not mock data — just route helpers). Params are real UUIDs.
 */

export function propertyHref(propertyId: string): string {
  return `/properties/${propertyId}`;
}

export function unitHref(propertyId: string, unitId: string): string {
  return `/properties/${propertyId}/units/${unitId}`;
}

export function tenantHref(tenantId: string): string {
  return `/tenants/${tenantId}`;
}

export function vendorHref(vendorId: string): string {
  return `/vendors/${vendorId}`;
}

export function workOrderHref(workOrderId: string): string {
  return `/work-orders/${workOrderId}`;
}
