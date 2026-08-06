import type { OrderFieldName } from './order-types';
import {
  MAX_FEATURED_REVIEWS,
  REVIEWS_PUBLIC_KEY,
  type StoredReview,
} from './reviews';

export type ReviewsAggregate = {
  ratingValue: number;
  reviewCount: number;
  updatedAt: string;
};

export type ReviewsPublicProjection = {
  aggregate: ReviewsAggregate | null;
  featured: StoredReview[];
  recent: StoredReview[];
  bySku: Partial<Record<OrderFieldName, ReviewsAggregate>>;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function aggregateFrom(list: StoredReview[], now: Date): ReviewsAggregate | null {
  if (list.length === 0) return null;
  const sum = list.reduce((s, r) => s + r.rating, 0);
  return {
    ratingValue: round1(sum / list.length),
    reviewCount: list.length,
    updatedAt: now.toISOString(),
  };
}

/** Public-facing photo: only approved photos are exposed. */
export function sanitizeReviewForPublic(r: StoredReview): StoredReview {
  if (r.photoState === 'approved' && r.photoKey) return r;
  return { ...r, photoKey: null, photoState: r.photoKey ? 'rejected' : 'none' };
}

export function buildReviewsPublicProjection(
  reviews: StoredReview[],
  now: Date = new Date()
): ReviewsPublicProjection {
  const published = reviews.filter((r) => r.state === 'published');
  const aggregate = aggregateFrom(published, now);

  const featured = published
    .filter((r) => r.featured)
    .slice(0, MAX_FEATURED_REVIEWS)
    .map(sanitizeReviewForPublic);

  const recent = [...published]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map(sanitizeReviewForPublic);

  const bySku: ReviewsPublicProjection['bySku'] = {};
  const skuBuckets = new Map<OrderFieldName, StoredReview[]>();
  for (const r of published) {
    for (const sku of r.productSkus) {
      const list = skuBuckets.get(sku) ?? [];
      list.push(r);
      skuBuckets.set(sku, list);
    }
  }
  for (const [sku, list] of skuBuckets) {
    const agg = aggregateFrom(list, now);
    if (agg) bySku[sku] = agg;
  }

  return { aggregate, featured, recent, bySku };
}

export async function putReviewsPublicProjection(
  kv: KVNamespace,
  projection: ReviewsPublicProjection
): Promise<void> {
  await kv.put(REVIEWS_PUBLIC_KEY, JSON.stringify(projection));
}

export async function getReviewsPublicProjection(
  kv: KVNamespace
): Promise<ReviewsPublicProjection | null> {
  const raw = await kv.get(REVIEWS_PUBLIC_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReviewsPublicProjection;
  } catch {
    return null;
  }
}

export async function recomputeAndStoreReviewsPublic(
  kv: KVNamespace,
  allReviews: StoredReview[],
  now: Date = new Date()
): Promise<ReviewsPublicProjection> {
  const projection = buildReviewsPublicProjection(allReviews, now);
  await putReviewsPublicProjection(kv, projection);
  return projection;
}
