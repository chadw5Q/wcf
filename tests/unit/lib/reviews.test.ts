import { describe, it, expect } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import {
  createStoredReview,
  defaultDisplayName,
  productSkusFromOrder,
} from '../../../src/lib/reviews';

function order(partial?: Partial<StoredOrder>): StoredOrder {
  return {
    id: 'ord-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    customer: {
      name: 'David Parker',
      firstName: 'David',
      lastName: 'Parker',
      email: 'd@example.com',
      phone: '555',
    },
    items: [
      {
        product: 'Premium Line',
        fieldName: 'premiumLine',
        quantity: 20,
        unitPrice: 10,
        lineTotal: 200,
      },
      {
        product: 'Bow stave',
        fieldName: 'bowStave',
        quantity: 0,
        unitPrice: 50,
        lineTotal: 0,
      },
    ],
    subtotal: 200,
    volumeDiscount: { applied: false, rate: 0.1, amount: 0 },
    discountedSubtotal: 200,
    deposit: { selected: false, rate: 0.1, amount: 0 },
    orderTotal: 200,
    depositAmount: 0,
    balanceDue: 200,
    notes: null,
    deliverySlot: null,
    status: 'fulfilled',
    ...partial,
  };
}

describe('createStoredReview', () => {
  it('rejects rating 0 and 6', () => {
    expect(createStoredReview({ order: order(), rating: 0 }).ok).toBe(false);
    expect(createStoredReview({ order: order(), rating: 6 }).ok).toBe(false);
  });

  it('defaults display name to First L. and honors first-name-only', () => {
    expect(defaultDisplayName(order())).toBe('David P.');
    expect(defaultDisplayName(order(), true)).toBe('David');
    const r = createStoredReview({ order: order(), rating: 5, firstNameOnly: true });
    expect(r.ok && r.review.displayName).toBe('David');
  });

  it('derives productSkus from non-zero line items only', () => {
    expect(productSkusFromOrder(order())).toEqual(['premiumLine']);
  });

  it('defaults state new, featured false, photo none', () => {
    const r = createStoredReview({ order: order(), rating: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.review.state).toBe('new');
    expect(r.review.featured).toBe(false);
    expect(r.review.photoState).toBe('none');
  });

  it('rejects comment over max length', () => {
    const r = createStoredReview({ order: order(), rating: 5, comment: 'x'.repeat(2001) });
    expect(r.ok).toBe(false);
  });
});
