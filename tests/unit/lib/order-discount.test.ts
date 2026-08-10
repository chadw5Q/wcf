import { describe, it, expect } from 'vitest';
import {
  normalizeVolumeDiscount,
  resolveOrderDiscount,
  volumeDiscountLabel,
  rebuildStoredOrder,
  buildStoredOrder,
} from '../../../src/lib/orders';
import { getDefaultOrderSkuMap } from '../../../src/lib/products-config';

const skuMap = getDefaultOrderSkuMap();

describe('resolveOrderDiscount', () => {
  it('applies auto 10% at 100+ posts and nothing under', () => {
    expect(resolveOrderDiscount(1000, 100, { mode: 'auto' })).toMatchObject({
      applied: true,
      amount: 100,
      mode: 'auto',
      rate: 0.1,
    });
    expect(resolveOrderDiscount(1000, 99, { mode: 'auto' })).toMatchObject({
      applied: false,
      amount: 0,
      mode: 'auto',
    });
  });

  it('applies custom percent regardless of post count', () => {
    expect(resolveOrderDiscount(200, 10, { mode: 'percent', percent: 15 })).toMatchObject({
      applied: true,
      amount: 30,
      mode: 'percent',
      rate: 0.15,
    });
  });

  it('caps fixed dollar discount at subtotal', () => {
    expect(resolveOrderDiscount(40, 5, { mode: 'fixed', fixedAmount: 50 })).toMatchObject({
      applied: true,
      amount: 40,
      mode: 'fixed',
    });
  });

  it('supports none even at 100+ posts', () => {
    expect(resolveOrderDiscount(1000, 150, { mode: 'none' })).toMatchObject({
      applied: false,
      amount: 0,
      mode: 'none',
    });
  });
});

describe('normalizeVolumeDiscount', () => {
  it('treats legacy records without mode as auto', () => {
    expect(normalizeVolumeDiscount({ applied: true, rate: 0.1, amount: 100 })).toMatchObject({
      mode: 'auto',
      amount: 100,
      applied: true,
    });
    expect(normalizeVolumeDiscount({ applied: false, rate: 0.1, amount: 0 })).toMatchObject({
      mode: 'auto',
      amount: 0,
    });
  });
});

describe('volumeDiscountLabel', () => {
  it('labels auto, percent, and fixed distinctly', () => {
    expect(volumeDiscountLabel({ applied: true, amount: 100, mode: 'auto', rate: 0.1 })).toBe(
      'Volume discount (10%)'
    );
    expect(volumeDiscountLabel({ applied: true, amount: 30, mode: 'percent', rate: 0.15 })).toBe(
      'Discount (15%)'
    );
    expect(volumeDiscountLabel({ applied: true, amount: 50, mode: 'fixed', rate: 0 })).toBe(
      'Discount'
    );
    expect(volumeDiscountLabel({ applied: false, amount: 0, mode: 'none', rate: 0 })).toBeNull();
  });
});

describe('rebuildStoredOrder discount override', () => {
  it('persists a percent discount under 100 posts', () => {
    const existing = buildStoredOrder(
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: null,
        depositSelected: false,
        quantities: {
          premiumLine: 0,
          premiumCorner: 0,
          regularLine: 0,
          regularCorner: 0,
          discountBin: 20,
          bowStave: 0,
        },
      },
      'id-d',
      '2026-01-01T00:00:00.000Z',
      skuMap
    );
    expect(existing.volumeDiscount.applied).toBe(false);

    const next = rebuildStoredOrder(
      existing,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: null,
        quantities: {
          premiumLine: 0,
          premiumCorner: 0,
          regularLine: 0,
          regularCorner: 0,
          discountBin: 20,
          bowStave: 0,
        },
        depositAmount: 0,
        discount: { mode: 'percent', percent: 10 },
      },
      skuMap
    );
    expect(next.volumeDiscount.mode).toBe('percent');
    expect(next.volumeDiscount.applied).toBe(true);
    expect(next.discountedSubtotal).toBe(next.subtotal - next.volumeDiscount.amount);
  });
});
