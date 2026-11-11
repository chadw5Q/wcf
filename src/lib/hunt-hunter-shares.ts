import {
  HUNT_DEPOSIT_PER_PERSON,
  HUNT_LODGING_PER_PERSON,
} from './hunt-pricing';
import type { HuntReservation } from './hunt-reservations';

type ShareFields = Pick<HuntReservation, 'pricingModel' | 'mealPackage' | 'mealPackageCost' | 'totalDeposit' | 'balanceDue'>;

/** Remaining lodging after deposit, per hunter (`per_person` pricing). */
export function hunterLodgingBalanceUsd(): number {
  return HUNT_LODGING_PER_PERSON - HUNT_DEPOSIT_PER_PERSON;
}

/**
 * Under `group_flat` the lead owes the whole balance and everyone else owes nothing.
 * Under `per_person` each hunter owes their lodging; the lead also pays the meal package.
 */
export function hunterBalanceShareUsd(r: ShareFields, hunterIndex: number): number {
  if (r.pricingModel === 'group_flat') return hunterIndex === 0 ? r.balanceDue : 0;
  const lodging = hunterLodgingBalanceUsd();
  const meals = hunterIndex === 0 && r.mealPackage ? r.mealPackageCost : 0;
  return Math.round((lodging + meals) * 100) / 100;
}

export function hunterDepositShareUsd(r: ShareFields, hunterIndex: number): number {
  if (r.pricingModel === 'group_flat') return hunterIndex === 0 ? r.totalDeposit : 0;
  return HUNT_DEPOSIT_PER_PERSON;
}

/** True when this hunter has nothing to pay themselves (the lead covers the group). */
export function hunterPaysNothing(r: ShareFields, hunterIndex: number): boolean {
  return r.pricingModel === 'group_flat' && hunterIndex !== 0;
}

export function isLeadHunter(hunterIndex: number): boolean {
  return hunterIndex === 0;
}
