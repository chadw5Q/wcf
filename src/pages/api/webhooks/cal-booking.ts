import type { APIRoute } from 'astro';
import {
  extractCalBookingTimes,
  formatCalBookingAlertWithoutOrderId,
  formatCalBookingOrderNotFoundAlert,
  formatCalPickupSlot,
  normalizeCalPayload,
  normalizeCalTriggerEvent,
  parseCalWebhookBody,
  resolveOrderIdFromCalWebhook,
  verifyCalWebhookSignature,
} from '../../../lib/cal-webhook';
import { applyCalBookingToOrder, summarizeItemsForNtfy } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { publishNtfyNotification } from '../../../lib/ntfy';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

/** Browsers send GET; Cal.com sends POST. Without GET, opening this URL shows Astro’s 404 and looks “broken”. */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      ok: true,
      endpoint: 'cal-booking',
      usage:
        'Cal.com must POST signed webhook JSON here (Subscriber URL). This GET response only confirms the route exists.',
      calSetup:
        'In Cal → Event type → Advanced → Booking questions: add Short text with identifier exactly `orderId` (camelCase). Links from your site use ?orderId=<uuid>. If the field slug is different (e.g. order-id), rename it to orderId or the webhook cannot match KV.',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );

const SLOT_TRIGGERS = new Set([
  'BOOKING_CREATED',
  'BOOKING_RESCHEDULED',
  'BOOKING_REQUESTED',
  'INSTANT_MEETING_CREATED',
  'BOOKING_PAID',
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
  const t = normalizeCalTriggerEvent(trigger);

  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'ORDERS_KV is not bound on this worker.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const orderId = resolveOrderIdFromCalWebhook(rawBody, body, payload);
  if (!orderId) {
    const resKeys =
      payload.responses && typeof payload.responses === 'object' && !Array.isArray(payload.responses)
        ? Object.keys(payload.responses as object).join(', ')
        : '(none)';
    console.warn(`[cal-booking] no orderId; trigger=${t}; responses field keys: ${resKeys}`);

    if (SLOT_TRIGGERS.has(t)) {
      await publishNtfyNotification({
        title: 'Cal pickup: missing order ID',
        message: formatCalBookingAlertWithoutOrderId(payload, t),
        workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
      });
      console.log('[cal-booking] ntfy sent (missing orderId alert)');
    }

    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_order_id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (CLEAR_TRIGGERS.has(t)) {
    const { order, updated } = await applyCalBookingToOrder(kv, orderId, null, t);
    if (!order) {
      console.warn('[cal-booking] order_not_found', { orderId, trigger: t });
      await publishNtfyNotification({
        title: 'Cal pickup: unknown order ID',
        message: formatCalBookingOrderNotFoundAlert(orderId, payload, t),
        workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
      });
      return new Response(JSON.stringify({ ok: false, error: 'order_not_found', orderId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, orderId, cleared: true, updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (SLOT_TRIGGERS.has(t)) {
    const { start, end } = extractCalBookingTimes(payload);
    if (!start || !end) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_start_end', orderId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const slot = formatCalPickupSlot(start, end);
    const { order, updated } = await applyCalBookingToOrder(kv, orderId, slot, t);
    if (!order) {
      console.warn('[cal-booking] order_not_found', { orderId, trigger: t });
      await publishNtfyNotification({
        title: 'Cal pickup: unknown order ID',
        message: formatCalBookingOrderNotFoundAlert(orderId, payload, t),
        workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
      });
      return new Response(JSON.stringify({ ok: false, error: 'order_not_found', orderId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Notify whenever we have a slot + order (not only when KV changed). Cal may replay webhooks or
    // the slot may already match KV; skipping ntfy on `!updated` hid real bookings from the phone.
    if (slot) {
      const siteBase = (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
      const adminUrl = `${siteBase}/admin/orders/${encodeURIComponent(orderId)}`;
      const name = order.customer.name?.trim() || 'Customer';
      const itemsLine = summarizeItemsForNtfy(order.items);
      const replayNote = updated ? '' : '\n(Already saved — Cal resent same slot)';
      await publishNtfyNotification({
        title: `Pickup scheduled: ${name}`,
        message: [
          `Order ID: ${orderId}`,
          `Slot: ${slot}`,
          itemsLine ? `Items: ${itemsLine}` : '',
          `Email: ${order.customer.email}`,
          `Admin: ${adminUrl}`,
          `Cal: ${t}${replayNote}`,
        ]
          .filter(Boolean)
          .join('\n'),
        workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
      });
      console.log('[cal-booking] ntfy published', { orderId, updated, trigger: t });
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
