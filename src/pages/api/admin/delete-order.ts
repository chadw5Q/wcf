import type { APIRoute } from 'astro';
import { deleteOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({
        error: 'Order storage is not configured',
        details: 'ORDERS_KV binding is missing.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = String(body.id ?? '').trim();
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing order id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const removed = await deleteOrder(kv, id);
  if (!removed) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
