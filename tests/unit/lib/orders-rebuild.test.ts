import { describe, it, expect } from 'vitest';
import {
  adminRebuildMatchesExisting,
  buildStoredOrder,
  rebuildStoredOrder,
} from '../../../src/lib/orders';
import type { StoredOrder } from '../../../src/lib/order-types';
import { getDefaultOrderSkuMap } from '../../../src/lib/products-config';

const skuMap = getDefaultOrderSkuMap();

const baseQuantities = {
  premiumLine: 2,
  premiumCorner: 0,
  regularLine: 0,
  regularCorner: 0,
  discountBin: 0,
  bowStave: 0,
};

function makeOrder(over?: Partial<StoredOrder>): StoredOrder {
  const o = buildStoredOrder(
    {
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      phone: '555',
      notes: 'n1',
      depositSelected: true,
      quantities: baseQuantities,
    },
    'id-1',
    '2026-01-01T00:00:00.000Z',
    skuMap
  );
  return { ...o, ...over };
}

describe('admin order rebuild', () => {
  it('applies an explicit dollar deposit amount from admin', () => {
    const existing = makeOrder({
      deposit: { selected: false, rate: 0.1, amount: 0 },
      depositAmount: 0,
      balanceDue: 50,
    });
    // premiumLine 2 @ $25 = $50 with defaults
    const next = rebuildStoredOrder(
      existing,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: baseQuantities,
        depositAmount: 20,
      },
      skuMap
    );
    expect(next.deposit.selected).toBe(true);
    expect(next.depositAmount).toBe(20);
    expect(next.balanceDue).toBe(next.discountedSubtotal - 20);
  });

  it('allows clearing deposit with depositAmount 0', () => {
    const existing = makeOrder();
    const next = rebuildStoredOrder(
      existing,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: baseQuantities,
        depositAmount: 0,
      },
      skuMap
    );
    expect(next.deposit.selected).toBe(false);
    expect(next.depositAmount).toBe(0);
    expect(next.balanceDue).toBe(next.discountedSubtotal);
  });

  it('clamps deposit amount to the order total', () => {
    const existing = makeOrder();
    const next = rebuildStoredOrder(
      existing,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: baseQuantities,
        depositAmount: 99999,
      },
      skuMap
    );
    expect(next.depositAmount).toBe(next.discountedSubtotal);
    expect(next.balanceDue).toBe(0);
  });

  it('preserves deposit.selected and recalculates deposit amount when totals change', () => {
    const existing = makeOrder({ deposit: { selected: true, rate: 0.1, amount: 5 } });
    const next = rebuildStoredOrder(
      existing,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: { ...baseQuantities, premiumLine: 10 },
      },
      skuMap
    );
    expect(next.deposit.selected).toBe(true);
    expect(next.deposit.amount).toBeGreaterThan(existing.deposit.amount);
    expect(next.revisionLog?.length).toBe(1);
    expect(next.revisionLog?.[0].action).toBe('rebuild');
  });

  it('keeps deposit amount zero when deposit was not selected', () => {
    const e = buildStoredOrder(
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: null,
        depositSelected: false,
        quantities: baseQuantities,
      },
      'id-2',
      '2026-01-01T00:00:00.000Z',
      skuMap
    );
    const next = rebuildStoredOrder(
      e,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: null,
        quantities: { ...baseQuantities, premiumLine: 5 },
      },
      skuMap
    );
    expect(next.deposit.selected).toBe(false);
    expect(next.depositAmount).toBe(0);
  });

  it('adminRebuildMatchesExisting detects identical payload', () => {
    const existing = makeOrder();
    expect(
      adminRebuildMatchesExisting(existing, {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: baseQuantities,
      })
    ).toBe(true);
    expect(
      adminRebuildMatchesExisting(existing, {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: { ...baseQuantities, premiumLine: 3 },
      })
    ).toBe(false);
    expect(
      adminRebuildMatchesExisting(existing, {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '555',
        notes: 'n1',
        quantities: baseQuantities,
        depositAmount: existing.depositAmount + 1,
      })
    ).toBe(false);
  });
});
