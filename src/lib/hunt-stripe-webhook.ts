import type Stripe from 'stripe';
import { sendHuntBalanceConfirmationEmails } from './hunt-balance-email';
import { notifyChadNewHuntReservation, sendHuntDepositConfirmationEmails } from './hunt-deposit-email';
import {
  getReservation,
  markAllBalancesPaid,
  markAllDepositsPaid,
  markHunterBalancePaid,
  markHunterDepositPaid,
  putReservation,
  type HuntPaymentMethod,
} from './hunt-reservations';

export type HuntWebhookHandleResult =
  | { handled: true; detail: string }
  | { handled: false; detail: string };

function railToMethod(rail: string | undefined): HuntPaymentMethod {
  if (rail === 'ach') return 'stripe_ach';
  if (rail === 'card') return 'stripe_card';
  return 'stripe_card';
}

function parseHunterIndex(session: Stripe.Checkout.Session): number | null {
  const raw = session.metadata?.hunter_index?.trim();
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

async function handleHuntDepositCheckout(
  session: Stripe.Checkout.Session,
  kv: KVNamespace
): Promise<HuntWebhookHandleResult> {
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

  const method = railToMethod(session.metadata?.hunt_rail);
  const hunterIndex = parseHunterIndex(session);

  if (hunterIndex != null) {
    const pay = existing.hunterPayments[hunterIndex];
    if (pay?.depositPaid) {
      return { handled: true, detail: 'idempotent_hunter_deposit_paid' };
    }
    const updated = markHunterDepositPaid(existing, hunterIndex, method, session.id);
    await putReservation(kv, { ...updated, stripeDepositSessionId: session.id });
    if (updated.status === 'deposit_paid' && existing.status === 'draft') {
      await sendHuntDepositConfirmationEmails(updated);
      await notifyChadNewHuntReservation(updated);
    }
    return { handled: true, detail: 'hunter_deposit_confirmed' };
  }

  if (existing.status === 'deposit_paid' || existing.hunterPayments.every((p) => p.depositPaid)) {
    return { handled: true, detail: 'idempotent_already_deposit_paid' };
  }

  if (existing.status !== 'draft' && !existing.hunterPayments.some((p) => !p.depositPaid)) {
    return { handled: false, detail: `invalid_status_for_deposit_${existing.status}` };
  }

  const updated = markAllDepositsPaid(
    { ...existing, stripeDepositSessionId: session.id },
    method,
    session.id
  );
  await putReservation(kv, updated);

  await sendHuntDepositConfirmationEmails(updated);
  await notifyChadNewHuntReservation(updated);

  return { handled: true, detail: 'deposit_confirmed' };
}

async function handleHuntBalanceCheckout(
  session: Stripe.Checkout.Session,
  kv: KVNamespace
): Promise<HuntWebhookHandleResult> {
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

  const method = railToMethod(session.metadata?.hunt_rail);
  const hunterIndex = parseHunterIndex(session);

  if (hunterIndex != null) {
    const pay = existing.hunterPayments[hunterIndex];
    if (pay?.balancePaid) {
      return { handled: true, detail: 'idempotent_hunter_balance_paid' };
    }
    if (!pay?.depositPaid) {
      return { handled: false, detail: 'hunter_deposit_required' };
    }
    const updated = markHunterBalancePaid(existing, hunterIndex, method, session.id);
    await putReservation(kv, {
      ...updated,
      stripeBalanceSessionId: session.id,
    });
    if (updated.status === 'balance_paid') {
      await sendHuntBalanceConfirmationEmails(updated);
    }
    return { handled: true, detail: 'hunter_balance_confirmed' };
  }

  if (existing.status === 'balance_paid' || existing.hunterPayments.every((p) => p.balancePaid)) {
    return { handled: true, detail: 'idempotent_already_balance_paid' };
  }

  if (
    existing.status !== 'deposit_paid' &&
    existing.status !== 'confirmed' &&
    existing.status !== 'tag_received'
  ) {
    return { handled: false, detail: `invalid_status_for_balance_${existing.status}` };
  }

  const updated = markAllBalancesPaid(
    { ...existing, stripeBalanceSessionId: session.id },
    method,
    session.id
  );
  await putReservation(kv, updated);
  await sendHuntBalanceConfirmationEmails(updated);

  return { handled: true, detail: 'balance_confirmed' };
}

/**
 * Routes `checkout.session.completed` by `metadata.hunt_checkout_kind` (`deposit` | `balance`).
 * Optional `hunter_index` + `hunt_rail` for per-hunter portal payments.
 */
export async function handleHuntCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  kv: KVNamespace
): Promise<HuntWebhookHandleResult> {
  const kind = session.metadata?.hunt_checkout_kind?.trim();
  if (kind === 'deposit' || kind === 'hunter_deposit') {
    return handleHuntDepositCheckout(session, kv);
  }
  if (kind === 'balance' || kind === 'hunter_balance') {
    return handleHuntBalanceCheckout(session, kv);
  }
  return { handled: false, detail: 'not_hunt_checkout' };
}
