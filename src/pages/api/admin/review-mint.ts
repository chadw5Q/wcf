import type { APIRoute } from 'astro';
import { getOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { createReviewToken, reviewAbsoluteUrl } from '../../../lib/review-token';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

/** Admin helper for Phase 1: mint a review link without sending email. */
export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'ORDERS_KV is not bound' }), {
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

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'orderId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const order = await getOrder(kv, orderId);
  if (!order) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await createReviewToken(orderId);
    const base = (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
    const origin = new URL(request.url).origin;
    const site = import.meta.env.DEV ? origin : base;
    return new Response(
      JSON.stringify({
        ok: true,
        token,
        url: reviewAbsoluteUrl(site, token),
        starUrls: [1, 2, 3, 4, 5].map((r) => reviewAbsoluteUrl(site, token, r)),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : 'Could not mint token',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
