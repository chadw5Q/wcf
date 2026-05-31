import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

const createCheckoutSession = vi.fn();

vi.mock('../../../src/lib/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  stripeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/hunt-reserve';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function jsonRequest(body: unknown, origin = 'http://localhost:4321') {
  return new Request('http://localhost/api/hunt-reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

const validHunter = {
  firstName: 'Ann',
  lastName: 'Hunter',
  email: 'ann@example.com',
  phone: '7125550100',
  state: 'IA',
};

describe('POST /api/hunt-reserve', () => {
  beforeEach(() => {
    createCheckoutSession.mockReset();
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined
    );
    createCheckoutSession.mockResolvedValue({
      id: 'cs_test_abc',
      url: 'https://checkout.stripe.test/pay',
    });
  });

  it('returns 400 when hunter email is invalid', async () => {
    const kv = memoryKv();
    const res = await POST({
      request: jsonRequest({
        hunters: [{ ...validHunter, email: 'not-an-email' }],
        huntYear: 2027,
        preferredWeek: 'w2',
        mealPackage: false,
        notes: null,
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 200 with reservationId and stripeUrl; checkout URLs match PRD', async () => {
    const kv = memoryKv();
    const res = await POST({
      request: jsonRequest({
        hunters: [validHunter],
        huntYear: 2027,
        preferredWeek: 'w2',
        mealPackage: true,
        notes: 'Corner bunk please',
      }),
      locals: { runtime: { env: { HUNT_KV: kv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { reservationId: string; stripeUrl: string };
    expect(json.stripeUrl).toBe('https://checkout.stripe.test/pay');
    expect(json.reservationId).toMatch(/^[0-9a-f-]{36}$/i);

    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const [, opts] = createCheckoutSession.mock.calls[0] as [
      unknown,
      {
        successUrl: string;
        cancelUrl: string;
        metadata: Record<string, string>;
      },
    ];
    expect(opts.successUrl).toContain('/hunt/reserve/confirmed?session_id={CHECKOUT_SESSION_ID}');
    expect(opts.cancelUrl).toBe('http://localhost:4321/hunt/reserve');
    expect(opts.metadata.hunt_checkout_kind).toBe('deposit');
    expect(opts.metadata.reservation_id).toBe(json.reservationId);
  });
});
