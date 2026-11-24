import type { OrderLineItem, StoredOrder } from './order-types';
import { getDefaultOrderSkuMap, type OrderCheckoutKey } from './products-config';

/** Calendar date YYYY-MM-DD for `instant` in America/Chicago. */
export function dateKeyCentral(isoOrMs: string | number): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function filterOrdersByCentralDateRange(
  orders: StoredOrder[],
  fromYmd: string,
  toYmd: string
): StoredOrder[] {
  return orders.filter((o) => {
    const k = dateKeyCentral(o.createdAt);
    return k >= fromYmd && k <= toYmd;
  });
}

/** Year-to-date in America/Chicago (Jan 1 → today). */
export function defaultReportRangeYmd(): { from: string; to: string } {
  const to = dateKeyCentral(Date.now());
  const from = `${to.slice(0, 4)}-01-01`;
  return { from, to };
}

/** First season tracked on the site. It started Jan 1 instead of the usual Nov 1. */
export const FIRST_REPORT_SEASON = 2026;

/**
 * A season runs Nov 1 of the prior year through Oct 31 (the "2027 Season" is
 * 2026-11-01 → 2027-10-31). The first season, 2026, runs 2026-01-01 → 2026-10-31.
 */
export function seasonRangeYmd(season: number): { from: string; to: string } {
  const from = season <= FIRST_REPORT_SEASON ? `${season}-01-01` : `${season - 1}-11-01`;
  return { from, to: `${season}-10-31` };
}

/** Season that today (America/Chicago) falls in: Nov and Dec belong to next year's season. */
export function currentSeasonYear(todayYmd: string = dateKeyCentral(Date.now())): number {
  const year = Number(todayYmd.slice(0, 4));
  const month = Number(todayYmd.slice(5, 7));
  return month >= 11 ? year + 1 : year;
}

/** Every season from the first through the current one, oldest first. */
export function reportSeasons(
  todayYmd: string = dateKeyCentral(Date.now())
): Array<{ season: number; from: string; to: string }> {
  const out: Array<{ season: number; from: string; to: string }> = [];
  for (let s = FIRST_REPORT_SEASON; s <= currentSeasonYear(todayYmd); s++) {
    out.push({ season: s, ...seasonRangeYmd(s) });
  }
  return out;
}

export function isYtdRange(fromYmd: string, toYmd: string): boolean {
  const ytd = defaultReportRangeYmd();
  return fromYmd === ytd.from && toYmd === ytd.to;
}

/** Fence posts only (excludes bow stave logs), matching volume-discount rules. */
export function countOrderPosts(order: StoredOrder): number {
  let n = 0;
  for (const item of order.items) {
    if (item.fieldName === 'bowStave') continue;
    n += Math.max(0, item.quantity || 0);
  }
  return n;
}

export interface ReportBucket {
  posts: number;
  income: number;
  orderCount: number;
}

export interface ReportSummary {
  total: ReportBucket;
  /** Pending + scheduled (received / not yet fulfilled). */
  open: ReportBucket;
  fulfilled: ReportBucket;
  canceled: ReportBucket;
}

function emptyBucket(): ReportBucket {
  return { posts: 0, income: 0, orderCount: 0 };
}

function addOrderToBucket(bucket: ReportBucket, order: StoredOrder): void {
  bucket.posts += countOrderPosts(order);
  bucket.income += order.discountedSubtotal;
  bucket.orderCount += 1;
}

export function summarizeOrdersForReport(orders: StoredOrder[]): ReportSummary {
  const total = emptyBucket();
  const open = emptyBucket();
  const fulfilled = emptyBucket();
  const canceled = emptyBucket();

  for (const o of orders) {
    addOrderToBucket(total, o);
    if (o.status === 'fulfilled') {
      addOrderToBucket(fulfilled, o);
    } else if (o.status === 'canceled') {
      addOrderToBucket(canceled, o);
    } else {
      // pending + scheduled (+ any legacy unexpected status)
      addOrderToBucket(open, o);
    }
  }

  return { total, open, fulfilled, canceled };
}

export interface CumulativePoint {
  /** YYYY-MM-DD (Central) */
  date: string;
  /** Short chart label */
  label: string;
  posts: number;
  income: number;
}

function shortChartLabel(ymd: string): string {
  // ymd is YYYY-MM-DD; format as "Jun 12" in Central without shifting the calendar day.
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  // Noon UTC avoids DST edge cases when formatting a calendar date.
  const approx = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
  }).format(approx);
}

