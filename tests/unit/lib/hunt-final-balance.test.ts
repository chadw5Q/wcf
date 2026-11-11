import { describe, it, expect } from 'vitest';
import { computeDefaultFinalBalanceUsd, finalPaymentHuntYears } from '../../../src/lib/hunt-final-balance';

describe('computeDefaultFinalBalanceUsd', () => {
  it('is the group price minus the group deposit', () => {
    expect(computeDefaultFinalBalanceUsd()).toBe(9000 - 2000);
  });
});

describe('finalPaymentHuntYears', () => {
  it('returns current year plus two', () => {
    expect(finalPaymentHuntYears(new Date('2028-03-01'))).toEqual([2028, 2029, 2030]);
  });
});
