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
import { POST } from '../../../src/pages/api/create-checkout-session';

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/create-checkout-session', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined
    );
    createCheckoutSession.mockResolvedValue({
      id: 'cs_cart_1',
      url: 'https://checkout.stripe.test/c/cart',
    });
  });

  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest({
        items: [{ id: '1', name: 'Test', price: 10, quantity: 1 }],
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('returns 400 when items missing', async () => {
    const res = await POST({
      request: jsonRequest({ items: [] }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 200 with session URL when items valid', async () => {
    const res = await POST({
      request: jsonRequest({
        items: [{ id: 'boxwood-hedge', name: 'Boxwood', price: 29.99, quantity: 2 }],
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBeDefined();
    expect(createCheckoutSession).toHaveBeenCalled();
  });
});
