import { describe, it, expect } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import {
  addDaysYmd,
  buildCumulativeSeries,
  countOrderPosts,
  defaultReportRangeYmd,
  filterOrdersByCentralDateRange,
  isYtdRange,
  niceAxisMax,
  currentSeasonYear,
  reportSeasons,
  seasonRangeYmd,
  summarizeOrdersForReport,
  summarizeProductSales,
} from '../../../src/lib/reports';

function makeOrder(over: Partial<StoredOrder> & Pick<StoredOrder, 'id' | 'createdAt' | 'status'>): StoredOrder {
  return {
    updatedAt: over.createdAt,
    customer: {
      name: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      email: 't@example.com',
      phone: '',
    },
    items: [
      {
        product: 'Premium Line',
        fieldName: 'premiumLine',
        quantity: 10,
        unitPrice: 15,
        lineTotal: 150,
      },
    ],
    subtotal: 150,
    volumeDiscount: { applied: false, rate: 0.1, amount: 0, mode: 'auto' },
    discountedSubtotal: 150,
    deposit: { selected: false, rate: 0.1, amount: 0 },
    orderTotal: 150,
    depositAmount: 0,
    balanceDue: 150,
    notes: null,
    deliverySlot: null,
    ...over,
  };
}

describe('reports aggregations', () => {
  it('defaultReportRangeYmd is Jan 1 through today (Central)', () => {
    const { from, to } = defaultReportRangeYmd();
    expect(from).toMatch(/^\d{4}-01-01$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from.slice(0, 4)).toBe(to.slice(0, 4));
    expect(isYtdRange(from, to)).toBe(true);
    expect(isYtdRange('2020-01-01', to)).toBe(false);
  });

  it('countOrderPosts excludes bow staves', () => {
    const o = makeOrder({
      id: '1',
      createdAt: '2026-03-15T12:00:00.000Z',
      status: 'pending',
      items: [
        {
          product: 'Premium Line',
          fieldName: 'premiumLine',
          quantity: 20,
          unitPrice: 15,
          lineTotal: 300,
        },
        {
          product: 'Bow',
          fieldName: 'bowStave',
          quantity: 2,
          unitPrice: 125,
          lineTotal: 250,
        },
      ],
    });
    expect(countOrderPosts(o)).toBe(20);
  });

  it('summarizeOrdersForReport splits open, fulfilled, and canceled', () => {
    const orders = [
      makeOrder({
        id: 'a',
        createdAt: '2026-02-01T18:00:00.000Z',
        status: 'pending',
        discountedSubtotal: 100,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 10,
            unitPrice: 10,
            lineTotal: 100,
          },
        ],
      }),
      makeOrder({
        id: 'b',
        createdAt: '2026-02-02T18:00:00.000Z',
        status: 'scheduled',
        discountedSubtotal: 200,
        items: [
          {
            product: 'P',
            fieldName: 'regularLine',
            quantity: 20,
            unitPrice: 10,
            lineTotal: 200,
          },
        ],
      }),
      makeOrder({
        id: 'c',
        createdAt: '2026-02-03T18:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 300,
        items: [
          {
            product: 'P',
            fieldName: 'discountBin',
            quantity: 30,
            unitPrice: 10,
            lineTotal: 300,
          },
        ],
      }),
      makeOrder({
        id: 'd',
        createdAt: '2026-02-04T18:00:00.000Z',
        status: 'canceled',
        discountedSubtotal: 50,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 10,
            lineTotal: 50,
          },
        ],
      }),
    ];

    const s = summarizeOrdersForReport(orders);
    expect(s.total.posts).toBe(65);
    expect(s.total.income).toBe(650);
    expect(s.total.orderCount).toBe(4);
    expect(s.open.posts).toBe(30);
    expect(s.open.income).toBe(300);
    expect(s.open.orderCount).toBe(2);
    expect(s.fulfilled.posts).toBe(30);
    expect(s.fulfilled.income).toBe(300);
    expect(s.fulfilled.orderCount).toBe(1);
    expect(s.canceled.posts).toBe(5);
    expect(s.canceled.income).toBe(50);
    expect(s.canceled.orderCount).toBe(1);
  });

  it('buildCumulativeSeries fills calendar days between first and last order', () => {
    const orders = [
      makeOrder({
        id: 'a',
        createdAt: '2026-06-01T17:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 100,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 10,
            unitPrice: 10,
            lineTotal: 100,
          },
        ],
      }),
      makeOrder({
        id: 'b',
        createdAt: '2026-06-01T20:00:00.000Z',
        status: 'pending',
        discountedSubtotal: 50,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 10,
            lineTotal: 50,
          },
        ],
      }),
      makeOrder({
        id: 'c',
        createdAt: '2026-06-15T17:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 200,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 20,
            unitPrice: 10,
            lineTotal: 200,
          },
        ],
      }),
    ];

    const series = buildCumulativeSeries(orders);
    expect(series).toHaveLength(15); // Jun 1 … Jun 15
    expect(series[0]!.date).toBe('2026-06-01');
    expect(series[0]!.posts).toBe(15);
    expect(series[0]!.income).toBe(150);
    expect(series[1]!.posts).toBe(15); // hold through gap
    expect(series[13]!.posts).toBe(15);
    expect(series[14]!.date).toBe('2026-06-15');
    expect(series[14]!.posts).toBe(35);
    expect(series[14]!.income).toBe(350);
  });

  it('buildCumulativeSeries pads 5 days before/after within range', () => {
    const orders = [
      makeOrder({
        id: 'a',
        createdAt: '2026-07-10T17:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 100,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 10,
            unitPrice: 10,
            lineTotal: 100,
          },
        ],
      }),
      makeOrder({
        id: 'b',
        createdAt: '2026-07-15T17:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 200,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 20,
            unitPrice: 10,
            lineTotal: 200,
          },
        ],
      }),
    ];

    const series = buildCumulativeSeries(orders, {
      rangeFrom: '2026-01-01',
      rangeTo: '2026-07-16',
      padDays: 5,
    });
    // first Jul 10 − 5 = Jul 5; last Jul 15 + 5 = Jul 20, clipped to Jul 16
    expect(series[0]!.date).toBe('2026-07-05');
    expect(series[0]!.posts).toBe(0);
    expect(series[0]!.income).toBe(0);
    expect(series.find((p) => p.date === '2026-07-10')!.posts).toBe(10);
    expect(series[series.length - 1]!.date).toBe('2026-07-16');
    expect(series[series.length - 1]!.posts).toBe(30);
    expect(series[series.length - 1]!.income).toBe(300);
  });

  it('buildCumulativeSeries padding does not extend past range start', () => {
    const orders = [
      makeOrder({
        id: 'a',
        createdAt: '2026-07-02T17:00:00.000Z',
        status: 'fulfilled',
        discountedSubtotal: 50,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 10,
            lineTotal: 50,
          },
        ],
      }),
    ];

    const series = buildCumulativeSeries(orders, {
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-10',
      padDays: 5,
    });
    expect(series[0]!.date).toBe('2026-07-01'); // not Jun 27
    expect(series[series.length - 1]!.date).toBe('2026-07-07'); // Jul 2 + 5
  });

  it('addDaysYmd shifts calendar days', () => {
    expect(addDaysYmd('2026-07-10', -5)).toBe('2026-07-05');
    expect(addDaysYmd('2026-07-15', 5)).toBe('2026-07-20');
    expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('filterOrdersByCentralDateRange respects inclusive bounds', () => {
    const orders = [
      makeOrder({ id: 'a', createdAt: '2026-01-15T18:00:00.000Z', status: 'pending' }),
      makeOrder({ id: 'b', createdAt: '2026-03-01T18:00:00.000Z', status: 'pending' }),
    ];
    const filtered = filterOrdersByCentralDateRange(orders, '2026-02-01', '2026-12-31');
    expect(filtered.map((o) => o.id)).toEqual(['b']);
  });

  it('niceAxisMax rounds up to 1/2/5×10^n', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(3)).toBe(5);
    expect(niceAxisMax(12)).toBe(20);
    expect(niceAxisMax(842)).toBe(1000);
  });
});

