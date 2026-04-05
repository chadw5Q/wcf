import { describe, it, expect, beforeEach } from 'vitest';
import { applyCalBookingToOrder, buildStoredOrder } from '../../../src/lib/orders';
import { getDefaultOrderSkuMap } from '../../../src/lib/products-config';

const skuMap = getDefaultOrderSkuMap();

const baseInput = {
  firstName: 'A',
  lastName: 'B',
  email: 'a@b.com',
  phone: '',
  notes: null,
  depositSelected: false,
  quantities: { premiumLine: 1, premiumCorner: 0, premiumExtraLong: 0, regularLine: 0, regularCorner: 0, bowStave: 0 },
};

describe('applyCalBookingToOrder', () => {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as KVNamespace;

  beforeEach(() => {
    store.clear();
  });

  it('sets delivery slot and status to scheduled', async () => {
    const id = 'a0a84e55-7879-4b3a-980f-6fafe4bff099';
    const order = buildStoredOrder(baseInput, id, new Date().toISOString(), skuMap);
    await kv.put(id, JSON.stringify(order));

    const slot = 'Mon, Apr 6, 2026, 9:00 AM – 9:30 AM CDT';
    const { order: out, updated } = await applyCalBookingToOrder(kv, id, slot, 'BOOKING_CREATED');
    expect(updated).toBe(true);
    expect(out?.deliverySlot).toBe(slot);
    expect(out?.status).toBe('scheduled');
    const roundTrip = JSON.parse(store.get(id)!);
    expect(roundTrip.status).toBe('scheduled');
  });

  it('clears slot and moves scheduled back to pending', async () => {
    const id = 'b1b95e66-898a-5c4b-991a-7a0a5cff1aa0';
    const order = buildStoredOrder(baseInput, id, new Date().toISOString(), skuMap);
    order.deliverySlot = 'Old slot';
    order.status = 'scheduled';
    await kv.put(id, JSON.stringify(order));

    const { order: out, updated } = await applyCalBookingToOrder(kv, id, null, 'BOOKING_CANCELLED');
    expect(updated).toBe(true);
    expect(out?.deliverySlot).toBeNull();
    expect(out?.status).toBe('pending');
  });
});
