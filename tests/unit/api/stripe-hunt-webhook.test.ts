import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

const constructEvent = vi.fn();

vi.mock('../../../src/lib/stripe', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: (body: string, sig: string, secret: string) => constructEvent(body, sig, secret),
    },
  }),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/webhooks/stripe-hunt';
import { createDraftReservation, getReservation, putReservation } from '../../../src/lib/hunt-reservations';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe('POST /api/webhooks/stripe-hunt', () => {
  beforeEach(() => {
    constructEvent.mockReset();
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET_HUNT') return 'whsec_test';
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
      return undefined;
    });
  });

  it('returns 503 when webhook secret is missing', async () => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    const res = await POST({
      request: new Request('http://localhost/api/webhooks/stripe-hunt', { method: 'POST', body: '{}' }),
      locals: { runtime: { env: { HUNT_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    const res = await POST({
      request: new Request('http://localhost/api/webhooks/stripe-hunt', {
        method: 'POST',
        body: '{}',
      }),
      locals: { runtime: { env: { HUNT_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid signature', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const res = await POST({
      request: new Request('http://localhost/api/webhooks/stripe-hunt', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=abc' },
        body: '{}',
      }),
      locals: { runtime: { env: { HUNT_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('handles checkout.session.completed for hunt deposit', async () => {
    const kv = memoryKv();
    const reservation = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [
        {
          firstName: 'A',
          lastName: 'B',
          email: 'a@example.com',
          phone: '7125550100',
          state: 'IA',
        },
      ],
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
      notes: null,
    });
    await putReservation(kv, reservation);

    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_evt_1',
          payment_status: 'paid',
          metadata: {
            hunt_checkout_kind: 'deposit',
            reservation_id: reservation.id,
          },
        },
      },
    });

    const res = await POST({
      request: new Request('http://localhost/api/webhooks/stripe-hunt', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=ok' },
        body: '{"x":1}',
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { received: boolean; hunt: { handled: boolean } };
    expect(json.received).toBe(true);
    expect(json.hunt.handled).toBe(true);
  });

  it('handles checkout.session.completed for hunt balance', async () => {
    const kv = memoryKv();
    let reservation = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [
        {
          firstName: 'A',
          lastName: 'B',
          email: 'a@example.com',
          phone: '7125550100',
          state: 'IA',
        },
      ],
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
      notes: null,
    });
    reservation = { ...reservation, status: 'deposit_paid', stripeDepositSessionId: 'cs_dep_x' };
    await putReservation(kv, reservation);

    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_balance_evt',
          payment_status: 'paid',
          metadata: {
            hunt_checkout_kind: 'balance',
            reservation_id: reservation.id,
          },
        },
      },
    });

    const res = await POST({
      request: new Request('http://localhost/api/webhooks/stripe-hunt', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=ok' },
        body: '{"x":1}',
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { hunt: { handled: boolean; detail?: string } };
    expect(json.hunt.handled).toBe(true);

    const stored = await getReservation(kv, reservation.id);
    expect(stored?.status).toBe('balance_paid');
  });
});
