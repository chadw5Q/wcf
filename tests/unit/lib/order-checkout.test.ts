import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('../../../src/lib/order-notify', () => ({
  sendOrderNotifications: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../src/lib/ntfy', () => ({
  publishNtfyNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/lib/contacts', () => ({
  attachOrderToContact: vi.fn().mockResolvedValue(undefined),
}));

import { sendOrderNotifications } from '../../../src/lib/order-notify';
import { publishNtfyNotification } from '../../../src/lib/ntfy';
import {
  PENDING_CHECKOUT_REUSE_MS,
  handleHedgeCheckoutEvent,
  pendingCheckoutKey,
} from '../../../src/lib/order-checkout';
import { getOrder, saveOrder } from '../../../src/lib/orders';
import { POST as postOrder } from '../../../src/pages/api/orders';

function memoryKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const bowStaves = {
  premiumLine: 0,
  premiumCorner: 0,
  regularLine: 0,
  regularCorner: 0,
  discountBin: 0,
  bowStave: 2,
};

function orderRequest(over: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerInfo: { firstName: 'Pat', lastName: 'Archer', email: 'pat@example.com', phone: '5550100' },
      quantities: bowStaves,
      depositSelected: true,
      depositPayRail: 'card',
      ...over,
    }),
  });
}

async function submit(kv: KVNamespace, over: Record<string, unknown> = {}) {
  const res = await postOrder({
    request: orderRequest(over),
    locals: { runtime: { env: { ORDERS_KV: kv } } },
  } as unknown as Parameters<typeof postOrder>[0]);
  return (await res.json()) as { orderId: string; reused?: boolean };
}

function session(orderId: string, over: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: 'cs_test_1',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 2575,
    metadata: { type: 'deposit', order_id: orderId, pay_rail: 'card' },
    ...over,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.mocked(sendOrderNotifications).mockClear();
  vi.mocked(sendOrderNotifications).mockResolvedValue({ ok: true });
  vi.mocked(publishNtfyNotification).mockClear();
});

describe('retries of the same unpaid card order', () => {
  it('reuse the first order instead of creating duplicates', async () => {
    const kv = memoryKv();
    const first = await submit(kv);
    const second = await submit(kv);
    const third = await submit(kv, {
      customerInfo: { firstName: 'Pat', lastName: 'Archer', email: 'PAT@example.com ', phone: '5550199' },
    });

    expect(second.orderId).toBe(first.orderId);
    expect(second.reused).toBe(true);
    expect(third.orderId).toBe(first.orderId);

    const saved = await getOrder(kv, first.orderId);
    expect(saved?.checkout?.state).toBe('awaiting_payment');
    expect(saved?.customer.phone).toBe('5550199');
    const orderKeys = [...kv.store.keys()].filter((k) => /^[0-9a-f-]{36}$/.test(k));
    expect(orderKeys).toHaveLength(1);
  });

  it('create a new order when the items, rail, or email differ', async () => {
    const kv = memoryKv();
    const a = await submit(kv);
    const b = await submit(kv, { quantities: { ...bowStaves, bowStave: 3 } });
    const c = await submit(kv, { depositPayRail: 'ach' });
    const d = await submit(kv, {
      customerInfo: { firstName: 'Sam', lastName: 'Other', email: 'sam@example.com' },
    });
    expect(new Set([a.orderId, b.orderId, c.orderId, d.orderId]).size).toBe(4);
  });

  it('create a new order once the first one is paid or older than the reuse window', async () => {
    const kv = memoryKv();
    const a = await submit(kv);
    await handleHedgeCheckoutEvent('checkout.session.completed', session(a.orderId), kv);
    const b = await submit(kv);
    expect(b.orderId).not.toBe(a.orderId);

    const stale = await getOrder(kv, b.orderId);
    await saveOrder(kv, {
      ...stale!,
      createdAt: new Date(Date.now() - PENDING_CHECKOUT_REUSE_MS - 60_000).toISOString(),
    });
    const c = await submit(kv);
    expect(c.orderId).not.toBe(b.orderId);
  });

  it('never dedupe Venmo or no-deposit orders', async () => {
    const kv = memoryKv();
    const a = await submit(kv, { depositPayRail: 'venmo' });
    const b = await submit(kv, { depositPayRail: 'venmo' });
    const c = await submit(kv, { depositSelected: false, depositPayRail: null });
    const d = await submit(kv, { depositSelected: false, depositPayRail: null });
    expect(new Set([a.orderId, b.orderId, c.orderId, d.orderId]).size).toBe(4);
    expect((await getOrder(kv, a.orderId))?.checkout).toBeUndefined();
  });

  it('keys hold no readable email', async () => {
    const key = await pendingCheckoutKey('pat@example.com', bowStaves, 'card');
    expect(key).not.toContain('pat');
  });
});

