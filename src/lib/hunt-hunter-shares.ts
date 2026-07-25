import {
  HUNT_DEPOSIT_PER_PERSON,
  HUNT_LODGING_PER_PERSON,
} from './hunt-pricing';
import type { HuntReservation } from './hunt-reservations';

/**
 * Remaining lodging after deposit, per hunter.
 * Lead (index 0) also pays the full meal package when selected.
 */
export function hunterLodgingBalanceUsd(): number {
  return HUNT_LODGING_PER_PERSON - HUNT_DEPOSIT_PER_PERSON;
}

export function hunterBalanceShareUsd(r: Pick<HuntReservation, 'mealPackage' | 'mealPackageCost'>, hunterIndex: number): number {
  const lodging = hunterLodgingBalanceUsd();
  const meals = hunterIndex === 0 && r.mealPackage ? r.mealPackageCost : 0;
  return Math.round((lodging + meals) * 100) / 100;
}

export function hunterDepositShareUsd(): number {
  return HUNT_DEPOSIT_PER_PERSON;
}

export function isLeadHunter(hunterIndex: number): boolean {
  return hunterIndex === 0;
}
