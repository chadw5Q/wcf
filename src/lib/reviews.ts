import type { OrderFieldName, OrderRevisionEntry, StoredOrder } from './order-types';

export const MAX_REVIEW_COMMENT_LEN = 2000;
export const MAX_FEATURED_REVIEWS = 3;
export const REVIEW_INDEX_KEY = 'review_index';
export const REVIEWS_PUBLIC_KEY = 'reviews:public';
const MAX_INDEX_IDS = 5000;
const MAX_REVISION_LOG = 100;

export type ReviewState = 'new' | 'published' | 'hidden';
export type ReviewPhotoState = 'none' | 'pending' | 'approved' | 'rejected';
export type ReviewHiddenReason = 'spam' | 'personal_info' | 'abusive' | 'not_a_customer';
export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export interface StoredReview {
  id: string;
  orderId: string;
  createdAt: string;
  rating: ReviewRating;
  comment: string | null;
  displayName: string;
  location: string | null;
  productSkus: OrderFieldName[];
  photoKey: string | null;
  photoState: ReviewPhotoState;
  state: ReviewState;
  featured: boolean;
  hiddenReason?: ReviewHiddenReason;
  adminNote?: string | null;
  revisionLog?: OrderRevisionEntry[];
}

export type CreateStoredReviewInput = {
  order: StoredOrder;
  rating: number;
  comment?: string | null;
  displayName?: string | null;
  firstNameOnly?: boolean;
  location?: string | null;
  photoKey?: string | null;
  now?: Date;
};

export type CreateStoredReviewResult =
  | { ok: true; review: StoredReview }
  | { ok: false; error: string };

export function isReviewRating(n: unknown): n is ReviewRating {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5;
}

export function productSkusFromOrder(order: StoredOrder): OrderFieldName[] {
  const out: OrderFieldName[] = [];
  const seen = new Set<OrderFieldName>();
  for (const item of order.items) {
    if (!item.quantity || item.quantity <= 0) continue;
    if (seen.has(item.fieldName)) continue;
    seen.add(item.fieldName);
    out.push(item.fieldName);
  }
  return out;
}

export function defaultDisplayName(order: StoredOrder, firstNameOnly = false): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'Customer';
  if (firstNameOnly) return first;
  const last = order.customer.lastName?.trim();
  if (last) return `${first} ${last.charAt(0).toUpperCase()}.`;
  const parts = order.customer.name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
  return first;
}

export function createStoredReview(input: CreateStoredReviewInput): CreateStoredReviewResult {
  if (!isReviewRating(input.rating)) {
    return { ok: false, error: 'rating must be an integer from 1 to 5' };
  }
  let comment: string | null = null;
  if (input.comment != null && String(input.comment).trim()) {
    const c = String(input.comment).trim();
    if (c.length > MAX_REVIEW_COMMENT_LEN) {
      return { ok: false, error: `comment must be at most ${MAX_REVIEW_COMMENT_LEN} characters` };
    }
    comment = c;
  }

  const firstNameOnly = input.firstNameOnly === true;
  const displayName =
    input.displayName?.trim() || defaultDisplayName(input.order, firstNameOnly);
  if (!displayName) return { ok: false, error: 'displayName is required' };

  const location =
    input.location != null && String(input.location).trim()
      ? String(input.location).trim().slice(0, 120)
      : null;

  const hasPhoto = Boolean(input.photoKey?.trim());
  const now = input.now ?? new Date();

  return {
    ok: true,
    review: {
      id: `rev_${crypto.randomUUID()}`,
      orderId: input.order.id,
      createdAt: now.toISOString(),
      rating: input.rating,
      comment,
      displayName,
      location,
      productSkus: productSkusFromOrder(input.order),
      photoKey: hasPhoto ? input.photoKey!.trim() : null,
      photoState: hasPhoto ? 'pending' : 'none',
      state: 'new',
      featured: false,
      adminNote: null,
      revisionLog: [],
    },
  };
}

function pushRevision(review: StoredReview, entry: OrderRevisionEntry): StoredReview {
  const log = [...(review.revisionLog ?? []), entry].slice(-MAX_REVISION_LOG);
  return { ...review, revisionLog: log };
}