describe('handleHedgeCheckoutEvent', () => {
  it('sends the new-order alert only once Stripe says paid, and only once', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv);
    expect(sendOrderNotifications).not.toHaveBeenCalled();

    const r1 = await handleHedgeCheckoutEvent('checkout.session.completed', session(orderId), kv);
    const r2 = await handleHedgeCheckoutEvent('checkout.session.completed', session(orderId), kv);

    expect(r1.detail).toBe('paid_notified');
    expect(r2.detail).toBe('idempotent_already_paid');
    expect(sendOrderNotifications).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOrderNotifications).mock.calls[0][0]).toMatchObject({
      stage: 'paid',
      orderId,
      chargedUsd: 25.75,
    });
    const saved = await getOrder(kv, orderId);
    expect(saved?.checkout).toMatchObject({ state: 'paid', amountPaid: 25.75 });
    expect(saved?.checkout?.notifiedAt).toBeTruthy();
  });

  it('releases the claim when sending fails so a retry can send', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv);
    vi.mocked(sendOrderNotifications).mockResolvedValueOnce({ ok: false, status: 502, error: 'x' });
    const r1 = await handleHedgeCheckoutEvent('checkout.session.completed', session(orderId), kv);
    expect(r1.detail).toBe('paid_notify_failed');
    expect((await getOrder(kv, orderId))?.checkout?.notifiedAt).toBeUndefined();

    const r2 = await handleHedgeCheckoutEvent('checkout.session.completed', session(orderId), kv);
    expect(r2.detail).toBe('paid_notified');
    expect(sendOrderNotifications).toHaveBeenCalledTimes(2);
  });

  it('labels ACH as pending at checkout, then pushes again when it clears', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv, { depositPayRail: 'ach' });
    const ach = session(orderId, {
      payment_status: 'unpaid',
      metadata: { type: 'deposit', order_id: orderId, pay_rail: 'ach' },
    });

    await handleHedgeCheckoutEvent('checkout.session.completed', ach, kv);
    expect(vi.mocked(sendOrderNotifications).mock.calls[0][0].stage).toBe('ach_processing');
    expect((await getOrder(kv, orderId))?.checkout?.state).toBe('processing');

    await handleHedgeCheckoutEvent('checkout.session.async_payment_succeeded', ach, kv);
    expect(sendOrderNotifications).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishNtfyNotification).mock.calls[0][0].title).toMatch(/Bank deposit cleared/);
    expect((await getOrder(kv, orderId))?.checkout?.state).toBe('paid');
  });

  it('flags a failed ACH debit', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv, { depositPayRail: 'ach' });
    const ach = session(orderId, {
      payment_status: 'unpaid',
      metadata: { type: 'deposit', order_id: orderId, pay_rail: 'ach' },
    });
    await handleHedgeCheckoutEvent('checkout.session.completed', ach, kv);
    await handleHedgeCheckoutEvent('checkout.session.async_payment_failed', ach, kv);
    expect((await getOrder(kv, orderId))?.checkout?.state).toBe('failed');
    expect(vi.mocked(publishNtfyNotification).mock.calls[0][0].title).toMatch(/FAILED/);
  });

  it('marks an expired unpaid checkout abandoned and canceled', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv);
    const order = await getOrder(kv, orderId);
    await saveOrder(kv, { ...order!, checkout: { ...order!.checkout!, sessionId: 'cs_test_1' } });

    const r = await handleHedgeCheckoutEvent(
      'checkout.session.expired',
      session(orderId, { status: 'expired', payment_status: 'unpaid' }),
      kv
    );
    expect(r.detail).toBe('abandoned');
    const saved = await getOrder(kv, orderId);
    expect(saved?.checkout?.state).toBe('abandoned');
    expect(saved?.status).toBe('canceled');
    expect(sendOrderNotifications).not.toHaveBeenCalled();
    expect(vi.mocked(publishNtfyNotification).mock.calls[0][0].title).toMatch(
      /Checkout abandoned, not paid/
    );

    // A later retry starts a fresh order rather than reviving the abandoned one.
    const again = await submit(kv);
    expect(again.orderId).not.toBe(orderId);
  });

  it('ignores expiry of a replaced session and of paid orders', async () => {
    const kv = memoryKv();
    const { orderId } = await submit(kv);
    const order = await getOrder(kv, orderId);
    await saveOrder(kv, { ...order!, checkout: { ...order!.checkout!, sessionId: 'cs_test_new' } });

    const stale = await handleHedgeCheckoutEvent(
      'checkout.session.expired',
      session(orderId, { id: 'cs_test_old', status: 'expired', payment_status: 'unpaid' }),
      kv
    );
    expect(stale.detail).toBe('ignored_stale_session');

    await handleHedgeCheckoutEvent('checkout.session.completed', session(orderId, { id: 'cs_test_new' }), kv);
    const late = await handleHedgeCheckoutEvent(
      'checkout.session.expired',
      session(orderId, { id: 'cs_test_new', status: 'expired' }),
      kv
    );
    expect(late.detail).toBe('ignored_state_paid');
    expect((await getOrder(kv, orderId))?.status).toBe('pending');
  });
});
