import type { APIRoute } from 'astro';
import { publishNtfyNotification } from '../../lib/ntfy';
import {
  buildStoredOrder,
  saveOrder,
  summarizeItemsForNtfy,
  type BuildOrderInput,
} from '../../lib/orders';
import { getOrdersKvFromLocals } from '../../lib/orders-kv';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({
        error: 'Order storage is not configured',
        details:
          'ORDERS_KV is missing. Add a KV namespace binding named ORDERS_KV in wrangler.jsonc (see .env.example).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const b = body as Record<string, unknown>;
  const customerInfo = b.customerInfo as Record<string, unknown> | undefined;
  const quantities = b.quantities as Record<string, unknown> | undefined;

  if (!customerInfo || typeof customerInfo !== 'object') {
    return new Response(JSON.stringify({ error: 'Missing customerInfo' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!quantities || typeof quantities !== 'object') {
    return new Response(JSON.stringify({ error: 'Missing quantities' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const input: BuildOrderInput = {
    firstName: String(customerInfo.firstName ?? ''),
    lastName: String(customerInfo.lastName ?? ''),
    email: String(customerInfo.email ?? ''),
    phone: String(customerInfo.phone ?? ''),
    notes:
      customerInfo.notes != null
        ? String(customerInfo.notes)
        : customerInfo.message != null
          ? String(customerInfo.message)
          : null,
    depositSelected: Boolean(b.depositSelected ?? b.isDeposit),
    quantities,
  };

  if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim()) {
    return new Response(JSON.stringify({ error: 'Missing customer name or email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  let order;
  try {
    order = buildStoredOrder(input, id, createdAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await saveOrder(kv, order);

  const customerName = order.customer.name || 'Customer';
  const itemsLine = summarizeItemsForNtfy(order.items);
  const ntfyTitle = `New order: ${customerName}`;
  const ntfyMessage = [
    `Order ID: ${order.id}`,
    itemsLine ? `Items: ${itemsLine}` : '',
    `Order total: $${order.discountedSubtotal.toFixed(2)}`,
    order.deposit.selected
      ? `Deposit (10% at checkout): $${order.depositAmount.toFixed(2)}`
      : 'Deposit: not selected at checkout',
    `Email: ${order.customer.email}`,
    `Phone: ${order.customer.phone || '—'}`,
  ]
    .filter(Boolean)
    .join('\n');

  await publishNtfyNotification({ title: ntfyTitle, message: ntfyMessage });

  return new Response(JSON.stringify({ success: true, orderId: order.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
