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

export function defaultReportRangeYmd(): { from: string; to: string } {
  const now = Date.now();
  const to = dateKeyCentral(now);
  const approxStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const from = dateKeyCentral(approxStart);
  return { from, to };
}
