/** Bake processor fees into Checkout totals so list prices net to the farm. */

/** Approximate card processing uplift so net ≈ list. */
export const HUNT_CARD_FEE_MULTIPLIER = 1.03;

/** Approximate Stripe ACH Direct Debit uplift so net ≈ list. */
export const HUNT_ACH_FEE_MULTIPLIER = 1.008;

export type HuntStripeRail = 'ach' | 'card';

/** List amount the guest owes (before fees). */
export function checkoutChargeUsd(listUsd: number, rail: HuntStripeRail): number {
  if (!Number.isFinite(listUsd) || listUsd <= 0) return 0;
  const m = rail === 'card' ? HUNT_CARD_FEE_MULTIPLIER : HUNT_ACH_FEE_MULTIPLIER;
  return Math.round(listUsd * m * 100) / 100;
}

export function feeUpliftLabel(rail: HuntStripeRail): string {
  return rail === 'card' ? '+3% card processing' : '+0.8% bank (ACH) processing';
}
