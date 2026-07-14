import type { APIRoute } from 'astro';
import type { OrderStatus } from '../../../lib/order-types';
import {
  createWalkInStoredOrder,
  parseAdminRebuildPayload,
  saveOrder,
  summarizeItemsForNtfy,
} from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { getProductsConfig, orderSkusToMap } from '../../../lib/products-config';
import { publishNtfyNotification } from '../../../lib/ntfy';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

function isOrderStatus(s: string): s is OrderStatus {
  return s === 'pending' || s === 'scheduled' || s === 'fulfilled';
}

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

  let parsed;
  try {
    parsed = parseAdminRebuildPayload(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Walk-in always accepts an explicit dollar deposit (default 0).
  if (parsed.depositAmount === undefined) {
    parsed.depositAmount = 0;
  }

  let status: OrderStatus = 'fulfilled';
  if (body.status !== undefined && body.status !== null && String(body.status).trim() !== '') {
    const s = String(body.status);
    if (!isOrderStatus(s)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    status = s;
  }

  let deliverySlot: string | null = null;
  if ('deliverySlot' in body) {
    deliverySlot =
      body.deliverySlot === null || body.deliverySlot === undefined
        ? null
        : String(body.deliverySlot).trim() || null;
  }

  const productsConfig = await getProductsConfig(kv);
  const skuMap = orderSkusToMap(productsConfig.orderSkus);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  let order;
  try {
    order = createWalkInStoredOrder(
      {
        ...parsed,
        status,
        deliverySlot,
      },
      id,
      createdAt,
      skuMap
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await saveOrder(kv, order);

  const siteBase = (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
  const adminOrderUrl = `${siteBase}/admin/orders/${encodeURIComponent(order.id)}`;
  const itemsLine = summarizeItemsForNtfy(order.items);

  await publishNtfyNotification({
    title: `Walk-in order: ${order.customer.name}`,
    message: [
      `Order ID: ${order.id}`,
      itemsLine ? `Items: ${itemsLine}` : '',
      `Order total: $${order.discountedSubtotal.toFixed(2)}`,
      `Deposit: $${order.depositAmount.toFixed(2)}`,
      `Status: ${order.status}`,
      `Email: ${order.customer.email}`,
      `Phone: ${order.customer.phone || '—'}`,
      `Admin: ${adminOrderUrl}`,
      '(No schedule email sent)',
    ]
      .filter(Boolean)
      .join('\n'),
    workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
  });

  return new Response(
    JSON.stringify({ success: true, orderId: order.id, order }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
