import { describe, it, expect } from 'vitest';
import { computePrdDefaultFinalBalanceUsd, finalPaymentHuntYears } from '../../../src/lib/hunt-final-balance';

describe('computePrdDefaultFinalBalanceUsd', () => {
  it('matches PRD: lodging − deposits, optional flat $1k meal', () => {
    expect(computePrdDefaultFinalBalanceUsd(1, false)).toBe(3000 - 500);
    expect(computePrdDefaultFinalBalanceUsd(1, true)).toBe(3000 + 1000 - 500);
    expect(computePrdDefaultFinalBalanceUsd(2, false)).toBe(6000 - 1000);
    expect(computePrdDefaultFinalBalanceUsd(2, true)).toBe(6000 + 1000 - 1000);
    expect(computePrdDefaultFinalBalanceUsd(4, false)).toBe(12000 - 2000);
    expect(computePrdDefaultFinalBalanceUsd(4, true)).toBe(12000 + 1000 - 2000);
  });
});

describe('finalPaymentHuntYears', () => {
  it('returns current year plus two', () => {
    expect(finalPaymentHuntYears(new Date('2028-03-01'))).toEqual([2028, 2029, 2030]);
  });
});
