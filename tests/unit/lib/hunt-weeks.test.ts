import { describe, it, expect } from 'vitest';
import {
  HUNT_WEEKS_BY_YEAR,
  allowedHuntReserveYears,
  getHuntWeeksForYear,
  isPreferredWeekAvailable,
} from '../../../src/lib/hunt-weeks';

describe('HUNT_WEEKS_BY_YEAR', () => {
  it('2026 has three weeks, all unavailable', () => {
    const w = HUNT_WEEKS_BY_YEAR[2026];
    expect(w).toHaveLength(3);
    expect(w.every((x) => !x.available)).toBe(true);
    expect(w.map((x) => x.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('2027 matches PRD: only week 2 is open', () => {
    const w = HUNT_WEEKS_BY_YEAR[2027];
    expect(w?.find((x) => x.id === 'w1')?.available).toBe(false);
    expect(w?.find((x) => x.id === 'w2')?.available).toBe(true);
    expect(w?.find((x) => x.id === 'w3')?.available).toBe(false);
  });

  it('2028 has expected ids and all weeks available', () => {
    const w = getHuntWeeksForYear(2028);
    expect(w?.map((x) => x.id)).toEqual(['w1', 'w2', 'w3']);
    expect(w?.every((x) => x.available)).toBe(true);
  });
});

describe('isPreferredWeekAvailable', () => {
  it('returns true only for configured available slots', () => {
    expect(isPreferredWeekAvailable(2027, 'w2')).toBe(true);
    expect(isPreferredWeekAvailable(2027, 'w1')).toBe(false);
    expect(isPreferredWeekAvailable(2099, 'w1')).toBe(false);
  });
});

describe('allowedHuntReserveYears', () => {
  it('returns configured years within current..+5 window', () => {
    const y = allowedHuntReserveYears(new Date('2026-05-01'));
    expect(y[0]).toBe(2026);
    expect(y).toContain(2027);
    expect(Math.max(...y)).toBeLessThanOrEqual(2031);
  });
});
