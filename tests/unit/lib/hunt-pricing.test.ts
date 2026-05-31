import { describe, it, expect } from 'vitest';
import {
  computeHuntOrderSummary,
  HUNT_DEPOSIT_PER_PERSON,
  HUNT_LODGING_PER_PERSON,
  mealPackageTotalForParty,
} from '../../../src/lib/hunt-pricing';

describe('mealPackageTotalForParty', () => {
  it('charges $1,000 for one hunter', () => {
    expect(mealPackageTotalForParty(1)).toBe(1000);
  });

  it('adds $250 per additional hunter', () => {
    expect(mealPackageTotalForParty(2)).toBe(1250);
    expect(mealPackageTotalForParty(3)).toBe(1500);
    expect(mealPackageTotalForParty(4)).toBe(1750);
  });
});

describe('computeHuntOrderSummary', () => {
  const cases: Array<{
    n: number;
    meal: boolean;
    lodging: number;
    mealLine: number;
    total: number;
    deposit: number;
    balance: number;
  }> = [
    { n: 1, meal: false, lodging: 3000, mealLine: 0, total: 3000, deposit: 500, balance: 2500 },
    { n: 1, meal: true, lodging: 3000, mealLine: 1000, total: 4000, deposit: 500, balance: 3500 },
    { n: 2, meal: false, lodging: 6000, mealLine: 0, total: 6000, deposit: 1000, balance: 5000 },
    { n: 2, meal: true, lodging: 6000, mealLine: 1250, total: 7250, deposit: 1000, balance: 6250 },
    { n: 4, meal: false, lodging: 12000, mealLine: 0, total: 12000, deposit: 2000, balance: 10000 },
    { n: 4, meal: true, lodging: 12000, mealLine: 1750, total: 13750, deposit: 2000, balance: 11750 },
  ];

  for (const { n, meal, lodging, mealLine, total, deposit, balance } of cases) {
    it(`computes n=${n} meal=${meal}`, () => {
      const s = computeHuntOrderSummary(n, meal);
      expect(s.hunterCount).toBe(n);
      expect(s.mealPackage).toBe(meal);
      expect(s.huntLodging).toBe(lodging);
      expect(s.mealLine).toBe(mealLine);
      expect(s.totalHuntCost).toBe(total);
      expect(s.depositPerPerson).toBe(HUNT_DEPOSIT_PER_PERSON);
      expect(s.totalDeposit).toBe(deposit);
      expect(s.balanceDueJuly1).toBe(balance);
      expect(s.huntLodging).toBe(n * HUNT_LODGING_PER_PERSON);
      expect(s.totalDeposit).toBe(n * HUNT_DEPOSIT_PER_PERSON);
    });
  }
});