export async function saveReview(kv: KVNamespace, review: StoredReview): Promise<void> {
  await kv.put(review.id, JSON.stringify(review));
  const raw = await kv.get(REVIEW_INDEX_KEY);
  let ids: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      ids = [];
    }
  }
  ids = [review.id, ...ids.filter((id) => id !== review.id)].slice(0, MAX_INDEX_IDS);
  await kv.put(REVIEW_INDEX_KEY, JSON.stringify(ids));
}

export async function getReview(kv: KVNamespace, id: string): Promise<StoredReview | null> {
  const raw = await kv.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredReview;
  } catch {
    return null;
  }
}

export async function getAllReviews(kv: KVNamespace): Promise<StoredReview[]> {
  const raw = await kv.get(REVIEW_INDEX_KEY);
  if (!raw) return [];
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
  const out: StoredReview[] = [];
  for (const id of ids) {
    const r = await getReview(kv, id);
    if (r) out.push(r);
  }
  return out;
}

export async function findReviewByOrderId(
  kv: KVNamespace,
  orderId: string
): Promise<StoredReview | null> {
  const all = await getAllReviews(kv);
  return all.find((r) => r.orderId === orderId) ?? null;
}

export function publishReview(review: StoredReview, now: Date = new Date()): StoredReview {
  return pushRevision(
    { ...review, state: 'published', hiddenReason: undefined },
    { at: now.toISOString(), action: 'meta', summary: 'Published review' }
  );
}

export function hideReview(
  review: StoredReview,
  reason: ReviewHiddenReason,
  now: Date = new Date()
): StoredReview | { error: string } {
  if (!reason) return { error: 'hiddenReason is required' };
  return pushRevision(
    { ...review, state: 'hidden', featured: false, hiddenReason: reason },
    { at: now.toISOString(), action: 'meta', summary: `Hidden review (${reason})` }
  );
}

export function setFeatured(
  review: StoredReview,
  featured: boolean,
  now: Date = new Date()
): StoredReview {
  return pushRevision(
    { ...review, featured: featured && review.state === 'published' },
    {
      at: now.toISOString(),
      action: 'meta',
      summary: featured ? 'Featured on homepage' : 'Unfeatured',
    }
  );
}

export function approvePhoto(review: StoredReview, now: Date = new Date()): StoredReview {
  if (review.photoState !== 'pending' || !review.photoKey) return review;
  return pushRevision(
    { ...review, photoState: 'approved' },
    { at: now.toISOString(), action: 'meta', summary: 'Approved review photo' }
  );
}

export function rejectPhoto(review: StoredReview, now: Date = new Date()): StoredReview {
  if (review.photoState !== 'pending') return review;
  return pushRevision(
    { ...review, photoState: 'rejected', photoKey: null },
    { at: now.toISOString(), action: 'meta', summary: 'Rejected review photo' }
  );
}

/** Typo/format edit only — rating cannot change. */
export function editReviewText(
  review: StoredReview,
  patch: { comment?: string | null; displayName?: string; location?: string | null },
  now: Date = new Date()
): StoredReview | { error: string } {
  let comment = review.comment;
  if ('comment' in patch) {
    if (patch.comment == null || !String(patch.comment).trim()) {
      comment = null;
    } else {
      const c = String(patch.comment).trim();
      if (c.length > MAX_REVIEW_COMMENT_LEN) {
        return { error: `comment must be at most ${MAX_REVIEW_COMMENT_LEN} characters` };
      }
      comment = c;
    }
  }
  const displayName =
    patch.displayName != null ? patch.displayName.trim() || review.displayName : review.displayName;
  const location =
    'location' in patch
      ? patch.location != null && String(patch.location).trim()
        ? String(patch.location).trim().slice(0, 120)
        : null
      : review.location;

  return pushRevision(
    { ...review, comment, displayName, location },
    { at: now.toISOString(), action: 'meta', summary: 'Edited review text' }
  );
}

export function countFeatured(reviews: StoredReview[]): number {
  return reviews.filter((r) => r.state === 'published' && r.featured).length;
}
