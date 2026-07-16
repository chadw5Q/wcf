import type { StoredOrder } from './order-types';

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

  for (const o of orders) {
    addOrderToBucket(total, o);
    if (o.status === 'fulfilled') {
      addOrderToBucket(fulfilled, o);
    } else {
      // pending + scheduled (+ any legacy unexpected status)
      addOrderToBucket(open, o);
    }
  }

  return { total, open, fulfilled };
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

/**
 * Cumulative posts + income by order createdAt day (Central), ascending.
 * Returns one point per day that has activity (staircase steps).
 */
export function buildCumulativeSeries(orders: StoredOrder[]): CumulativePoint[] {
  const byDay = new Map<string, { posts: number; income: number }>();

  for (const o of orders) {
    const day = dateKeyCentral(o.createdAt);
    const cur = byDay.get(day) ?? { posts: 0, income: 0 };
    cur.posts += countOrderPosts(o);
    cur.income += o.discountedSubtotal;
    byDay.set(day, cur);
  }

  const days = [...byDay.keys()].sort();
  let posts = 0;
  let income = 0;
  const out: CumulativePoint[] = [];

  for (const day of days) {
    const dayTotals = byDay.get(day)!;
    posts += dayTotals.posts;
    income = Math.round((income + dayTotals.income) * 100) / 100;
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
