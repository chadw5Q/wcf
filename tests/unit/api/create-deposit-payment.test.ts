import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

const createCheckoutSession = vi.fn();
const getCheckoutSession = vi.fn();

vi.mock('../../../src/lib/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  getCheckoutSession: (...args: unknown[]) => getCheckoutSession(...args),
  stripeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/create-deposit-payment';
import { buildStoredOrder, getOrder, saveOrder } from '../../../src/lib/orders';
import { getDefaultOrderSkuMap } from '../../../src/lib/products-config';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

async function savedCardOrder(kv: KVNamespace) {
  const order = buildStoredOrder(
    {
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      phone: '',
      notes: null,
      depositSelected: true,
      depositPayRail: 'card',
      quantities: { bowStave: 2 },
    },
    'order-1',
    new Date().toISOString(),
    getDefaultOrderSkuMap()
  );
  order.checkout = { state: 'awaiting_payment', updatedAt: order.createdAt };
  await saveOrder(kv, order);
  return order;
}

function orderBody(over: Record<string, unknown> = {}) {
  return {
    depositAmount: 999,
    orderTotal: 9990,
    orderId: 'order-1',
    payRail: 'card',
    customerInfo: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
    orderItems: [],
    quantities: { bowStave: 2 },
    ...over,
  };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/create-deposit-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/create-deposit-payment', () => {
  beforeEach(() => {
    createCheckoutSession.mockClear();
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined
    );
    createCheckoutSession.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/c/pay',
    });
  });

  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest({
        depositAmount: 10,
        orderTotal: 100,
        customerInfo: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
        orderItems: [],
        quantities: { premiumLine: 4, premiumCorner: 0, regularLine: 0, regularCorner: 0, discountBin: 0, bowStave: 0 },
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('returns 400 when deposit is under Stripe minimum', async () => {
    const res = await POST({
      request: jsonRequest({
        depositAmount: 0.25,
        orderTotal: 2.5,
        customerInfo: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
        orderItems: [],
        quantities: { premiumLine: 1, premiumCorner: 0, regularLine: 0, regularCorner: 0, discountBin: 0, bowStave: 0 },
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 200 with checkout URL when valid', async () => {
    const res = await POST({
      request: jsonRequest({
        depositAmount: 10,
        orderTotal: 100,
        customerInfo: {
          firstName: 'A',
          lastName: 'B',
          email: 'buyer@example.com',
          phone: '7125550100',
          notes: '',
        },
        orderItems: [{ type: 'Premium Line Posts', quantity: 4, price: 25, total: 100 }],
        quantities: { premiumLine: 4, premiumCorner: 0, regularLine: 0, regularCorner: 0, discountBin: 0, bowStave: 0 },
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('stripe');
    expect(createCheckoutSession).toHaveBeenCalled();
  });

  it('includes order_id in Stripe metadata when orderId is provided', async () => {
    const oid = '550e8400-e29b-41d4-a716-446655440000';
    await POST({
      request: jsonRequest({
        depositAmount: 10,
        orderTotal: 100,
        orderId: oid,
        customerInfo: {
          firstName: 'A',
          lastName: 'B',
          email: 'buyer@example.com',
          phone: '7125550100',
          notes: '',
        },
        orderItems: [{ type: 'Premium Line Posts', quantity: 4, price: 25, total: 100 }],
        quantities: { premiumLine: 4, premiumCorner: 0, regularLine: 0, regularCorner: 0, discountBin: 0, bowStave: 0 },
      }),
    } as Parameters<typeof POST>[0]);
    expect(createCheckoutSession).toHaveBeenCalled();
    const call = createCheckoutSession.mock.calls[createCheckoutSession.mock.calls.length - 1];
    const opts = call[1] as { metadata?: Record<string, string> };
    expect(opts?.metadata?.order_id).toBe(oid);
    expect(opts?.metadata?.orderId).toBe(oid);
  });

  it('uses the saved order amounts and records the new session with a 1 hour expiry', async () => {
    const kv = memoryKv();
    const order = await savedCardOrder(kv);
    createCheckoutSession.mockResolvedValueOnce({
      id: 'cs_new',
      url: 'https://checkout.stripe.test/new',
      expires_at: 1_900_000_000,
    });
    const res = await POST({
      request: jsonRequest(orderBody()),
      locals: { runtime: { env: { ORDERS_KV: kv } } },
    } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const [, opts] = createCheckoutSession.mock.calls.at(-1) as [unknown, { metadata: Record<string, string>; expiresAt: number }];
    expect(opts.metadata.deposit_amount).toBe(String(order.depositAmount));
    expect(opts.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(3500);
    const saved = await getOrder(kv, 'order-1');
    expect(saved?.checkout).toMatchObject({ state: 'awaiting_payment', sessionId: 'cs_new' });
  });

  it('returns the still-open session on a retry instead of creating another', async () => {
    const kv = memoryKv();
    const order = await savedCardOrder(kv);
    await saveOrder(kv, { ...order, checkout: { ...order.checkout!, sessionId: 'cs_open' } });
    getCheckoutSession.mockResolvedValueOnce({
      id: 'cs_open',
      status: 'open',
      url: 'https://checkout.stripe.test/open',
      metadata: { pay_rail: 'card' },
    });
    createCheckoutSession.mockClear();
    const res = await POST({
      request: jsonRequest(orderBody()),
      locals: { runtime: { env: { ORDERS_KV: kv } } },
    } as unknown as Parameters<typeof POST>[0]);
    const body = await res.json();
    expect(body).toMatchObject({ sessionId: 'cs_open', reused: true });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a new checkout for an order that is already paid', async () => {
    const kv = memoryKv();
    const order = await savedCardOrder(kv);
    await saveOrder(kv, { ...order, checkout: { ...order.checkout!, state: 'paid' } });
    createCheckoutSession.mockClear();
    const res = await POST({
      request: jsonRequest(orderBody()),
      locals: { runtime: { env: { ORDERS_KV: kv } } },
    } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(409);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});
