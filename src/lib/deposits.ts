/**
 * Shared rules for the admin deposits list: who has put money down, what is still owed,
 * and which list (hedge posts, bow staves, hunters) they belong on.
 */
import type { OrderLineItem, StoredOrder } from './order-types';
import { hunterBalanceShareUsd, hunterDepositShareUsd } from './hunt-hunter-shares';
import { ensureHunterPayments, type HuntReservation } from './hunt-reservations';

const round2 = (n: number) => Math.round(n * 100) / 100;

export type DepositState = 'received' | 'pending' | 'none';

/**
 * - received: Stripe confirmed it, or Chad marked it received (Venmo, cash, check)
 * - pending: customer chose a deposit but the money is not confirmed (incl. ACH still clearing)
 * - none: no deposit on this order
 */
export function depositState(order: StoredOrder): DepositState {
  if (order.checkout?.state === 'paid' || order.depositReceived) return 'received';
  if (order.deposit?.selected && order.depositAmount > 0) return 'pending';
  return 'none';
}

/** Deposit amount credited toward the order (processing fees are not credited). */
export function depositCredited(order: StoredOrder): number {
  return depositState(order) === 'received' ? round2(order.depositAmount) : 0;
}

/** What the customer still owes at pickup. Only a received deposit comes off the total. */
export function amountStillOwed(order: StoredOrder): number {
  return round2(Math.max(0, order.discountedSubtotal - depositCredited(order)));
}

export type OrderCategory = 'posts' | 'staves' | 'both' | 'none';

export function isStaveItem(item: OrderLineItem): boolean {
  return item.fieldName === 'bowStave';
}

export function postItems(order: StoredOrder): OrderLineItem[] {
  return order.items.filter((i) => !isStaveItem(i) && i.quantity > 0);
}

export function staveItems(order: StoredOrder): OrderLineItem[] {
  return order.items.filter((i) => isStaveItem(i) && i.quantity > 0);
}

export function orderCategory(order: StoredOrder): OrderCategory {
  const posts = postItems(order).length > 0;
  const staves = staveItems(order).length > 0;
  if (posts && staves) return 'both';
  if (posts) return 'posts';
  if (staves) return 'staves';
  return 'none';
}

/** Orders that belong on the deposits list: a deposit was chosen and the order is still open. */
export function isOpenDepositOrder(order: StoredOrder): boolean {
  if (order.status === 'canceled' || order.status === 'fulfilled') return false;
  return depositState(order) !== 'none';
}

// ── Hunters ─────────────────────────────────────────────────────────────────

/** Total a hunt party still owes (unpaid deposits plus unpaid balances). */
export function huntPartyOutstanding(r: HuntReservation): number {
  const payments = ensureHunterPayments(r);
  let n = 0;
  for (let i = 0; i < r.hunters.length; i++) {
    const p = payments[i]!;
    if (!p.depositPaid) n += hunterDepositShareUsd(r, i);
    if (!p.balancePaid) n += hunterBalanceShareUsd(r, i);
  }
  return round2(n);
}

export type HuntDepositSummary = {
  /** Hunters whose deposit share is paid (hunters who owe no deposit count as paid). */
  paid: number;
  total: number;
  state: DepositState;
};

export function huntDepositSummary(r: HuntReservation): HuntDepositSummary {
  const payments = ensureHunterPayments(r);
  let paid = 0;
  let anyPaid = false;
  for (let i = 0; i < r.hunters.length; i++) {
    const owes = hunterDepositShareUsd(r, i) > 0;
    if (payments[i]?.depositPaid) {
      paid++;
      if (owes) anyPaid = true;
    } else if (!owes) {
      paid++;
    }
  }
  const total = r.hunters.length;
  const state: DepositState = anyPaid ? 'received' : 'pending';
  return { paid, total, state };
}

/**
 * Parties that belong on the deposits list: not cancelled or done, and either a deposit is
 * paid, the party reached a post-deposit status (legacy records), or it is a Venmo/check
 * draft waiting on Chad to confirm the money. Card/ACH drafts with nothing paid are
 * abandoned Stripe checkouts and stay off the list.
 */
export function isOpenDepositReservation(r: HuntReservation): boolean {
  if (r.status === 'cancelled' || r.status === 'fulfilled') return false;
  const payments = ensureHunterPayments(r);
  if (payments.some((p) => p.depositPaid)) return true;
  if (r.status !== 'draft') return true;
  return !r.stripeDepositSessionId;
}

export function huntWaiversSigned(r: HuntReservation): number {
  return ensureHunterPayments(r).filter((p) => Boolean(p.waiverId)).length;
}

/** Latest portal-link send time across the party, or null. */
export function huntPortalLastSent(r: HuntReservation): string | null {
  const times = ensureHunterPayments(r)
    .map((p) => p.portalSentAt)
    .filter((t): t is string => typeof t === 'string');
  if (times.length === 0) return null;
  return times.sort().at(-1)!;
}
