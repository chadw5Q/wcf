/** Hunt pricing for Williams Creek Whitetails. */

/**
 * `group_flat`: one flat price for a party of up to 4 hunters, meals included, lead hunter pays.
 * `per_person`: original pricing; kept so reservations booked under it keep their totals.
 */
export type HuntPricingModel = 'group_flat' | 'per_person';

export const HUNT_MAX_HUNTERS = 4;
export const HUNT_GROUP_PRICE = 9000;
export const HUNT_GROUP_DEPOSIT = 2000;

export const HUNT_LODGING_PER_PERSON = 3000;
export const HUNT_DEPOSIT_PER_PERSON = 500;
/** Per-person meal package: $1,000 for first hunter + $250 per additional hunter. */
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
  pricingModel: HuntPricingModel;
  hunterCount: number;
  mealPackage: boolean;
  huntLodging: number;
  mealLine: number;
  totalHuntCost: number;
  /** 0 under `group_flat` (the lead pays `totalDeposit`). */
  depositPerPerson: number;
  totalDeposit: number;
  balanceDueJuly1: number;
};

export function computeHuntOrderSummary(
  hunterCount: number,
  mealPackage: boolean,
  pricingModel: HuntPricingModel = 'group_flat'
): HuntOrderSummary {
  if (pricingModel === 'group_flat') {
    return {
      pricingModel,
      hunterCount,
      mealPackage: true,
      huntLodging: HUNT_GROUP_PRICE,
      mealLine: 0,
      totalHuntCost: HUNT_GROUP_PRICE,
      depositPerPerson: 0,
      totalDeposit: HUNT_GROUP_DEPOSIT,
      balanceDueJuly1: HUNT_GROUP_PRICE - HUNT_GROUP_DEPOSIT,
    };
  }
  const huntLodging = huntLodgingSubtotal(hunterCount);
  const mealLine = mealPackage ? mealPackageTotalForParty(hunterCount) : 0;
  const totalHuntCost = huntLodging + mealLine;
  const totalDeposit = hunterCount * HUNT_DEPOSIT_PER_PERSON;
  return {
    pricingModel,
    hunterCount,
    mealPackage,
    huntLodging,
    mealLine,
    totalHuntCost,
    depositPerPerson: HUNT_DEPOSIT_PER_PERSON,
    totalDeposit,
    balanceDueJuly1: totalHuntCost - totalDeposit,
  };
}
