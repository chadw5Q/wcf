import type { APIRoute } from 'astro';
import { attachOrderToContact } from '../../lib/contacts';
import {
  findReusablePendingOrder,
  isStripeRail,
  pendingCheckoutKey,
  rememberPendingOrder,
} from '../../lib/order-checkout';
import { parseDepositPayRail } from '../../lib/order-types';
import { buildStoredOrder, saveOrder, type BuildOrderInput } from '../../lib/orders';
import { getOrdersKvFromLocals } from '../../lib/orders-kv';
import { getProductsConfig, orderSkusToMap } from '../../lib/products-config';

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
    depositPayRail: parseDepositPayRail(b.depositPayRail),
    quantities,
  };

  if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim()) {
    return new Response(JSON.stringify({ error: 'Missing customer name or email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const productsConfig = await getProductsConfig(kv);
  const skuMap = orderSkusToMap(productsConfig.orderSkus);

  // Card / ACH deposits: a retry of the same unpaid order (declined card, backed out of
  // Checkout) reuses that order instead of creating a duplicate.
  const stripeRail =
    input.depositSelected && isStripeRail(input.depositPayRail) ? input.depositPayRail : null;
  const pendingKey = stripeRail
    ? await pendingCheckoutKey(input.email, quantities, stripeRail)
    : null;
  const reusable = pendingKey ? await findReusablePendingOrder(kv, pendingKey) : null;

  const id = reusable?.id ?? crypto.randomUUID();
  const createdAt = reusable?.createdAt ?? new Date().toISOString();

  let order;
  try {
    order = buildStoredOrder(input, id, createdAt, skuMap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (reusable) {
    // Keep the payment state, contact link, and history; take any edited name, phone, or notes.
    const now = new Date().toISOString();
    order = {
      ...order,
      updatedAt: now,
      checkout: reusable.checkout,
      ...(reusable.contactId ? { contactId: reusable.contactId } : {}),
      revisionLog: [
        ...(reusable.revisionLog ?? []),
        { at: now, action: 'meta' as const, summary: 'Customer retried checkout; reused this unpaid order.' },
      ].slice(-50),
    };
    await saveOrder(kv, order);
    return new Response(JSON.stringify({ success: true, orderId: order.id, reused: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (stripeRail) {
    order.checkout = { state: 'awaiting_payment', updatedAt: createdAt };
  }

  await saveOrder(kv, order);
  if (pendingKey) {
    await rememberPendingOrder(kv, pendingKey, order.id);
  }

  try {
    await attachOrderToContact(kv, order, { channel: 'web' });
  } catch (err) {
    console.error('Failed to attach order to contact', err);
  }

  // Alerts: inquiries and Venmo deposits notify from POST /api/send-order-email right after this.
  // Card and ACH deposits notify only once Stripe reports the checkout (lib/order-checkout.ts).

  return new Response(JSON.stringify({ success: true, orderId: order.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
