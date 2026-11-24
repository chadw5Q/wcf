/**
 * Stripe (card / ACH) deposit lifecycle for hedge orders.
 *
 * 1. POST /api/orders saves the order with checkout.state = awaiting_payment. If the same email
 *    submits the same items on the same rail while an unpaid order is still pending (30 min),
 *    that order is reused instead of creating a duplicate.
 * 2. POST /api/create-deposit-payment reuses the order's open Checkout session, or makes a new
 *    one that expires after an hour.
 * 3. Stripe events (webhook, plus the success page as a backup) move the order along and send
 *    the "new order" email and push only once money is confirmed (or, for ACH, authorized).
 */
import type Stripe from 'stripe';
import type { DepositPayRail, OrderCheckout, StoredOrder } from './order-types';
import { getOrder, saveOrder } from './orders';
import { hedgePayRailLabel } from './hedge-deposit';
import { sendOrderNotifications, type OrderNotifyStage } from './order-notify';
import { publishNtfyNotification } from './ntfy';
import { getServerEnv } from './server-env';

/** How long a retry of the same unpaid order reuses the first one. */
export const PENDING_CHECKOUT_REUSE_MS = 30 * 60 * 1000;
/** Checkout session lifetime. Stripe allows 30 minutes to 24 hours. */
export const CHECKOUT_SESSION_TTL_SECONDS = 60 * 60;

const PENDING_KEY_PREFIX = 'checkout-pending:';
const QUANTITY_KEYS = [
  'premiumLine',
  'premiumCorner',
  'regularLine',
  'regularCorner',
  'discountBin',
  'bowStave',
] as const;

export function isStripeRail(rail: DepositPayRail | null | undefined): rail is 'ach' | 'card' {
  return rail === 'ach' || rail === 'card';
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same email + same item counts + same rail => same key. Hashed so the key holds no email. */
export async function pendingCheckoutKey(
  email: string,
  quantities: Record<string, unknown>,
  rail: 'ach' | 'card'
): Promise<string> {
  const counts = QUANTITY_KEYS.map((k) => `${k}=${Math.max(0, Math.floor(Number(quantities[k]) || 0))}`);
  const fingerprint = [email.trim().toLowerCase(), rail, ...counts].join('|');
  return PENDING_KEY_PREFIX + (await sha256Hex(fingerprint));
}

/** The unpaid order this retry should reuse, or null to create a new one. */
export async function findReusablePendingOrder(
  kv: KVNamespace,
  key: string,
  now: Date = new Date()
): Promise<StoredOrder | null> {
  const id = await kv.get(key);
  if (!id) return null;
  const order = await getOrder(kv, id);
  if (!order) return null;
  if (order.status !== 'pending' || order.checkout?.state !== 'awaiting_payment') return null;
  if (now.getTime() - new Date(order.createdAt).getTime() > PENDING_CHECKOUT_REUSE_MS) return null;
  return order;
}

export async function rememberPendingOrder(kv: KVNamespace, key: string, orderId: string) {
  // KV TTL must be at least 60s; the age check in findReusablePendingOrder is the real limit.
  await kv.put(key, orderId, { expirationTtl: Math.ceil(PENDING_CHECKOUT_REUSE_MS / 1000) });
}

function withCheckout(order: StoredOrder, patch: Partial<OrderCheckout>, now: string): StoredOrder {
  return {
    ...order,
    updatedAt: now,
    checkout: {
      ...(order.checkout ?? { state: 'awaiting_payment' }),
      ...patch,
      updatedAt: now,
    },
  };
}

function pushRevision(order: StoredOrder, at: string, summary: string, details?: Record<string, unknown>) {
  const log = [...(order.revisionLog ?? []), { at, action: 'meta' as const, summary, ...(details ? { details } : {}) }];
  order.revisionLog = log.slice(-50);
}

function quantitiesFromOrder(order: StoredOrder): Record<string, number> {
  const q: Record<string, number> = {};
  for (const k of QUANTITY_KEYS) q[k] = 0;
  for (const item of order.items) q[item.fieldName] = (q[item.fieldName] ?? 0) + item.quantity;
  return q;
}

function sessionOrderId(session: Stripe.Checkout.Session): string {
  return session.metadata?.order_id?.trim() || session.metadata?.orderId?.trim() || '';
}

/** True for checkout sessions created by /api/create-deposit-payment for a saved hedge order. */
export function isHedgeDepositSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.type === 'deposit' && sessionOrderId(session) !== '';
}

