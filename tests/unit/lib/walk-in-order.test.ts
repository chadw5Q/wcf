import { describe, it, expect } from 'vitest';
import { createWalkInStoredOrder } from '../../../src/lib/orders';
import { getDefaultOrderSkuMap } from '../../../src/lib/products-config';

const skuMap = getDefaultOrderSkuMap();

const quantities = {
  premiumLine: 2,
  premiumCorner: 0,
  regularLine: 0,
  regularCorner: 0,
  discountBin: 0,
  bowStave: 0,
};

describe('createWalkInStoredOrder', () => {
  it('defaults to fulfilled with deposit override and revision log', () => {
    const order = createWalkInStoredOrder(
      {
        firstName: 'Pat',
        lastName: 'Customer',
        email: 'pat@example.com',
        phone: '7125550111',
        notes: 'Cash',
        quantities,
        depositAmount: 5,
      },
      'walk-1',
      '2026-07-13T12:00:00.000Z',
      skuMap
    );

    expect(order.status).toBe('fulfilled');
    expect(order.depositAmount).toBe(5);
    expect(order.deposit.selected).toBe(true);
    expect(order.balanceDue).toBe(order.discountedSubtotal - 5);
    expect(order.revisionLog?.[0].summary).toMatch(/Walk-in order created/);
    expect(order.revisionLog?.[0].details?.source).toBe('admin_walk_in');
  });

  it('can create pending with pickup slot', () => {
    const order = createWalkInStoredOrder(
      {
        firstName: 'Pat',
        lastName: 'Customer',
        email: 'pat@example.com',
        phone: '',
        notes: null,
        quantities,
        depositAmount: 0,
        status: 'pending',
        deliverySlot: 'Sat morning',
      },
      'walk-2',
      '2026-07-13T12:00:00.000Z',
      skuMap
    );
    expect(order.status).toBe('pending');
    expect(order.deliverySlot).toBe('Sat morning');
    expect(order.depositAmount).toBe(0);
  });
});