/** Add (or subtract) whole calendar days from a YYYY-MM-DD string. */
export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function eachDayInclusive(fromYmd: string, toYmd: string): string[] {
  if (fromYmd > toYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

export interface CumulativeSeriesOptions {
  /** Inclusive report range start (YYYY-MM-DD). */
  rangeFrom: string;
  /** Inclusive report range end (YYYY-MM-DD). */
  rangeTo: string;
  /** Calendar days of padding before first / after last order (clipped to range). Default 5. */
  padDays?: number;
}

/**
 * Cumulative posts + income by order createdAt day (Central), ascending.
 * Fills every calendar day from (firstOrder − padDays) through (lastOrder + padDays),
 * clipped to the stated report range. Days without orders hold the prior cumulative
 * (0 before the first order).
 */
export function buildCumulativeSeries(
  orders: StoredOrder[],
  options?: CumulativeSeriesOptions
): CumulativePoint[] {
  const byDay = new Map<string, { posts: number; income: number }>();

  for (const o of orders) {
    const day = dateKeyCentral(o.createdAt);
    const cur = byDay.get(day) ?? { posts: 0, income: 0 };
    cur.posts += countOrderPosts(o);
    cur.income += o.discountedSubtotal;
    byDay.set(day, cur);
  }

  const activityDays = [...byDay.keys()].sort();
  if (activityDays.length === 0) return [];

  const first = activityDays[0]!;
  const last = activityDays[activityDays.length - 1]!;
  const padDays = options?.padDays ?? 5;

  let chartStart = first;
  let chartEnd = last;
  if (options) {
    chartStart = addDaysYmd(first, -padDays);
    chartEnd = addDaysYmd(last, padDays);
    if (chartStart < options.rangeFrom) chartStart = options.rangeFrom;
    if (chartEnd > options.rangeTo) chartEnd = options.rangeTo;
    if (chartStart > chartEnd) {
      chartStart = options.rangeFrom;
      chartEnd = options.rangeTo;
    }
  }

  let posts = 0;
  let income = 0;
  const out: CumulativePoint[] = [];

  for (const day of eachDayInclusive(chartStart, chartEnd)) {
    const dayTotals = byDay.get(day);
    if (dayTotals) {
      posts += dayTotals.posts;
      income = Math.round((income + dayTotals.income) * 100) / 100;
    }
    out.push({
      date: day,
      label: shortChartLabel(day),
      posts,
      income,
    });
  }

  return out;
}

/** Nice axis max ≥ value (0 stays 0 → 1 for empty charts). */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const n = value / base;
  let nice: number;
  if (n <= 1) nice = 1;
  else if (n <= 2) nice = 2;
  else if (n <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

export function formatAxisMoney(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '');
    return `$${rounded}k`;
  }
  return `$${Math.round(n)}`;
}

export type ProductSalesMetric = 'dollars' | 'volume';

export interface ProductSalesRow {
  fieldName: string;
  /** Catalog label (or the stored line label when the field is unknown). */
  label: string;
  /**
   * This product’s share of order income after volume discount.
   * Sums to the same income as the Total card for orders that have line items.
   */
  dollars: number;
  /** Units sold. Includes bow staves. */
  volume: number;
}

const DEFAULT_PRODUCT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(getDefaultOrderSkuMap()).map(([key, row]) => [key, row.label])
);

function catalogLabel(
  fieldName: string,
  storedProduct: string | undefined,
  labels: Partial<Record<string, string>> | undefined
): string {
  const override = labels?.[fieldName]?.trim();
  if (override) return override;
  const catalog = DEFAULT_PRODUCT_LABELS[fieldName as OrderCheckoutKey];
  if (catalog) return catalog;
  const stored = storedProduct?.trim();
  if (stored) return stored;
  return fieldName;
}

/** Pre-discount line amount used only as the weight for splitting income. */
function lineWeight(item: OrderLineItem): number {
  const line = Number(item.lineTotal);
  if (Number.isFinite(line)) return Math.max(0, line);
  const qty = Math.max(0, Number(item.quantity) || 0);
  const price = Math.max(0, Number(item.unitPrice) || 0);
  return qty * price;
}

/**
 * Split `totalCents` across `weights` so the parts sum to `totalCents`.
 * Weights are non-negative. A zero total (or no positive weight and a zero
 * total) yields zeros. When every weight is 0 and the total is positive,
 * cents are split evenly so income is not dropped.
 */
function allocateCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (!Number.isFinite(totalCents) || totalCents <= 0) return Array(n).fill(0);

  const units = weights.map((w) =>
    Number.isFinite(w) && w > 0 ? Math.max(0, Math.round(w * 100)) : 0
  );
  const unitSum = units.reduce((sum, u) => sum + u, 0);

  if (unitSum <= 0) {
    const base = Math.floor(totalCents / n);
    let rem = totalCents - base * n;
    return units.map((_, i) => base + (i < rem ? 1 : 0));
  }

  const floors: number[] = [];
  const remainders: { i: number; rem: number }[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const numer = units[i]! * totalCents;
    const base = Math.floor(numer / unitSum);
    floors.push(base);
    remainders.push({ i, rem: numer % unitSum });
    used += base;
  }
  let leftover = totalCents - used;
  remainders.sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const entry of remainders) {
    if (leftover <= 0) break;
    floors[entry.i]! += 1;
    leftover -= 1;
  }
  return floors;
}

export interface ProductSalesOptions {
  /** Sort key. Defaults to dollars. Does not change the figures. */
  metric?: ProductSalesMetric;
  /** Live catalog labels, keyed by checkout field name. */
  labels?: Partial<Record<string, string>>;
}

/**
 * Product sales for orders already limited to the report range.
 *
 * Volume is the sum of line quantities, including bow staves (unlike
 * `countOrderPosts`, which skips them).
 *
 * Dollars are not the raw line totals. Each order’s `discountedSubtotal`
 * — the same income figure the Total card uses — is split across its
 * products in proportion to pre-discount `lineTotal` (quantity × unit
 * price). The order-level volume discount is therefore shared, and the
 * product dollars for an order sum to that order’s income.
 *
 * Every status is included, matching the Total card (canceled orders stay in).
 * Products with neither units nor dollars are omitted.
 */
export function summarizeProductSales(
  orders: StoredOrder[],
  options?: ProductSalesOptions
): ProductSalesRow[] {
  const totals = new Map<
    string,
    { fieldName: string; label: string; cents: number; volume: number }
  >();

  for (const order of orders) {
    const groups = new Map<
      string,
      { fieldName: string; label: string; weight: number; volume: number }
    >();

    for (const item of order.items) {
      const fieldName = String(item.fieldName || '').trim();
      if (!fieldName) continue;
      const volume = Math.max(0, Number(item.quantity) || 0);
      const weight = lineWeight(item);
      if (volume === 0 && weight <= 0) continue;

      const existing = groups.get(fieldName);
      if (existing) {
        existing.volume += volume;
        existing.weight += weight;
      } else {
        groups.set(fieldName, {
          fieldName,
          label: catalogLabel(fieldName, item.product, options?.labels),
          weight,
          volume,
        });
      }
    }

    const grouped = [...groups.values()];
    if (grouped.length === 0) continue;

    const targetCents = Math.round((Number(order.discountedSubtotal) || 0) * 100);
    const sign = targetCents < 0 ? -1 : 1;
    const shares = allocateCents(
      Math.abs(targetCents),
      grouped.map((g) => g.weight)
    );

    grouped.forEach((group, i) => {
      const cents = (shares[i] ?? 0) * sign;
      const acc = totals.get(group.fieldName);
      if (acc) {
        acc.cents += cents;
        acc.volume += group.volume;
      } else {
        totals.set(group.fieldName, {
          fieldName: group.fieldName,
          label: group.label,
          cents,
          volume: group.volume,
        });
      }
    });
  }

  const metric: ProductSalesMetric = options?.metric === 'volume' ? 'volume' : 'dollars';
  const rows: ProductSalesRow[] = [];
  for (const acc of totals.values()) {
    if (acc.volume === 0 && acc.cents === 0) continue;
    rows.push({
      fieldName: acc.fieldName,
      label: acc.label,
      dollars: acc.cents / 100,
      volume: acc.volume,
    });
  }

  rows.sort((a, b) => {
    const diff = metric === 'volume' ? b.volume - a.volume : b.dollars - a.dollars;
    if (diff !== 0) return diff;
    const byLabel = a.label.localeCompare(b.label, 'en');
    if (byLabel !== 0) return byLabel;
    return a.fieldName.localeCompare(b.fieldName);
  });

  return rows;
}
