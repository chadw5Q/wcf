import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { getOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import {
  buildOrderReceiptHtml,
  buildOrderReceiptSubject,
  getOrderNotifyEmail,
  getResendFromAddress,
} from '../../../lib/order-receipt-email';
import { getServerEnv } from '../../../lib/server-env';

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

  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Email is not configured',
        details: 'RESEND_API_KEY is missing.',
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

  const order = await getOrder(kv, id);
  if (!order) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (order.status !== 'fulfilled') {
    return new Response(
      JSON.stringify({
        error: 'Order must be fulfilled before sending a receipt',
        details: `Current status is "${order.status}".`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const customerEmail = order.customer.email?.trim();
  if (!customerEmail) {
    return new Response(JSON.stringify({ error: 'Order has no customer email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notifyTo = getOrderNotifyEmail();
  const fromAddress = getResendFromAddress();
  const subject = buildOrderReceiptSubject(order);
  const html = buildOrderReceiptHtml(order);
  const resend = new Resend(apiKey);

  const customerSend = await resend.emails.send({
    from: fromAddress,
    to: [customerEmail],
    replyTo: notifyTo,
    subject,
    html,
  });

  if (customerSend.error) {
    console.error('[email-receipt] customer send failed:', customerSend.error);
    return new Response(
      JSON.stringify({
        error: 'Failed to email customer receipt',
        details: customerSend.error.message || String(customerSend.error),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const adminSend = await resend.emails.send({
    from: fromAddress,
    to: [notifyTo],
    replyTo: customerEmail,
    subject,
    html,
  });

  if (adminSend.error) {
    console.error('[email-receipt] admin send failed:', adminSend.error);
    return new Response(
      JSON.stringify({
        error: 'Customer receipt sent, but admin copy failed',
        details: adminSend.error.message || String(adminSend.error),
        customerEmailId: customerSend.data?.id,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      customerEmailId: customerSend.data?.id,
      adminEmailId: adminSend.data?.id,
      sentTo: { customer: customerEmail, admin: notifyTo },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
