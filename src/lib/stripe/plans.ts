// Odesa pricing tiers — Phase 8 wires real Stripe products.
// priceIds resolve from env vars set only in the Phase 8 Vercel env.

export type PlanMode = 'subscription' | 'usage';

export interface Plan {
  key: string;
  name: string;
  /** Base monthly price in whole dollars (per-unit fee tracked separately). */
  basePrice: number;
  /** Per-unit-per-month add-on in whole dollars, if any. */
  perUnitPrice: number;
  priceId: string;
  mode: PlanMode;
  features: string[];
}

export const PLANS: Record<string, Plan> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    basePrice: 199,
    perUnitPrice: 12,
    priceId: process.env.STRIPE_STARTER_PRICE_ID ?? '',
    mode: 'subscription',
    features: [
      'Voice agent (Odesa) + SMS',
      'Maintenance dispatch',
      'Weekly Monday briefing',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    basePrice: 299,
    perUnitPrice: 18,
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? '',
    mode: 'subscription',
    features: [
      'Everything in Starter',
      'Rent collection via Stripe + Plaid',
      'Late fee automation + payment plans',
    ],
  },
  managed: {
    key: 'managed',
    name: 'Managed',
    basePrice: 0,
    perUnitPrice: 0,
    priceId: process.env.STRIPE_MANAGED_PRICE_ID ?? '',
    mode: 'usage',
    features: [
      '4.5% of collected rent',
      'Odesa ops team reviews AI decisions',
      'Handles exceptions and edge cases',
    ],
  },
} as const;

export function getPlanByPriceId(priceId: string): [string, Plan] | null {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.priceId && plan.priceId === priceId) {
      return [key, plan];
    }
  }
  return null;
}
