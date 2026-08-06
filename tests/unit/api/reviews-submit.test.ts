import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import { createReviewToken } from '../../../src/lib/review-token';
import { findReviewByOrderId, getReview } from '../../../src/lib/reviews';
import { getOrder, saveOrder } from '../../../src/lib/orders';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

vi.mock('../../../src/lib/ntfy', () => ({
  publishNtfyNotification: vi.fn(() => Promise.resolve()),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { publishNtfyNotification } from '../../../src/lib/ntfy';
import { POST } from '../../../src/pages/api/reviews/submit';

const SECRET = 'test-review-secret';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function sampleOrder(id = 'ord-review-1'): StoredOrder {
  return {
    id,
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
  };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/reviews/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reviews/submit', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'REVIEW_TOKEN_SECRET') return SECRET;
      if (key === 'SITE_URL') return 'https://williamscreekfarms.com';
      return undefined;
    });
    vi.mocked(publishNtfyNotification).mockClear();
  });

  afterEach(() => {
    vi.mocked(getServerEnv).mockReset();
  });

  it('stores a review for a valid token and rating', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET);

    const res = await POST({
      request: jsonRequest({ token, rating: 5, comment: 'Worth the drive.' }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reviewId: string };
    expect(json.ok).toBe(true);
    const stored = await getReview(reviewsKv, json.reviewId);
    expect(stored?.rating).toBe(5);
    expect(stored?.comment).toBe('Worth the drive.');
    expect(publishNtfyNotification).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for a tampered token and stores nothing', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET);

    const res = await POST({
      request: jsonRequest({ token: token + 'x', rating: 5 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(403);
    expect(await findReviewByOrderId(reviewsKv, 'ord-review-1')).toBeNull();
    expect(publishNtfyNotification).not.toHaveBeenCalled();
  });

  it('returns 403 for an expired token', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET, new Date('2020-01-01T00:00:00Z'));

    const res = await POST({
      request: jsonRequest({ token, rating: 4 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(403);
  });

  it('returns 409 on a second submission for the same order', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET);

    const first = await POST({
      request: jsonRequest({ token, rating: 5 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);
    expect(first.status).toBe(200);

    const second = await POST({
      request: jsonRequest({ token, rating: 4 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);
    expect(second.status).toBe(409);
    expect(publishNtfyNotification).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for rating out of range or missing', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET);

    const bad = await POST({
      request: jsonRequest({ token, rating: 6 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);
    expect(bad.status).toBe(400);

    const missing = await POST({
      request: jsonRequest({ token }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);
    expect(missing.status).toBe(400);
  });

  it('sets respondedAt on the order', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    await saveOrder(ordersKv, sampleOrder());
    const token = await createReviewToken('ord-review-1', SECRET);

    await POST({
      request: jsonRequest({ token, rating: 5 }),
      locals: { runtime: { env: { ORDERS_KV: ordersKv, REVIEWS_KV: reviewsKv } } },
    } as Parameters<typeof POST>[0]);

    const order = await getOrder(ordersKv, 'ord-review-1');
    expect(order?.reviewRequest?.respondedAt).toBeTruthy();
  });
});
