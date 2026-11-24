import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { getOrder, pushRevision } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { getOrderNotifyEmail, getResendFromAddress } from '../../../lib/order-receipt-email';
import { buildOrderReadyHtml, buildOrderReadySubject } from '../../../lib/order-ready-email';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

const MAX_BATCH = 100;

type Result =
  | { id: string; ok: true; sentTo: string; sentAt: string }
  | { id: string; ok: false; skipped?: boolean; error: string };

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Admin: email "your order is ready for pickup" to one or many customers.
 * Body: { ids: string[], resend?: boolean } (or { id }). Each order is handled on its own, so
 * one bad address does not stop the batch. Already-notified orders are skipped unless `resend`.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return json({ error: 'Order storage is not configured', details: 'ORDERS_KV binding is missing.' }, 503);
  }

  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey) {
    return json({ error: 'Email is not configured', details: 'RESEND_API_KEY is missing.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : [];
  const ids = [...new Set(rawIds.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return json({ error: 'Missing order ids' }, 400);
  if (ids.length > MAX_BATCH) return json({ error: `At most ${MAX_BATCH} orders at a time` }, 400);
  const resendAgain = body.resend === true;

  const resend = new Resend(apiKey);
  const fromAddress = getResendFromAddress();
  const replyTo = getOrderNotifyEmail();
  const results: Result[] = [];

  for (const id of ids) {
    const order = await getOrder(kv, id);
    if (!order) {
      results.push({ id, ok: false, error: 'Order not found' });
      continue;
    }
    if (order.status === 'canceled') {
      results.push({ id, ok: false, skipped: true, error: 'Order is canceled' });
      continue;
    }
    if (order.readyNotice && !resendAgain) {
      results.push({ id, ok: false, skipped: true, error: `Already notified ${order.readyNotice.sentAt}` });
      continue;
    }
    const to = order.customer.email?.trim();
    if (!to) {
      results.push({ id, ok: false, error: 'Order has no customer email' });
      continue;
    }

    const sent = await resend.emails.send({
      from: fromAddress,
      to: [to],
      replyTo,
      subject: buildOrderReadySubject(order),
      html: buildOrderReadyHtml(order),
    });
    if (sent.error) {
      console.error('[send-ready-notice] send failed:', id, sent.error);
      results.push({ id, ok: false, error: sent.error.message || String(sent.error) });
      continue;
    }

    const sentAt = new Date().toISOString();
    order.readyNotice = { sentAt, to };
    pushRevision(order, { at: sentAt, action: 'meta', summary: `Ready-for-pickup email sent to ${to}` });
    await kv.put(order.id, JSON.stringify(order));
    results.push({ id, ok: true, sentTo: to, sentAt });
  }

  const sent = results.filter((r) => r.ok).length;
  return json({ success: sent > 0 || results.every((r) => !r.ok && r.skipped), sent, results }, 200);
};
