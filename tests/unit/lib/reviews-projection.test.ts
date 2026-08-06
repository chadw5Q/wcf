import { describe, it, expect } from 'vitest';
import type { StoredReview } from '../../../src/lib/reviews';
import { buildReviewsPublicProjection } from '../../../src/lib/reviews-projection';

function rev(partial: Partial<StoredReview> & Pick<StoredReview, 'id' | 'rating' | 'state'>): StoredReview {
  return {
    orderId: 'o1',
    createdAt: '2026-08-01T00:00:00.000Z',
    comment: null,
    displayName: 'Pat',
    location: null,
    productSkus: ['premiumLine'],
    photoKey: null,
    photoState: 'none',
    featured: false,
    ...partial,
  };
}

describe('reviews projection', () => {
  it('aggregates published only and rounds to one decimal', () => {
    const p = buildReviewsPublicProjection([
      rev({ id: 'a', rating: 5, state: 'published' }),
      rev({ id: 'b', rating: 4, state: 'published' }),
      rev({ id: 'c', rating: 1, state: 'new' }),
      rev({ id: 'd', rating: 2, state: 'hidden' }),
    ]);
    expect(p.aggregate).toEqual({
      ratingValue: 4.5,
      reviewCount: 2,
      updatedAt: expect.any(String),
    });
  });

  it('returns aggregate null for empty or all-hidden sets', () => {
    expect(buildReviewsPublicProjection([]).aggregate).toBeNull();
    expect(
      buildReviewsPublicProjection([rev({ id: 'a', rating: 5, state: 'hidden' })]).aggregate
    ).toBeNull();
  });

  it('counts a multi-SKU review once per SKU', () => {
    const p = buildReviewsPublicProjection([
      rev({
        id: 'a',
        rating: 5,
        state: 'published',
        productSkus: ['premiumLine', 'premiumCorner'],
      }),
    ]);
    expect(p.bySku.premiumLine?.reviewCount).toBe(1);
    expect(p.bySku.premiumCorner?.reviewCount).toBe(1);
  });

  it('caps featured at 3', () => {
    const list = [1, 2, 3, 4].map((n) =>
      rev({ id: `f${n}`, rating: 5, state: 'published', featured: true })
    );
    expect(buildReviewsPublicProjection(list).featured).toHaveLength(3);
  });

  it('hiding a published review decrements count and recomputes average', () => {
    const before = buildReviewsPublicProjection([
      rev({ id: 'a', rating: 5, state: 'published' }),
      rev({ id: 'b', rating: 3, state: 'published' }),
    ]);
    expect(before.aggregate).toEqual({
      ratingValue: 4,
      reviewCount: 2,
      updatedAt: expect.any(String),
    });
    const after = buildReviewsPublicProjection([
      rev({ id: 'a', rating: 5, state: 'published' }),
      rev({ id: 'b', rating: 3, state: 'hidden' }),
    ]);
    expect(after.aggregate).toEqual({
      ratingValue: 5,
      reviewCount: 1,
      updatedAt: expect.any(String),
    });
  });
});
