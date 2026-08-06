import { describe, it, expect, beforeEach } from 'vitest';
import type { StoredReview } from '../../../src/lib/reviews';
import {
  editReviewText,
  getReview,
  hideReview,
  MAX_FEATURED_REVIEWS,
  publishReview,
  saveReview,
  setFeatured,
} from '../../../src/lib/reviews';
import { REVIEWS_PUBLIC_KEY } from '../../../src/lib/reviews';
import { getReviewsPublicProjection } from '../../../src/lib/reviews-projection';
import { POST } from '../../../src/pages/api/admin/review-moderate';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function sampleReview(partial?: Partial<StoredReview>): StoredReview {
  return {
    id: 'rev_test-1',
    orderId: 'ord-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    rating: 5,
    comment: 'Great posts',
    displayName: 'David P.',
    location: 'Sheridan, MO',
    productSkus: ['premiumLine'],
    photoKey: null,
    photoState: 'none',
    state: 'new',
    featured: false,
    revisionLog: [],
    ...partial,
  };
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/admin/review-moderate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/review-moderate', () => {
  let kv: KVNamespace;

  beforeEach(async () => {
    kv = memoryKv();
    await saveReview(kv, sampleReview());
  });

  it('publishes and rewrites reviews:public', async () => {
    const res = await POST({
      request: jsonRequest({ reviewId: 'rev_test-1', action: 'publish' }),
      locals: { runtime: { env: { REVIEWS_KV: kv } } },
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const review = await getReview(kv, 'rev_test-1');
    expect(review?.state).toBe('published');
    const projection = await getReviewsPublicProjection(kv);
    expect(projection?.aggregate?.reviewCount).toBe(1);
    expect(await kv.get(REVIEWS_PUBLIC_KEY)).toBeTruthy();
  });

  it('rejects hide without a reason', async () => {
    const res = await POST({
      request: jsonRequest({ reviewId: 'rev_test-1', action: 'hide' }),
      locals: { runtime: { env: { REVIEWS_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('hides with a reason and writes revisionLog', async () => {
    await saveReview(kv, publishReview(sampleReview()));
    const res = await POST({
      request: jsonRequest({ reviewId: 'rev_test-1', action: 'hide', reason: 'spam' }),
      locals: { runtime: { env: { REVIEWS_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const review = await getReview(kv, 'rev_test-1');
    expect(review?.state).toBe('hidden');
    expect(review?.hiddenReason).toBe('spam');
    expect(review?.revisionLog?.some((e) => e.summary.includes('Hidden'))).toBe(true);
  });

  it('edits text without changing rating', async () => {
    const res = await POST({
      request: jsonRequest({
        reviewId: 'rev_test-1',
        action: 'edit',
        comment: 'Typo fixed',
        displayName: 'Dave P.',
      }),
      locals: { runtime: { env: { REVIEWS_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const review = await getReview(kv, 'rev_test-1');
    expect(review?.comment).toBe('Typo fixed');
    expect(review?.rating).toBe(5);
    expect(review?.revisionLog?.some((e) => e.summary.includes('Edited'))).toBe(true);
  });

  it('rejects featuring a fourth review', async () => {
    for (let i = 0; i < MAX_FEATURED_REVIEWS; i++) {
      const r = publishReview(
        sampleReview({
          id: `rev_feat-${i}`,
          featured: true,
          state: 'published',
        })
      );
      await saveReview(kv, setFeatured(r, true));
    }
    await saveReview(kv, publishReview(sampleReview({ id: 'rev_extra', state: 'published' })));

    const res = await POST({
      request: jsonRequest({ reviewId: 'rev_extra', action: 'feature' }),
      locals: { runtime: { env: { REVIEWS_KV: kv } } },
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });
});

describe('review moderation helpers', () => {
  it('hideReview requires a reason', () => {
    const result = hideReview(sampleReview(), '' as 'spam');
    expect('error' in result).toBe(true);
  });

  it('editReviewText cannot alter rating via the helper API', () => {
    const edited = editReviewText(sampleReview(), { comment: 'x' });
    expect('error' in edited).toBe(false);
    if ('error' in edited) return;
    expect(edited.rating).toBe(5);
  });
});
