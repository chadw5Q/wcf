import { describe, it, expect } from 'vitest';
import {
  HUNT_WEEKS_BY_YEAR,
  allowedHuntReserveYears,
  formatHuntWeekDateRange,
  getHuntWeekStartSunday,
  getHuntWeeksForYear,
  getWeekLabel,
  huntPortalAllSetMessage,
  isPreferredWeekAvailable,
  lastOctoberSunday,
  parseHuntWeekCard,
} from '../../../src/lib/hunt-weeks';

describe('HUNT_WEEKS_BY_YEAR', () => {
  it('2026 has three weeks, all unavailable', () => {
    const w = HUNT_WEEKS_BY_YEAR[2026];
    expect(w).toHaveLength(3);
    expect(w.every((x) => !x.available)).toBe(true);
    expect(w.map((x) => x.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('2027 is fully booked: all weeks unavailable', () => {
    const w = HUNT_WEEKS_BY_YEAR[2027];
    expect(w).toHaveLength(3);
    expect(w.every((x) => !x.available)).toBe(true);
  });

  it('2028 has expected ids and all weeks available', () => {
    const w = getHuntWeeksForYear(2028);
    expect(w?.map((x) => x.id)).toEqual(['w1', 'w2', 'w3']);
    expect(w?.every((x) => x.available)).toBe(true);
  });

  it('2028 week labels include computed Sunday–Saturday dates', () => {
    const w1Start = lastOctoberSunday(2028);
    expect(formatHuntWeekDateRange(w1Start)).toBe('Oct 29–Nov 4');
    expect(getWeekLabel(2028, 'w1')).toContain('Oct 29–Nov 4');
    expect(getWeekLabel(2028, 'w2')).toContain('Nov 5–11');
    expect(getWeekLabel(2028, 'w3')).toContain('Nov 12–18');
  });
});

describe('isPreferredWeekAvailable', () => {
  it('returns true only for configured available slots', () => {
    expect(isPreferredWeekAvailable(2028, 'w2')).toBe(true);
    expect(isPreferredWeekAvailable(2027, 'w2')).toBe(false);
    expect(isPreferredWeekAvailable(2027, 'w1')).toBe(false);
    expect(isPreferredWeekAvailable(2099, 'w1')).toBe(false);
  });
});

describe('allowedHuntReserveYears', () => {
  it('returns configured years within current..+9 window (through 2035 from 2026)', () => {
    const y = allowedHuntReserveYears(new Date('2026-05-01'));
    expect(y[0]).toBe(2026);
    expect(y).toContain(2027);
    expect(y).toContain(2035);
    expect(Math.max(...y)).toBe(2035);
  });
});

describe('parseHuntWeekCard', () => {
  it('splits week, season note, and Prime Rut tag', () => {
    const parts = parseHuntWeekCard(
      'Week 2 — Nov 5–11 (First week of November — Prime Rut)',
      2029
    );
    expect(parts.titleLine).toBe('Week 2 · Nov 5 – 11, 2029');
    expect(parts.seasonNote).toBe('First week of November');
    expect(parts.tag).toBe('Prime Rut');
  });

  it('handles labels without a tag', () => {
    const parts = parseHuntWeekCard('Week 1 — Oct 29–Nov 4 (Last week of October)', 2028);
    expect(parts.titleLine).toContain('Week 1');
    expect(parts.seasonNote).toBe('Last week of October');
    expect(parts.tag).toBeNull();
  });
});

describe('huntPortalAllSetMessage', () => {
  it('includes date range and Sunday arrival for a computed week', () => {
    const start = getHuntWeekStartSunday(2029, 'w3');
    expect(start).not.toBeNull();
    const range = `${formatHuntWeekDateRange(start!)}, 2029`;
    const msg = huntPortalAllSetMessage(2029, 'w3');
    expect(msg).toContain(`You're all set for your hunt on ${range}`);
    expect(msg).toMatch(/See you on Sunday, November \d+ after 2pm CT/);
  });
});
