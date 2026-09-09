/**
 * Voice agent types — shared across the whitelist, emergency matcher,
 * and Retell tool endpoints.
 */

export type IntentId =
  | 'rent_balance'
  | 'office_hours_and_contact'
  | 'emergency_detection'
  | 'general_callback'
  // shadow-mode-only (week 5-6), not yet autonomous
  | 'maintenance_request'
  | 'lease_question'
  | 'payment_plan'
  | 'move_out_notice'
  | 'general_property_info'
  // hard-escalate
  | 'eviction_discussion'
  | 'legal_threat'
  | 'aggression'
  | 'unknown';

export type IntentMode = 'autonomous' | 'shadow' | 'escalate_always';

export interface IntentEntry {
  id: IntentId;
  mode: IntentMode;
  keywords: readonly string[];
}

export interface IntentMatch {
  intent: IntentId;
  confidence: number;
  autonomous: boolean;
  matchedKeywords: readonly string[];
}

export interface EmergencyMatch {
  emergency: boolean;
  category: EmergencyCategory | null;
  matchedPhrase: string | null;
}

export type EmergencyCategory =
  | 'water_leak'
  | 'no_heat_winter'
  | 'fire_smoke'
  | 'gas_smell'
  | 'lockout'
  | 'sewage_backup';
