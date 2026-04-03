import type { APIRoute } from 'astro';
import { applyCalBookingToOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { getServerEnv } from '../../../lib/server-env';
import {
  extractOrderIdFromCalPayload,
  formatCalPickupSlot,
  normalizeCalPayload,
  parseCalWebhookBody,
  verifyCalWebhookSignature,
} from '../../../lib/cal-webhook';

export const prerender = false;

const SLOT_TRIGGERS = new Set([
  'BOOKING_CREATED',
  'BOOKING_RESCHEDULED',
  'BOOKING_REQUESTED',
  'INSTANT_MEETING_CREATED',
]);

const CLEAR_TRIGGERS = new Set(['BOOKING_CANCELLED', 'BOOKING_REJECTED']);

export const POST: APIRoute = async ({ request, locals }) => {
  const secret = getServerEnv('CAL_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    return new Response(
      JSON.stringify({
        error: 'Webhook not configured',
        details: 'Set CAL_WEBHOOK_SECRET to match the secret in Cal.com for this webhook.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get('x-cal-signature-256');
  if (!(await verifyCalWebhookSignature(rawBody, sigHeader, secret))) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType = request.headers.get('content-type') || '';
  const body = parseCalWebhookBody(rawBody, contentType);
  const { trigger, payload } = normalizeCalPayload(body);
  const t = trigger.toUpperCase();

  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'ORDERS_KV is not bound on this worker.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const orderId = extractOrderIdFromCalPayload(payload);
  if (!orderId) {
    console.warn('[cal-booking] no orderId in payload; trigger=', t);
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_order_id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (CLEAR_TRIGGERS.has(t)) {
    const { order, updated } = await applyCalBookingToOrder(kv, orderId, null, t);
    if (!order) {
      return new Response(JSON.stringify({ ok: false, error: 'order_not_found', orderId }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, orderId, cleared: true, updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (SLOT_TRIGGERS.has(t)) {
    const start = String(payload.startTime ?? '');
    const end = String(payload.endTime ?? '');
    if (!start || !end) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_start_end', orderId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const slot = formatCalPickupSlot(start, end);
    const { order, updated } = await applyCalBookingToOrder(kv, orderId, slot, t);
    if (!order) {
      return new Response(JSON.stringify({ ok: false, error: 'order_not_found', orderId }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, orderId, updated, slot }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, ignored: true, trigger: t }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
