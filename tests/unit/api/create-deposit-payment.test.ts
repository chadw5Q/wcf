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
import { POST } from '../../../src/pages/api/create-deposit-payment';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/create-deposit-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/create-deposit-payment', () => {
  beforeEach(() => {
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
        quantities: { premiumLine: 4, premiumCorner: 0, premiumExtraLong: 0, regularLine: 0, regularCorner: 0, bowStave: 0 },
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
        quantities: { premiumLine: 1, premiumCorner: 0, premiumExtraLong: 0, regularLine: 0, regularCorner: 0, bowStave: 0 },
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
        quantities: { premiumLine: 4, premiumCorner: 0, premiumExtraLong: 0, regularLine: 0, regularCorner: 0, bowStave: 0 },
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('stripe');
    expect(createCheckoutSession).toHaveBeenCalled();
  });
});
