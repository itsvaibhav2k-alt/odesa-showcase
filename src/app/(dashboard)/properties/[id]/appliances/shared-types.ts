/**
 * Shared types for the appliances tab.
 *
 * Kept in a separate module so the page (server component) and the
 * client `AddApplianceDialog` can both import without dragging the
 * `'use server'` directive across module boundaries.
 */

export type ApplianceType =
  | 'fridge'
  | 'hvac'
  | 'washer'
  | 'dryer'
  | 'water_heater'
  | 'dishwasher'
  | 'oven'
  | 'microwave'
  | 'other';

export type ConfidenceSource = 'agent' | 'owner' | 'import';

export const APPLIANCE_TYPE_OPTIONS: ReadonlyArray<{
  value: ApplianceType;
  label: string;
}> = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'washer', label: 'Washer' },
  { value: 'dryer', label: 'Dryer' },
  { value: 'water_heater', label: 'Water heater' },
  { value: 'dishwasher', label: 'Dishwasher' },
  { value: 'oven', label: 'Oven' },
  { value: 'microwave', label: 'Microwave' },
  { value: 'other', label: 'Other' },
];
