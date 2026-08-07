import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import type { StoredReview } from '../../../src/lib/reviews';
import { saveOrder } from '../../../src/lib/orders';
import { saveReview } from '../../../src/lib/reviews';
import { REVIEW_INDEX_KEY } from '../../../src/lib/reviews';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import {
  POST,
  processReviewRequestCron,
} from '../../../src/pages/api/cron/review-requests';

const CRON_SECRET = 'cron-test-secret';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function sampleOrder(partial: Partial<StoredOrder> & Pick<StoredOrder, 'id'>): StoredOrder {
  return {
    createdAt: '2026-08-10T00:00:00.000Z',
    customer: {
      name: 'Pat Buyer',
      firstName: 'Pat',
      lastName: 'Buyer',
      email: 'pat@example.com',
      phone: '555',
    },
    items: [
      {
        product: 'Premium Line',
        fieldName: 'premiumLine',
        quantity: 10,
        unitPrice: 10,
        lineTotal: 100,
      },
    ],
    subtotal: 100,
    volumeDiscount: { applied: false, rate: 0.1, amount: 0 },
    discountedSubtotal: 100,
    deposit: { selected: false, rate: 0.1, amount: 0 },
    orderTotal: 100,
    depositAmount: 0,
    balanceDue: 100,
    notes: null,
    deliverySlot: null,
    status: 'fulfilled',
    ...partial,
  };
}

describe('POST /api/cron/review-requests', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'CRON_SHARED_SECRET') return CRON_SECRET;
      if (key === 'SITE_URL') return 'https://williamscreekfarms.com';
      return undefined;
    });
  });

  afterEach(() => {
    vi.mocked(getServerEnv).mockReset();
  });

  it('returns 401 when X-Cron-Secret is missing', async () => {
    const res = await POST({
      request: new Request('http://localhost/api/cron/review-requests', { method: 'POST' }),
      locals: { runtime: { env: { ORDERS_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is wrong', async () => {
    const res = await POST({
      request: new Request('http://localhost/api/cron/review-requests', {
        method: 'POST',
        headers: { 'X-Cron-Secret': 'nope' },
      }),
      locals: { runtime: { env: { ORDERS_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('sends only for due orders with the correct secret', async () => {
    const ordersKv = memoryKv();
    await saveOrder(
      ordersKv,
      sampleOrder({
        id: 'due-1',
        reviewRequest: { queuedFor: '2026-08-20T00:00:00.000Z' },
      })
    );
    await saveOrder(
      ordersKv,
      sampleOrder({
        id: 'future-1',
        reviewRequest: { queuedFor: '2026-09-20T00:00:00.000Z' },
      })
    );

    const sendEmail = vi.fn(async () => true);
    const notify = vi.fn(async () => undefined);

    const result = await processReviewRequestCron({
      ordersKv,
      now: new Date('2026-08-25T00:00:00.000Z'),
      sendEmail,
      notify,
    });

    expect(result.asksSent).toBe(1);
    expect(result.nudgesSent).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].order.id).toBe('due-1');
    expect(notify).toHaveBeenCalledTimes(1);

    const res = await POST({
      request: new Request('http://localhost/api/cron/review-requests', {
        method: 'POST',
        headers: { 'X-Cron-Secret': CRON_SECRET },
      }),
      locals: { runtime: { env: { ORDERS_KV: memoryKv() } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
  });

  it('clears sentAt when Resend fails so the next run retries', async () => {
    const ordersKv = memoryKv();
    await saveOrder(
      ordersKv,
      sampleOrder({
        id: 'fail-1',
        reviewRequest: { queuedFor: '2026-08-20T00:00:00.000Z' },
      })
    );

    const sendEmail = vi.fn(async () => false);
    const result = await processReviewRequestCron({
      ordersKv,
      now: new Date('2026-08-25T00:00:00.000Z'),
      sendEmail,
      notify: vi.fn(async () => undefined),
    });

    expect(result.failed).toBe(1);
    expect(result.asksSent).toBe(0);
    const raw = await ordersKv.get('fail-1');
    const stored = JSON.parse(raw!) as StoredOrder;
    expect(stored.reviewRequest?.sentAt).toBeUndefined();
  });

  it('caps at 25 sends per invocation', async () => {
    const ordersKv = memoryKv();
    for (let i = 0; i < 30; i++) {
      await saveOrder(
        ordersKv,
        sampleOrder({
          id: `cap-${i}`,
          reviewRequest: { queuedFor: '2026-08-20T00:00:00.000Z' },
        })
      );
    }
    const sendEmail = vi.fn(async () => true);
    const result = await processReviewRequestCron({
      ordersKv,
      now: new Date('2026-08-25T00:00:00.000Z'),
      sendEmail,
      notify: vi.fn(async () => undefined),
    });
    expect(result.asksSent).toBe(25);
    expect(result.remainingEligible).toBe(5);
    expect(sendEmail).toHaveBeenCalledTimes(25);
  });

  it('sends pending-approval digest only when something has been new over 24 hours', async () => {
    const ordersKv = memoryKv();
    const reviewsKv = memoryKv();
    const stale: StoredReview = {
      id: 'rev_stale',
      orderId: 'o1',
      createdAt: '2026-08-20T00:00:00.000Z',
      rating: 5,
      comment: null,
      displayName: 'A',
      location: null,
      productSkus: ['premiumLine'],
      photoKey: null,
      photoState: 'none',
      state: 'new',
      featured: false,
    };
    await saveReview(reviewsKv, stale);
    // sanity: index written
    expect(await reviewsKv.get(REVIEW_INDEX_KEY)).toBeTruthy();

    const sendDigest = vi.fn(async () => true);
    const withStale = await processReviewRequestCron({
      ordersKv,
      reviewsKv,
      now: new Date('2026-08-21T01:00:00.000Z'),
      sendEmail: vi.fn(async () => true),
      sendDigest,
      notify: vi.fn(async () => undefined),
    });
    expect(withStale.pendingStale).toBe(1);
    expect(withStale.digestSent).toBe(true);
    expect(sendDigest).toHaveBeenCalledTimes(1);

    const freshOnly = memoryKv();
    await saveReview(freshOnly, {
      ...stale,
      id: 'rev_fresh',
      createdAt: '2026-08-21T00:30:00.000Z',
    });
    sendDigest.mockClear();
    const freshResult = await processReviewRequestCron({
      ordersKv,
      reviewsKv: freshOnly,
      now: new Date('2026-08-21T01:00:00.000Z'),
      sendEmail: vi.fn(async () => true),
      sendDigest,
      notify: vi.fn(async () => undefined),
    });
    expect(freshResult.pendingStale).toBe(0);
    expect(freshResult.digestSent).toBe(false);
    expect(sendDigest).not.toHaveBeenCalled();
  });

  it('posts one ntfy summary per run', async () => {
    const notify = vi.fn(async () => undefined);
    await processReviewRequestCron({
      ordersKv: memoryKv(),
      now: new Date('2026-08-25T00:00:00.000Z'),
      sendEmail: vi.fn(async () => true),
      notify,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe('Review cron');
  });
});
