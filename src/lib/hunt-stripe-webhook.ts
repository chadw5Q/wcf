import type Stripe from 'stripe';
import { sendHuntBalanceConfirmationEmails } from './hunt-balance-email';
import { notifyChadNewHuntReservation, sendHuntDepositConfirmationEmails } from './hunt-deposit-email';
import { getReservation, putReservation, type HuntReservation } from './hunt-reservations';

export type HuntWebhookHandleResult =
  | { handled: true; detail: string }
  | { handled: false; detail: string };

async function handleHuntDepositCheckout(session: Stripe.Checkout.Session, kv: KVNamespace): Promise<HuntWebhookHandleResult> {
  const rid = session.metadata?.reservation_id?.trim();
  if (!rid) {
    return { handled: false, detail: 'missing_reservation_id' };
  }

  if (session.payment_status !== 'paid') {
    return { handled: false, detail: `payment_status_${session.payment_status ?? 'unknown'}` };
  }

  const existing = await getReservation(kv, rid);
  if (!existing) {
    return { handled: false, detail: 'reservation_not_found' };
  }

  if (existing.status === 'deposit_paid') {
    return { handled: true, detail: 'idempotent_already_deposit_paid' };
  }

  if (existing.status !== 'draft') {
    return { handled: false, detail: `invalid_status_for_deposit_${existing.status}` };
  }

  const updated: HuntReservation = {
    ...existing,
    status: 'deposit_paid',
    stripeDepositSessionId: session.id,
  };
  await putReservation(kv, updated);

  await sendHuntDepositConfirmationEmails(updated);
  await notifyChadNewHuntReservation(updated);

  return { handled: true, detail: 'deposit_confirmed' };
}

async function handleHuntBalanceCheckout(session: Stripe.Checkout.Session, kv: KVNamespace): Promise<HuntWebhookHandleResult> {
  const rid = session.metadata?.reservation_id?.trim();
  if (!rid) {
    return { handled: false, detail: 'missing_reservation_id' };
  }

  if (session.payment_status !== 'paid') {
    return { handled: false, detail: `payment_status_${session.payment_status ?? 'unknown'}` };
  }

  const existing = await getReservation(kv, rid);
  if (!existing) {
    return { handled: false, detail: 'reservation_not_found' };
  }

  if (existing.status === 'balance_paid') {
    return { handled: true, detail: 'idempotent_already_balance_paid' };
  }

  if (existing.status !== 'deposit_paid' && existing.status !== 'confirmed') {
    return { handled: false, detail: `invalid_status_for_balance_${existing.status}` };
  }

  const updated: HuntReservation = {
    ...existing,
    status: 'balance_paid',
    stripeBalanceSessionId: session.id,
  };
  await putReservation(kv, updated);

  await sendHuntBalanceConfirmationEmails(updated);

  return { handled: true, detail: 'balance_confirmed' };
}

/**
 * Routes `checkout.session.completed` by `metadata.hunt_checkout_kind` (`deposit` | `balance`).
 */
export async function handleHuntCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  kv: KVNamespace
): Promise<HuntWebhookHandleResult> {
  const kind = session.metadata?.hunt_checkout_kind?.trim();
  if (kind === 'deposit') {
    return handleHuntDepositCheckout(session, kv);
  }
  if (kind === 'balance') {
    return handleHuntBalanceCheckout(session, kv);
  }
  return { handled: false, detail: 'not_hunt_checkout' };
}
