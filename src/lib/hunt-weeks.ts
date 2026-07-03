/** Preferred hunt weeks keyed by hunt year (PRD Page 2). */

export type HuntWeekSlot = {
  id: string;
  label: string;
  available: boolean;
};

function octWeeks(year: number, w1Avail: boolean, w2Avail: boolean, w3Avail: boolean): HuntWeekSlot[] {
  return [
    {
      id: 'w1',
      label: `Week 1 — (Last week of October, ${year}, Sunday–Saturday)`,
      available: w1Avail,
    },
    {
      id: 'w2',
      label: `Week 2 — Nov 1–8 (First week of November — Prime Rut, ${year})`,
      available: w2Avail,
    },
    {
      id: 'w3',
      label: `Week 3 — Nov 8–15 (Second week of November, ${year})`,
      available: w3Avail,
    },
  ];
}

/** Static week rows per year (PRD + repeat pattern for future seasons). */
export const HUNT_WEEKS_BY_YEAR: Readonly<Record<number, readonly HuntWeekSlot[]>> = {
  2026: [
    {
      id: 'w1',
      label: 'Week 1 — Oct 25–Nov 1 (Last week of October)',
      available: false,
    },
    {
      id: 'w2',
      label: 'Week 2 — Nov 1–8 (First week of November — Prime Rut)',
      available: false,
    },
    {
      id: 'w3',
      label: 'Week 3 — Nov 8–15 (Second week of November)',
      available: false,
    },
  ],
  2027: [
    {
      id: 'w1',
      label: 'Week 1 — Oct 25–Nov 1 (Last week of October)',
      available: false,
    },
    {
      id: 'w2',
      label: 'Week 2 — Nov 1–8 (First week of November — Prime Rut)',
      available: false,
    },
    {
      id: 'w3',
      label: 'Week 3 — Nov 8–15 (Second week of November)',
      available: false,
    },
  ],
  2028: octWeeks(2028, true, true, true),
  2029: octWeeks(2029, true, true, true),
  2030: octWeeks(2030, true, true, true),
  2031: octWeeks(2031, true, true, true),
  2032: octWeeks(2032, true, true, true),
  2033: octWeeks(2033, true, true, true),
  2034: octWeeks(2034, true, true, true),
  2035: octWeeks(2035, true, true, true),
  2036: octWeeks(2036, true, true, true),
} as const;

export function getHuntWeeksForYear(year: number): HuntWeekSlot[] | undefined {
  const w = HUNT_WEEKS_BY_YEAR[year];
  return w ? [...w] : undefined;
}

export function getWeekLabel(year: number, weekId: string): string | undefined {
  const weeks = getHuntWeeksForYear(year);
  return weeks?.find((w) => w.id === weekId)?.label;
}

export function isPreferredWeekAvailable(year: number, weekId: string): boolean {
  const weeks = getHuntWeeksForYear(year);
  const slot = weeks?.find((w) => w.id === weekId);
  return Boolean(slot?.available);
}

/** Years that have week config (intersect with UI year dropdown). */
export function yearsWithWeekConfig(): number[] {
  return Object.keys(HUNT_WEEKS_BY_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Dropdown: current year through current year + 9 (e.g. 2026 → 2035), only if week config exists. */
export function allowedHuntReserveYears(now: Date = new Date()): number[] {
  const y0 = now.getFullYear();
  const configured = new Set(yearsWithWeekConfig());
  const out: number[] = [];
  for (let i = 0; i <= 9; i++) {
    const y = y0 + i;
    if (configured.has(y)) out.push(y);
  }
  return out;
}
