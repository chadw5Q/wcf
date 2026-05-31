import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

const createCheckoutSession = vi.fn();

vi.mock('../../../src/lib/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  stripeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/hunt-balance';
import { createDraftReservation, putReservation } from '../../../src/lib/hunt-reservations';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    list: async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  } as unknown as KVNamespace;
}

function jsonRequest(body: unknown, origin = 'http://localhost:4321') {
  return new Request('http://localhost/api/hunt-balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/hunt-balance', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-05-04T12:00:00Z') });
    createCheckoutSession.mockReset();
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined
    );
    createCheckoutSession.mockResolvedValue({
      id: 'cs_balance_test',
      url: 'https://checkout.stripe.test/pay-balance',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 400 when email is invalid', async () => {
    const kv = memoryKv();
    const res = await POST({
      request: jsonRequest({
        firstName: 'A',
        lastName: 'B',
        email: 'bad',
        huntYear: 2027,
        hunterCount: 1,
        mealPackage: false,
        paymentAmount: 2500,
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 404 when no reservation matches', async () => {
    const kv = memoryKv();
    const res = await POST({
      request: jsonRequest({
        firstName: 'A',
        lastName: 'B',
        email: 'nobody@example.com',
        huntYear: 2027,
        hunterCount: 1,
        mealPackage: false,
        paymentAmount: 2500,
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(404);
  });

  it('returns 200 with stripeUrl and passes balance metadata + success URL', async () => {
    const kv = memoryKv();
    let resv = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [
        {
          firstName: 'Ann',
          lastName: 'Hunter',
          email: 'ann@example.com',
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
    resv = { ...resv, status: 'deposit_paid', stripeDepositSessionId: 'cs_dep_prior' };
    await putReservation(kv, resv);

    const res = await POST({
      request: jsonRequest({
        firstName: 'Ann',
        lastName: 'Hunter',
        email: 'ann@example.com',
        huntYear: 2027,
        hunterCount: 1,
        mealPackage: false,
        paymentAmount: 2500,
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { stripeUrl: string };
    expect(json.stripeUrl).toBe('https://checkout.stripe.test/pay-balance');

    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const [items, opts] = createCheckoutSession.mock.calls[0] as [
      Array<{ id: string; name: string; price: number; quantity: number }>,
      {
        metadata: Record<string, string>;
        successUrl: string;
        cancelUrl: string;
      },
    ];
    expect(items[0]?.quantity).toBe(1);
    expect(items[0]?.price).toBe(2500);
    expect(opts.metadata.hunt_checkout_kind).toBe('balance');
    expect(opts.metadata.reservation_id).toBe(resv.id);
    expect(opts.successUrl).toContain('/hunt/final-payment/confirmed?session_id={CHECKOUT_SESSION_ID}');
    expect(opts.cancelUrl).toBe('http://localhost:4321/hunt/final-payment');
  });
});
