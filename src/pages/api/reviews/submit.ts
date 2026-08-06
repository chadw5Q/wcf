import type { APIRoute } from 'astro';
import { getOrder, saveOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { publishNtfyNotification } from '../../../lib/ntfy';
import {
  getReviewPhotosBucketFromLocals,
  isAllowedReviewPhotoMime,
  extFromReviewPhotoMime,
  makeReviewPhotoR2Key,
  MAX_REVIEW_PHOTO_BYTES,
} from '../../../lib/review-photo';
import { verifyReviewToken } from '../../../lib/review-token';
import {
  createStoredReview,
  findReviewByOrderId,
  saveReview,
} from '../../../lib/reviews';
import { getReviewsKvFromLocals } from '../../../lib/reviews-kv';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

function siteBase(): string {
  return (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ordersKv = getOrdersKvFromLocals(locals);
  const reviewsKv = getReviewsKvFromLocals(locals);
  if (!ordersKv || !reviewsKv) {
    return new Response(JSON.stringify({ error: 'Storage is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType = request.headers.get('content-type') || '';
  let token = '';
  let ratingRaw: unknown;
  let comment: string | null = null;
  let displayName: string | null = null;
  let firstNameOnly = false;
  let location: string | null = null;
  let photoBytes: ArrayBuffer | null = null;
  let photoMime: string | null = null;

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      token = String(form.get('token') ?? '');
      ratingRaw = form.get('rating');
      comment = form.get('comment') != null ? String(form.get('comment')) : null;
      displayName = form.get('displayName') != null ? String(form.get('displayName')) : null;
      firstNameOnly = form.get('firstNameOnly') === '1' || form.get('firstNameOnly') === 'true';
      location = form.get('location') != null ? String(form.get('location')) : null;
      const photo = form.get('photo');
      if (photo instanceof File && photo.size > 0) {
        photoMime = photo.type || 'image/jpeg';
        photoBytes = await photo.arrayBuffer();
      }
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      token = typeof body.token === 'string' ? body.token : '';
      ratingRaw = body.rating;
      comment = typeof body.comment === 'string' ? body.comment : null;
      displayName = typeof body.displayName === 'string' ? body.displayName : null;
      firstNameOnly = body.firstNameOnly === true;
      location = typeof body.location === 'string' ? body.location : null;
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = await verifyReviewToken(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Invalid or expired review link' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ratingNum = typeof ratingRaw === 'number' ? ratingRaw : Number(ratingRaw);
  if (!Number.isInteger(ratingNum)) {
    return new Response(JSON.stringify({ error: 'rating is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const order = await getOrder(ordersKv, payload.orderId);
  if (!order) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await findReviewByOrderId(reviewsKv, order.id);
  if (existing) {
    return new Response(JSON.stringify({ error: 'A review already exists for this order', reviewId: existing.id }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let photoKey: string | null = null;
  if (photoBytes) {
    if (photoBytes.byteLength > MAX_REVIEW_PHOTO_BYTES) {
      return new Response(JSON.stringify({ error: 'Photo must be under 8 MB' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!photoMime || !isAllowedReviewPhotoMime(photoMime)) {
      return new Response(JSON.stringify({ error: 'Photo must be JPEG or PNG' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const ext = extFromReviewPhotoMime(photoMime);
    if (!ext) {
      return new Response(JSON.stringify({ error: 'Photo must be JPEG or PNG' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Key needs review id — create review first without photo, then we need id.
    // Create review shell then attach photo.
  }

  const created = createStoredReview({
    order,
    rating: ratingNum,
    comment,
    displayName,
    firstNameOnly,
    location,
    photoKey: null,
  });
  if (!created.ok) {
    return new Response(JSON.stringify({ error: created.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let review = created.review;

  if (photoBytes && photoMime) {
    const bucket = getReviewPhotosBucketFromLocals(locals);
    if (!bucket) {
      return new Response(JSON.stringify({ error: 'Photo storage is not bound' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const ext = extFromReviewPhotoMime(photoMime)!;
    photoKey = makeReviewPhotoR2Key(review.id, ext);
    await bucket.put(photoKey, photoBytes, {
      httpMetadata: { contentType: ext === 'jpg' ? 'image/jpeg' : 'image/png' },
    });
    review = {
      ...review,
      photoKey,
      photoState: 'pending',
    };
  }

  await saveReview(reviewsKv, review);

  const nowIso = new Date().toISOString();
  const nextOrder = {
    ...order,
    updatedAt: nowIso,
    reviewRequest: {
      ...(order.reviewRequest ?? { queuedFor: nowIso }),
      respondedAt: nowIso,
    },
  };
  await saveOrder(ordersKv, nextOrder);

  const stars = `${review.rating} star${review.rating === 1 ? '' : 's'}`;
  const quote = review.comment ? `"${review.comment.slice(0, 160)}"` : '(no comment)';
  const photoLine =
    review.photoState === 'pending' ? '\nPhoto attached, pending review.' : '';
  await publishNtfyNotification({
    title: `New review: ${stars} from ${review.displayName}`,
    message: `${quote}${photoLine}`,
    click: `${siteBase()}/admin/reviews`,
    tags: 'star',
    workerEnv: locals.runtime?.env as Record<string, unknown> | undefined,
  });

  return new Response(JSON.stringify({ ok: true, reviewId: review.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
