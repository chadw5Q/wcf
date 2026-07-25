/** Preferred hunt weeks keyed by hunt year (PRD Page 2). */

export type HuntWeekSlot = {
  id: string;
  label: string;
  available: boolean;
};

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}

/** Last Sunday on or before Oct 31 (local calendar). */
export function lastOctoberSunday(year: number): Date {
  const oct31 = new Date(year, 9, 31);
  return addDays(oct31, -oct31.getDay());
}

function formatMonthDay(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** e.g. "Oct 29–Nov 4" or "Oct 25–31". */
export function formatHuntWeekDateRange(startSunday: Date): string {
  const endSaturday = addDays(startSunday, 6);
  if (startSunday.getMonth() === endSaturday.getMonth()) {
    return `${MONTH_SHORT[startSunday.getMonth()]} ${startSunday.getDate()}–${endSaturday.getDate()}`;
  }
  return `${formatMonthDay(startSunday)}–${formatMonthDay(endSaturday)}`;
}

function octWeeks(year: number, w1Avail: boolean, w2Avail: boolean, w3Avail: boolean): HuntWeekSlot[] {
  const w1 = lastOctoberSunday(year);
  const w2 = addDays(w1, 7);
  const w3 = addDays(w2, 7);
  return [
    {
      id: 'w1',
      label: `Week 1 — ${formatHuntWeekDateRange(w1)} (Last week of October)`,
      available: w1Avail,
    },
    {
      id: 'w2',
      label: `Week 2 — ${formatHuntWeekDateRange(w2)} (First week of November — Prime Rut)`,
      available: w2Avail,
    },
    {
      id: 'w3',
      label: `Week 3 — ${formatHuntWeekDateRange(w3)} (Second week of November)`,
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

/** Sunday start of a hunt week, or null if year/week unknown. */
export function getHuntWeekStartSunday(year: number, weekId: string): Date | null {
  const weeks = getHuntWeeksForYear(year);
  if (!weeks?.some((w) => w.id === weekId)) return null;

  // Computed seasons (2028+) use the October-Sunday ladder.
  if (year >= 2028) {
    const w1 = lastOctoberSunday(year);
    if (weekId === 'w1') return w1;
    if (weekId === 'w2') return addDays(w1, 7);
    if (weekId === 'w3') return addDays(w1, 14);
    return null;
  }

  // Static legacy labels for 2026–2027 — Sundays from the published ranges.
  const staticStarts: Record<number, Record<string, [number, number]>> = {
    2026: { w1: [9, 25], w2: [10, 1], w3: [10, 8] },
    2027: { w1: [9, 25], w2: [10, 1], w3: [10, 8] },
  };
  const md = staticStarts[year]?.[weekId];
  if (!md) return null;
  return new Date(year, md[0], md[1]);
}

const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** e.g. "November 12" */
export function formatHuntSundayLong(startSunday: Date): string {
  return `${MONTH_LONG[startSunday.getMonth()]} ${startSunday.getDate()}`;
}

/**
 * Portal Done banner:
 * "You're all set for your hunt on Nov 12–18, 2029. See you on Sunday, November 12 after 2pm CT"
 */
export function huntPortalAllSetMessage(year: number, weekId: string): string | null {
  const start = getHuntWeekStartSunday(year, weekId);
  if (!start) return null;
  const range = `${formatHuntWeekDateRange(start)}, ${year}`;
  const sunday = formatHuntSundayLong(start);
  return `You're all set for your hunt on ${range}. See you on Sunday, ${sunday} after 2pm CT`;
}

/** Portal "Your hunt" card pieces parsed from a week label. */
export type HuntWeekCardParts = {
  /** e.g. "Week 2 · Nov 4 – 10, 2029" */
  titleLine: string;
  /** e.g. "First week of November" */
  seasonNote: string | null;
  /** e.g. "Prime Rut" */
  tag: string | null;
};

/**
 * Parse `Week 2 — Nov 4–10 (First week of November — Prime Rut)` into display parts.
 */
export function parseHuntWeekCard(weekLabel: string, huntYear: number): HuntWeekCardParts {
  const paren = weekLabel.match(/\(([^)]+)\)\s*$/);
  const inside = paren?.[1]?.trim() ?? '';
  const withoutParen = weekLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const [weekPartRaw, rangeRaw] = withoutParen.split(/\s+[—–-]\s+/, 2);
  const weekPart = (weekPartRaw ?? withoutParen).trim();
  let range = (rangeRaw ?? '').trim();
  // "Nov 4–10" → "Nov 4 – 10"
  range = range.replace(/(\d)\s*[–-]\s*(\d)/, '$1 – $2');
  const titleLine = range
    ? `${weekPart} · ${range}, ${huntYear}`
    : `${weekPart}, ${huntYear}`;

  let seasonNote: string | null = null;
  let tag: string | null = null;
  if (inside) {
    const parts = inside.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      seasonNote = parts.slice(0, -1).join(' — ');
      tag = parts[parts.length - 1] ?? null;
    } else {
      seasonNote = inside;
    }
  }
  return { titleLine, seasonNote, tag };
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