describe('summarizeProductSales', () => {
  it('groups dollars and volume by catalog label, including bow staves', () => {
    const orders = [
      makeOrder({
        id: 'a',
        createdAt: '2026-06-01T17:00:00.000Z',
        status: 'fulfilled',
        subtotal: 550,
        discountedSubtotal: 550,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 10,
            unitPrice: 20,
            lineTotal: 200,
          },
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 20,
            lineTotal: 100,
          },
          {
            product: 'Bow',
            fieldName: 'bowStave',
            quantity: 2,
            unitPrice: 125,
            lineTotal: 250,
          },
          {
            product: 'Empty',
            fieldName: 'regularCorner',
            quantity: 0,
            unitPrice: 15,
            lineTotal: 0,
          },
        ],
      }),
      makeOrder({
        id: 'b',
        createdAt: '2026-06-02T17:00:00.000Z',
        status: 'pending',
        subtotal: 40,
        discountedSubtotal: 40,
        items: [
          {
            product: 'R',
            fieldName: 'regularLine',
            quantity: 4,
            unitPrice: 10,
            lineTotal: 40,
          },
        ],
      }),
    ];

    const rows = summarizeProductSales(orders);
    expect(rows.map((r) => r.fieldName)).toEqual(['premiumLine', 'bowStave', 'regularLine']);
    expect(rows.map((r) => r.label)).toEqual([
      'Premium Line Posts',
      'Traditional Bow Stave Logs',
      'Regular Line Posts',
    ]);

    const bow = rows.find((r) => r.fieldName === 'bowStave')!;
    const premium = rows.find((r) => r.fieldName === 'premiumLine')!;
    const regular = rows.find((r) => r.fieldName === 'regularLine')!;
    expect(bow).toMatchObject({ dollars: 250, volume: 2 });
    expect(premium).toMatchObject({ dollars: 300, volume: 15 });
    expect(regular).toMatchObject({ dollars: 40, volume: 4 });
    expect(countOrderPosts(orders[0]!)).toBe(15);
    expect(rows.reduce((sum, r) => sum + r.dollars, 0)).toBe(590);
    expect(rows.reduce((sum, r) => sum + r.volume, 0)).toBe(21);
  });

  it('splits discounted income by pre-discount line total and sorts by the selected metric', () => {
    const orders = [
      makeOrder({
        id: 'disc',
        createdAt: '2026-07-01T17:00:00.000Z',
        status: 'fulfilled',
        subtotal: 300,
        discountedSubtotal: 10,
        volumeDiscount: { applied: true, amount: 290, mode: 'fixed', rate: 0 },
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 20,
            lineTotal: 100,
          },
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 5,
            unitPrice: 20,
            lineTotal: 100,
          },
          {
            product: 'R',
            fieldName: 'regularLine',
            quantity: 30,
            unitPrice: 10 / 3,
            lineTotal: 100,
          },
        ],
      }),
    ];

    const byDollars = summarizeProductSales(orders);
    expect(byDollars.map((r) => r.fieldName)).toEqual(['premiumLine', 'regularLine']);
    expect(byDollars[0]).toMatchObject({ dollars: 6.67, volume: 10 });
    expect(byDollars[1]).toMatchObject({ dollars: 3.33, volume: 30 });
    expect(byDollars[0]!.dollars + byDollars[1]!.dollars).toBe(10);

    const byVolume = summarizeProductSales(orders, { metric: 'volume' });
    expect(byVolume.map((r) => r.fieldName)).toEqual(['regularLine', 'premiumLine']);
    expect(byVolume[0]!.volume).toBe(30);
    expect(byVolume[1]!.dollars).toBe(6.67);
  });

  it('includes canceled orders, matching the Total card', () => {
    // Total income counts every order in range, including canceled.
    // Product sales follow that rule (not the Fulfilled card).
    const orders = [
      makeOrder({
        id: 'ok',
        createdAt: '2026-08-01T17:00:00.000Z',
        status: 'fulfilled',
        subtotal: 100,
        discountedSubtotal: 100,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 10,
            unitPrice: 10,
            lineTotal: 100,
          },
        ],
      }),
      makeOrder({
        id: 'canceled',
        createdAt: '2026-08-02T17:00:00.000Z',
        status: 'canceled',
        subtotal: 40,
        discountedSubtotal: 40,
        items: [
          {
            product: 'R',
            fieldName: 'regularLine',
            quantity: 4,
            unitPrice: 10,
            lineTotal: 40,
          },
        ],
      }),
    ];

    const summary = summarizeOrdersForReport(orders);
    const rows = summarizeProductSales(orders);
    const regular = rows.find((r) => r.fieldName === 'regularLine');

    expect(summary.total.income).toBe(140);
    expect(summary.total.orderCount).toBe(2);
    expect(summary.canceled.income).toBe(40);
    expect(summary.fulfilled.income).toBe(100);
    expect(regular).toMatchObject({ dollars: 40, volume: 4, label: 'Regular Line Posts' });
    expect(rows.reduce((sum, r) => sum + r.dollars, 0)).toBe(summary.total.income);
    expect(rows.reduce((sum, r) => sum + r.volume, 0)).toBe(14);
  });

  it('uses a caller label override and falls back to the stored product name', () => {
    const orders = [
      makeOrder({
        id: 'labels',
        createdAt: '2026-09-01T17:00:00.000Z',
        status: 'pending',
        subtotal: 30,
        discountedSubtotal: 30,
        items: [
          {
            product: 'P',
            fieldName: 'premiumLine',
            quantity: 1,
            unitPrice: 20,
            lineTotal: 20,
          },
          {
            product: 'Odd Lot',
            fieldName: 'mysterySku' as 'premiumLine',
            quantity: 1,
            unitPrice: 10,
            lineTotal: 10,
          },
        ],
      }),
    ];

    const rows = summarizeProductSales(orders, {
      labels: { premiumLine: 'Farm Premium' },
    });
    expect(rows.find((r) => r.fieldName === 'premiumLine')!.label).toBe('Farm Premium');
    expect(rows.find((r) => r.fieldName === 'mysterySku')!.label).toBe('Odd Lot');
  });
});

describe('report seasons', () => {
  it('2026 Season runs Jan 1 through Oct 31, 2026', () => {
    expect(seasonRangeYmd(2026)).toEqual({ from: '2026-01-01', to: '2026-10-31' });
  });

  it('later seasons run Nov 1 of the prior year through Oct 31', () => {
    expect(seasonRangeYmd(2027)).toEqual({ from: '2026-11-01', to: '2027-10-31' });
    expect(seasonRangeYmd(2028)).toEqual({ from: '2027-11-01', to: '2028-10-31' });
  });

  it('November and December belong to next year’s season', () => {
    expect(currentSeasonYear('2026-10-31')).toBe(2026);
    expect(currentSeasonYear('2026-11-01')).toBe(2027);
    expect(currentSeasonYear('2027-01-15')).toBe(2027);
  });

  it('lists every season from 2026 through the current one', () => {
    expect(reportSeasons('2026-06-01').map((s) => s.season)).toEqual([2026]);
    expect(reportSeasons('2026-11-23').map((s) => s.season)).toEqual([2026, 2027]);
    expect(reportSeasons('2027-11-02').map((s) => s.season)).toEqual([2026, 2027, 2028]);
  });
});
