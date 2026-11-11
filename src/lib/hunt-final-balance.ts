import { HUNT_GROUP_DEPOSIT, HUNT_GROUP_PRICE } from './hunt-pricing';

/**
 * Default balance pre-filled on `/hunt/final-payment` before Stripe: group price minus the group deposit.
 * The server still checks the amount against the matched reservation's stored `balanceDue`.
 */
export function computeDefaultFinalBalanceUsd(): number {
  return HUNT_GROUP_PRICE - HUNT_GROUP_DEPOSIT;
}

/** Hunt year dropdown on final payment: current year through +2 (PRD). */
export function finalPaymentHuntYears(now: Date = new Date()): number[] {
  const y = now.getFullYear();
  return [y, y + 1, y + 2];
}
