/** Hunt lodge + meal pricing for Williams Creek Whitetails (PRD). */

export const HUNT_LODGING_PER_PERSON = 3000;
export const HUNT_DEPOSIT_PER_PERSON = 500;
/** All-inclusive meal package: $1,000 for first hunter + $250 per additional hunter (PRD copy). */
export const HUNT_MEAL_BASE = 1000;
export const HUNT_MEAL_PER_ADDITIONAL = 250;

export function mealPackageTotalForParty(hunterCount: number): number {
  if (hunterCount < 1) return 0;
  return HUNT_MEAL_BASE + HUNT_MEAL_PER_ADDITIONAL * Math.max(0, hunterCount - 1);
}

export function huntLodgingSubtotal(hunterCount: number): number {
  return hunterCount * HUNT_LODGING_PER_PERSON;
}

export type HuntOrderSummary = {
  hunterCount: number;
  mealPackage: boolean;
  huntLodging: number;
  mealLine: number;
  totalHuntCost: number;
  depositPerPerson: number;
  totalDeposit: number;
  balanceDueJuly1: number;
};

export function computeHuntOrderSummary(hunterCount: number, mealPackage: boolean): HuntOrderSummary {
  const huntLodging = huntLodgingSubtotal(hunterCount);
  const mealLine = mealPackage ? mealPackageTotalForParty(hunterCount) : 0;
  const totalHuntCost = huntLodging + mealLine;
  const totalDeposit = hunterCount * HUNT_DEPOSIT_PER_PERSON;
  const balanceDueJuly1 = totalHuntCost - totalDeposit;
  return {
    hunterCount,
    mealPackage,
    huntLodging,
    mealLine,
    totalHuntCost,
    depositPerPerson: HUNT_DEPOSIT_PER_PERSON,
    totalDeposit,
    balanceDueJuly1,
  };
}
