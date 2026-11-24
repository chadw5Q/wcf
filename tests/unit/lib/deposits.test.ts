import { describe, it, expect } from 'vitest';
import {
  amountStillOwed,
  depositState,
  huntDepositSummary,
  huntPartyOutstanding,
  isOpenDepositOrder,
  isOpenDepositReservation,
  orderCategory,
} from '../../../src/lib/deposits';
import { applyOrderMetaPatch } from '../../../src/lib/orders';
import { createDraftReservation, type HuntReservation } from '../../../src/lib/hunt-reservations';
import type { OrderLineItem, StoredOrder } from '../../../src/lib/order-types';

const posts: OrderLineItem = {
  product: 'Premium Line Posts',
  fieldName: 'premiumLine',
  quantity: 10,
  unitPrice: 25,
  lineTotal: 250,
};
const staves: OrderLineItem = {
  product: 'Bow Stave Log',
  fieldName: 'bowStave',
  quantity: 2,
  unitPrice: 75,
  lineTotal: 150,
};

function order(over: Partial<StoredOrder> = {}): StoredOrder {
  const items = over.items ?? [posts];
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    id: 'o1',
    createdAt: '2026-11-01T15:00:00.000Z',
    customer: { name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '7125550100' },
    items,
    subtotal: total,
    volumeDiscount: { applied: false, rate: 0, amount: 0, mode: 'none' },
    discountedSubtotal: total,
    deposit: { selected: true, rate: 0.1, amount: total * 0.1 },
    orderTotal: total,
    depositAmount: total * 0.1,
    balanceDue: total * 0.9,
    notes: null,
    deliverySlot: null,
    status: 'pending',
    ...over,
  };
}

describe('depositState / amountStillOwed', () => {
  it('Venmo deposit is pending and not credited until marked received', () => {
    const o = order({ depositPayRail: 'venmo' });
    expect(depositState(o)).toBe('pending');
    expect(amountStillOwed(o)).toBe(250);

    applyOrderMetaPatch(o, { depositReceived: true }, new Date('2026-11-02T12:00:00Z'));
    expect(depositState(o)).toBe('received');
    expect(o.depositReceived?.via).toBe('manual');
    expect(amountStillOwed(o)).toBe(225);
    expect(o.revisionLog?.at(-1)?.summary).toContain('Deposit marked received');

    applyOrderMetaPatch(o, { depositReceived: false });
    expect(o.depositReceived).toBeUndefined();
    expect(depositState(o)).toBe('pending');
  });

  it('Stripe-paid deposit counts as received; ACH still clearing does not', () => {
    const paid = order({
      depositPayRail: 'card',
      checkout: { state: 'paid', updatedAt: '2026-11-01T15:05:00.000Z' },
    });
    expect(depositState(paid)).toBe('received');
    expect(amountStillOwed(paid)).toBe(225);

    const clearing = order({
      depositPayRail: 'ach',
      checkout: { state: 'processing', updatedAt: '2026-11-01T15:05:00.000Z' },
    });
    expect(depositState(clearing)).toBe('pending');
    expect(amountStillOwed(clearing)).toBe(250);
  });

  it('no deposit means none and not on the list', () => {
    const o = order({ deposit: { selected: false, rate: 0.1, amount: 0 }, depositAmount: 0 });
    expect(depositState(o)).toBe('none');
    expect(isOpenDepositOrder(o)).toBe(false);
  });

  it('refuses to mark received on an order with no deposit', () => {
    const o = order({ deposit: { selected: false, rate: 0.1, amount: 0 }, depositAmount: 0 });
    expect(() => applyOrderMetaPatch(o, { depositReceived: true })).toThrow();
  });

  it('fulfilled and canceled orders drop off the list', () => {
    expect(isOpenDepositOrder(order({ status: 'fulfilled' }))).toBe(false);
    expect(isOpenDepositOrder(order({ status: 'canceled' }))).toBe(false);
    expect(isOpenDepositOrder(order({ status: 'scheduled' }))).toBe(true);
  });
});

describe('orderCategory', () => {
  it('splits posts, staves, and mixed orders', () => {
    expect(orderCategory(order({ items: [posts] }))).toBe('posts');
    expect(orderCategory(order({ items: [staves] }))).toBe('staves');
    expect(orderCategory(order({ items: [posts, staves] }))).toBe('both');
    expect(orderCategory(order({ items: [{ ...posts, quantity: 0 }] }))).toBe('none');
  });
});

function party(over: Partial<HuntReservation> = {}): HuntReservation {
  const r = createDraftReservation({
    huntYear: 2026,
    preferredWeek: 'w1',
    pricingModel: 'per_person',
    mealPackage: false,
    hunters: [
      { firstName: 'Al', lastName: 'Lead', email: 'al@example.com', phone: '1', state: 'IA' },
      { firstName: 'Bo', lastName: 'Two', email: 'bo@example.com', phone: '2', state: 'NE' },
    ],
    huntCostPerPerson: 1000,
    mealPackageCost: 0,
    totalHuntCost: 2000,
    depositPerPerson: 250,
    totalDeposit: 500,
    balanceDue: 1500,
    notes: null,
  });
  return { ...r, ...over };
}

describe('hunt deposits', () => {
  it('Venmo/check draft (no Stripe session) is listed as pending', () => {
    const r = party();
    expect(isOpenDepositReservation(r)).toBe(true);
    expect(huntDepositSummary(r).state).toBe('pending');
  });

  it('abandoned card checkout draft stays off the list', () => {
    expect(isOpenDepositReservation(party({ stripeDepositSessionId: 'cs_test_1' }))).toBe(false);
  });

  it('partial deposits show x of y and reduce what is owed', () => {
    const r = party({ status: 'deposit_paid' });
    const before = huntPartyOutstanding(r);
    r.hunterPayments[0] = { ...r.hunterPayments[0]!, depositPaid: true, depositMethod: 'venmo' };
    const s = huntDepositSummary(r);
    expect(s.state).toBe('received');
    expect(s.paid).toBe(1);
    expect(s.total).toBe(2);
    expect(huntPartyOutstanding(r)).toBeLessThan(before);
  });

  it('cancelled parties are excluded', () => {
    const r = party({ status: 'cancelled' });
    r.hunterPayments[0] = { ...r.hunterPayments[0]!, depositPaid: true };
    expect(isOpenDepositReservation(r)).toBe(false);
  });
});
