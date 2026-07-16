import { describe, it, expect } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import {
  buildCumulativeSeries,
  countOrderPosts,
  defaultReportRangeYmd,
  filterOrdersByCentralDateRange,
  isYtdRange,
  niceAxisMax,
  summarizeOrdersForReport,
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
    volumeDiscount: { applied: false, rate: 0.1, amount: 0 },
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

  it('summarizeOrdersForReport splits open vs fulfilled', () => {
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
    ];

    const s = summarizeOrdersForReport(orders);
    expect(s.total.posts).toBe(60);
    expect(s.total.income).toBe(600);
    expect(s.total.orderCount).toBe(3);
    expect(s.open.posts).toBe(30);
    expect(s.open.income).toBe(300);
    expect(s.open.orderCount).toBe(2);
    expect(s.fulfilled.posts).toBe(30);
    expect(s.fulfilled.income).toBe(300);
    expect(s.fulfilled.orderCount).toBe(1);
  });

  it('buildCumulativeSeries accumulates by Central day', () => {
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
    expect(series).toHaveLength(2);
    expect(series[0]!.posts).toBe(15);
    expect(series[0]!.income).toBe(150);
    expect(series[1]!.posts).toBe(35);
    expect(series[1]!.income).toBe(350);
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