function adminUrl(orderId: string): string {
  const base = (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
  return `${base}/admin/orders/${encodeURIComponent(orderId)}`;
}

function chargedUsd(session: Stripe.Checkout.Session): number | undefined {
  return typeof session.amount_total === 'number' ? session.amount_total / 100 : undefined;
}

async function notifyNewOrder(
  order: StoredOrder,
  stage: OrderNotifyStage,
  session: Stripe.Checkout.Session,
  kv: KVNamespace,
  workerEnv?: Record<string, unknown>
) {
  return sendOrderNotifications(
    {
      customerInfo: {
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        email: order.customer.email,
        phone: order.customer.phone,
        notes: order.notes ?? '',
      },
      quantities: quantitiesFromOrder(order),
      stage,
      depositAmount: order.depositAmount,
      payRail: session.metadata?.pay_rail === 'ach' ? 'ach' : 'card',
      orderId: order.id,
      chargedUsd: chargedUsd(session),
    },
    { kv, workerEnv }
  );
}

async function shortPush(title: string, order: StoredOrder, lines: string[], workerEnv?: Record<string, unknown>) {
  await publishNtfyNotification({
    title,
    message: [
      `Order ID: ${order.id}`,
      ...lines,
      `Email: ${order.customer.email}`,
      `Phone: ${order.customer.phone || '—'}`,
      `Admin: ${adminUrl(order.id)}`,
    ].join('\n'),
    workerEnv,
  });
}

export type HedgeCheckoutResult = { handled: boolean; detail: string };

/**
 * Claims the one-time "new order" notification, sends it, and releases the claim if sending
 * fails so a Stripe retry can try again. The claim keeps the webhook and the success page
 * from both sending it.
 */
async function claimAndNotify(
  kv: KVNamespace,
  order: StoredOrder,
  stage: OrderNotifyStage,
  session: Stripe.Checkout.Session,
  workerEnv?: Record<string, unknown>
): Promise<boolean> {
  const now = new Date().toISOString();
  const claimed = withCheckout(order, { notifiedAt: now }, now);
  await saveOrder(kv, claimed);
  const result = await notifyNewOrder(claimed, stage, session, kv, workerEnv);
  if (!result.ok) {
    console.error('[hedge-checkout] notification failed', order.id, result.error, result.details);
    const released = withCheckout(claimed, { notifiedAt: undefined }, new Date().toISOString());
    await saveOrder(kv, released);
    return false;
  }
  return true;
}

/**
 * Applies a Stripe Checkout event to the hedge order named in the session metadata.
 * Safe to call more than once for the same event.
 */
export async function handleHedgeCheckoutEvent(
  eventType: string,
  session: Stripe.Checkout.Session,
  kv: KVNamespace,
  workerEnv?: Record<string, unknown>
): Promise<HedgeCheckoutResult> {
  const orderId = sessionOrderId(session);
  if (!orderId) return { handled: false, detail: 'missing_order_id' };

  const order = await getOrder(kv, orderId);
  if (!order) return { handled: false, detail: 'order_not_found' };

  const now = new Date().toISOString();
  const rail = session.metadata?.pay_rail === 'ach' ? 'ach' : 'card';
  const state = order.checkout?.state;

  if (eventType === 'checkout.session.completed') {
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      if (state === 'paid' && order.checkout?.notifiedAt) {
        return { handled: true, detail: 'idempotent_already_paid' };
      }
      const next = withCheckout(
        order,
        { state: 'paid', sessionId: session.id, paidAt: now, amountPaid: chargedUsd(session) },
        now
      );
      if (state !== 'paid') {
        pushRevision(next, now, `Deposit paid through Stripe (${hedgePayRailLabel(rail)}).`, {
          stripeSessionId: session.id,
        });
      }
      await saveOrder(kv, next);
      if (next.checkout?.notifiedAt) return { handled: true, detail: 'paid_already_notified' };
      const sent = await claimAndNotify(kv, next, 'paid', session, workerEnv);
      return { handled: sent, detail: sent ? 'paid_notified' : 'paid_notify_failed' };
    }

    // ACH: authorized at Checkout, money arrives days later via async_payment_* events.
    if (state === 'processing' || state === 'paid' || state === 'failed') {
      return { handled: true, detail: `idempotent_${state}` };
    }
    const next = withCheckout(order, { state: 'processing', sessionId: session.id }, now);
    pushRevision(next, now, 'Bank (ACH) deposit authorized at Stripe; waiting for it to clear.', {
      stripeSessionId: session.id,
    });
    await saveOrder(kv, next);
    if (next.checkout?.notifiedAt) return { handled: true, detail: 'processing_already_notified' };
    const sent = await claimAndNotify(kv, next, 'ach_processing', session, workerEnv);
    return { handled: sent, detail: sent ? 'processing_notified' : 'processing_notify_failed' };
  }

  if (eventType === 'checkout.session.async_payment_succeeded') {
    if (state === 'paid') return { handled: true, detail: 'idempotent_already_paid' };
    const next = withCheckout(
      order,
      { state: 'paid', sessionId: session.id, paidAt: now, amountPaid: chargedUsd(session) },
      now
    );
    pushRevision(next, now, 'Bank (ACH) deposit cleared.', { stripeSessionId: session.id });
    await saveOrder(kv, next);
    if (!next.checkout?.notifiedAt) {
      const sent = await claimAndNotify(kv, next, 'paid', session, workerEnv);
      return { handled: sent, detail: sent ? 'paid_notified' : 'paid_notify_failed' };
    }
    await shortPush(`Bank deposit cleared: ${order.customer.name}`, next, [
      `Deposit (10%): $${order.depositAmount.toFixed(2)} PAID by ACH`,
    ], workerEnv);
    return { handled: true, detail: 'ach_cleared' };
  }

  if (eventType === 'checkout.session.async_payment_failed') {
    if (state === 'failed') return { handled: true, detail: 'idempotent_failed' };
    const next = withCheckout(order, { state: 'failed', sessionId: session.id }, now);
    pushRevision(next, now, 'Bank (ACH) deposit failed; no money was received.', {
      stripeSessionId: session.id,
    });
    await saveOrder(kv, next);
    await shortPush(`Bank deposit FAILED: ${order.customer.name}`, next, [
      `Deposit (10%): $${order.depositAmount.toFixed(2)} by ACH did not go through`,
      'Order is still open; follow up with the customer.',
    ], workerEnv);
    return { handled: true, detail: 'ach_failed' };
  }

  if (eventType === 'checkout.session.expired') {
    // Only the session this order is waiting on counts; an older replaced session is ignored.
    if (order.checkout?.sessionId && order.checkout.sessionId !== session.id) {
      return { handled: true, detail: 'ignored_stale_session' };
    }
    if (state !== 'awaiting_payment') return { handled: true, detail: `ignored_state_${state ?? 'none'}` };
    const next = withCheckout(order, { state: 'abandoned' }, now);
    const prevStatus = next.status;
    next.status = 'canceled';
    pushRevision(next, now, 'Stripe checkout expired without payment; marked abandoned.', {
      stripeSessionId: session.id,
      status: { from: prevStatus, to: 'canceled' },
    });
    await saveOrder(kv, next);
    await shortPush(`Checkout abandoned, not paid: ${order.customer.name}`, next, [
      `Order total: $${order.orderTotal.toFixed(2)}; deposit of $${order.depositAmount.toFixed(2)} was never paid`,
      'Order marked canceled. Reach out if you want to follow up.',
    ], workerEnv);
    return { handled: true, detail: 'abandoned' };
  }

  return { handled: false, detail: `ignored_${eventType}` };
}
