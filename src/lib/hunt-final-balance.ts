import { HUNT_DEPOSIT_PER_PERSON, HUNT_LODGING_PER_PERSON } from './hunt-pricing';

/**
 * PRD Phase 6 default balance shown on `/hunt/final-payment` before Stripe:
 * `(hunters × $3,000) + ($1,000 if meals) − (hunters × $500 deposit already paid)`.
 * Uses a flat $1,000 meal line per PRD Page 3 (not the tiered meal package from checkout).
 */
export function computePrdDefaultFinalBalanceUsd(hunterCount: number, mealIncluded: boolean): number {
  const lodging = hunterCount * HUNT_LODGING_PER_PERSON;
  const mealFlat = mealIncluded ? 1000 : 0;
  const depositsPaid = hunterCount * HUNT_DEPOSIT_PER_PERSON;
  return lodging + mealFlat - depositsPaid;
}

/** Hunt year dropdown on final payment: current year through +2 (PRD). */
export function finalPaymentHuntYears(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return [y, y + 1, y + 2];
}
