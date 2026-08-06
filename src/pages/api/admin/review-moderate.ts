import type { APIRoute } from 'astro';
import {
  approvePhoto,
  countFeatured,
  editReviewText,
  getAllReviews,
  getReview,
  hideReview,
  MAX_FEATURED_REVIEWS,
  publishReview,
  rejectPhoto,
  saveReview,
  setFeatured,
  type ReviewHiddenReason,
} from '../../../lib/reviews';
import { getReviewsKvFromLocals } from '../../../lib/reviews-kv';
import { recomputeAndStoreReviewsPublic } from '../../../lib/reviews-projection';

export const prerender = false;

const HIDDEN_REASONS: ReviewHiddenReason[] = [
  'spam',
  'personal_info',
  'abusive',
  'not_a_customer',
];

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getReviewsKvFromLocals(locals);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'REVIEWS_KV is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reviewId = typeof body.reviewId === 'string' ? body.reviewId.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!reviewId || !action) {
    return new Response(JSON.stringify({ error: 'reviewId and action are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const review = await getReview(kv, reviewId);
  if (!review) {
    return new Response(JSON.stringify({ error: 'Review not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let next = review;
  if (action === 'publish') {
    next = publishReview(review);
  } else if (action === 'hide') {
    const reason = body.reason as ReviewHiddenReason;
    if (!HIDDEN_REASONS.includes(reason)) {
      return new Response(JSON.stringify({ error: 'A valid hiddenReason is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const hidden = hideReview(review, reason);
    if ('error' in hidden) {
      return new Response(JSON.stringify({ error: hidden.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    next = hidden;
  } else if (action === 'feature' || action === 'unfeature') {
    if (action === 'feature') {
      if (review.state !== 'published') {
        return new Response(JSON.stringify({ error: 'Only published reviews can be featured' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!review.featured) {
        const all = await getAllReviews(kv);
        if (countFeatured(all) >= MAX_FEATURED_REVIEWS) {
          return new Response(
            JSON.stringify({ error: `At most ${MAX_FEATURED_REVIEWS} featured reviews` }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    next = setFeatured(review, action === 'feature');
  } else if (action === 'approve_photo') {
    next = approvePhoto(review);
  } else if (action === 'reject_photo') {
    next = rejectPhoto(review);
  } else if (action === 'edit') {
    const edited = editReviewText(review, {
      comment: typeof body.comment === 'string' || body.comment === null ? (body.comment as string | null) : undefined,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      location:
        typeof body.location === 'string' || body.location === null
          ? (body.location as string | null)
          : undefined,
    });
    if ('error' in edited) {
      return new Response(JSON.stringify({ error: edited.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    next = edited;
  } else {
    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await saveReview(kv, next);
  const all = await getAllReviews(kv);
  await recomputeAndStoreReviewsPublic(kv, all);

  return new Response(JSON.stringify({ ok: true, review: next }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
