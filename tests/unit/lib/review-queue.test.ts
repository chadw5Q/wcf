import { describe, it, expect } from 'vitest';
import type { StoredOrder } from '../../../src/lib/order-types';
import {
  REVIEW_FEATURE_START,
  REVIEW_SEND_BATCH_CAP,
  attachReviewRequestOnFulfilled,
  isEligibleForReviewAsk,
  isEligibleForReviewNudge,
  reviewQueuedForFromFulfilledAt,
  selectReviewSendJobs,
} from '../../../src/lib/review-queue';

function order(partial: Partial<StoredOrder> & Pick<StoredOrder, 'id'>): StoredOrder {
  return {
    createdAt: '2026-08-10T12:00:00.000Z',
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

describe('attachReviewRequestOnFulfilled', () => {
  it('never queues an order fulfilled before REVIEW_FEATURE_START', () => {
    const o = order({ id: 'old', status: 'fulfilled' });
    const before = new Date('2026-08-05T23:59:59.000Z');
    expect(before.getTime()).toBeLessThan(new Date(REVIEW_FEATURE_START).getTime());
    expect(attachReviewRequestOnFulfilled(o, before)).toBe(false);
    expect(o.reviewRequest).toBeUndefined();
  });

  it('queues queuedFor = fulfilled + 14 days after feature start', () => {
    const fulfilledAt = new Date('2026-08-10T15:00:00.000Z');
    const o = order({ id: 'new', status: 'fulfilled' });
    expect(attachReviewRequestOnFulfilled(o, fulfilledAt)).toBe(true);
    expect(o.reviewRequest?.queuedFor).toBe(reviewQueuedForFromFulfilledAt(fulfilledAt));
    expect(o.reviewRequest?.queuedFor).toBe('2026-08-24T15:00:00.000Z');
  });

  it('does not re-queue when reviewRequest already exists', () => {
    const o = order({
      id: 'once',
      status: 'fulfilled',
      reviewRequest: { queuedFor: '2026-09-01T00:00:00.000Z' },
    });
    expect(attachReviewRequestOnFulfilled(o, new Date('2026-08-20T00:00:00.000Z'))).toBe(false);
    expect(o.reviewRequest?.queuedFor).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('selectReviewSendJobs', () => {
  it('returns nothing at day 13 and the order at day 14', () => {
    const fulfilled = new Date('2026-08-10T12:00:00.000Z');
    const o = order({ id: 'due', status: 'fulfilled' });
    attachReviewRequestOnFulfilled(o, fulfilled);

    const day13 = new Date('2026-08-23T11:59:59.000Z');
    expect(selectReviewSendJobs([o], day13).jobs).toEqual([]);

    const day14 = new Date('2026-08-24T12:00:00.000Z');
    expect(selectReviewSendJobs([o], day14).jobs).toEqual([{ orderId: 'due', kind: 'ask' }]);
  });

  it('excludes orders with sentAt, respondedAt, or suppressedAt', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const base = {
      queuedFor: '2026-08-20T00:00:00.000Z',
    };
    const orders = [
      // sent recently — ask excluded; nudge not due yet
      order({
        id: 'sent',
        reviewRequest: { ...base, sentAt: '2026-08-30T00:00:00.000Z' },
      }),
      order({ id: 'resp', reviewRequest: { ...base, respondedAt: '2026-08-21T00:00:00.000Z' } }),
      order({
        id: 'supp',
        reviewRequest: { ...base, suppressedAt: '2026-08-21T00:00:00.000Z', suppressedReason: 'admin' },
      }),
      order({ id: 'ok', reviewRequest: { ...base } }),
    ];
    expect(selectReviewSendJobs(orders, now).jobs).toEqual([{ orderId: 'ok', kind: 'ask' }]);
  });

  it('nudges only at sentAt + 7 days when no respondedAt and no nudgedAt', () => {
    const o = order({
      id: 'nudge',
      reviewRequest: {
        queuedFor: '2026-08-01T00:00:00.000Z',
        sentAt: '2026-08-10T00:00:00.000Z',
      },
    });
    expect(isEligibleForReviewAsk(o, new Date('2026-08-20T00:00:00.000Z'))).toBe(false);
    expect(isEligibleForReviewNudge(o, new Date('2026-08-16T23:59:59.000Z'))).toBe(false);
    expect(isEligibleForReviewNudge(o, new Date('2026-08-17T00:00:00.000Z'))).toBe(true);
    expect(selectReviewSendJobs([o], new Date('2026-08-17T00:00:00.000Z')).jobs).toEqual([
      { orderId: 'nudge', kind: 'nudge' },
    ]);
  });

  it('never contacts a third time when sentAt and nudgedAt are both set', () => {
    const o = order({
      id: 'done',
      reviewRequest: {
        queuedFor: '2026-08-01T00:00:00.000Z',
        sentAt: '2026-08-10T00:00:00.000Z',
        nudgedAt: '2026-08-17T00:00:00.000Z',
      },
    });
    const now = new Date('2026-12-01T00:00:00.000Z');
    expect(selectReviewSendJobs([o], now).jobs).toEqual([]);
  });

  it('respects the batch cap of 25 and reports remaining', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const orders = Array.from({ length: 30 }, (_, i) =>
      order({
        id: `ask-${i}`,
        reviewRequest: { queuedFor: '2026-08-20T00:00:00.000Z' },
      })
    );
    const result = selectReviewSendJobs(orders, now);
    expect(result.jobs).toHaveLength(REVIEW_SEND_BATCH_CAP);
    expect(result.remainingEligible).toBe(5);
    expect(result.totalEligible).toBe(30);
  });

  it('mixed fixture of 60 orders across states yields exactly 25', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    const orders: StoredOrder[] = [];

    // 20 due asks
    for (let i = 0; i < 20; i++) {
      orders.push(
        order({
          id: `ask-${i}`,
          reviewRequest: { queuedFor: '2026-08-15T00:00:00.000Z' },
        })
      );
    }
    // 15 due nudges
    for (let i = 0; i < 15; i++) {
      orders.push(
        order({
          id: `nudge-${i}`,
          reviewRequest: {
            queuedFor: '2026-08-01T00:00:00.000Z',
            sentAt: '2026-08-10T00:00:00.000Z',
          },
        })
      );
    }
    // 10 already nudged (excluded)
    for (let i = 0; i < 10; i++) {
      orders.push(
        order({
          id: `done-${i}`,
          reviewRequest: {
            queuedFor: '2026-08-01T00:00:00.000Z',
            sentAt: '2026-08-10T00:00:00.000Z',
            nudgedAt: '2026-08-17T00:00:00.000Z',
          },
        })
      );
    }
    // 5 responded
    for (let i = 0; i < 5; i++) {
      orders.push(
        order({
          id: `resp-${i}`,
          reviewRequest: {
            queuedFor: '2026-08-15T00:00:00.000Z',
            respondedAt: '2026-08-20T00:00:00.000Z',
          },
        })
      );
    }
    // 5 before feature / no queue
    for (let i = 0; i < 5; i++) {
      orders.push(order({ id: `hist-${i}`, reviewRequest: undefined }));
    }
    // 5 not yet due
    for (let i = 0; i < 5; i++) {
      orders.push(
        order({
          id: `future-${i}`,
          reviewRequest: { queuedFor: '2026-09-15T00:00:00.000Z' },
        })
      );
    }

    expect(orders).toHaveLength(60);
    const result = selectReviewSendJobs(orders, now);
    expect(result.totalEligible).toBe(35); // 20 asks + 15 nudges
    expect(result.jobs).toHaveLength(25);
    expect(result.remainingEligible).toBe(10);
    expect(result.jobs.filter((j) => j.kind === 'ask')).toHaveLength(20);
    expect(result.jobs.filter((j) => j.kind === 'nudge')).toHaveLength(5);
  });
});
