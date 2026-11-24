/** Hedge-post deposit payment options, in the order we ask customers to use them: Venmo, then ACH, then card. */
import { checkoutChargeUsd } from './hunt-fees';
import { HUNT_VENMO_HANDLE, huntVenmoPayUrl } from './hunt-payment-info';
import type { DepositPayRail } from './order-types';

export const HEDGE_VENMO_HANDLE = HUNT_VENMO_HANDLE;

/** Note the customer should put on the Venmo payment so it can be matched to the order. */
export function hedgeVenmoNote(orderId: string): string {
  return `Hedge deposit - order ${orderId.slice(0, 8)}`;
}

export function hedgeVenmoPayUrl(depositUsd: number, orderId: string): string {
  return huntVenmoPayUrl(depositUsd, hedgeVenmoNote(orderId));
}

/** What the customer is charged for the deposit on a given rail (Venmo has no fee). */
export function hedgeDepositChargeUsd(depositUsd: number, rail: DepositPayRail): number {
  if (rail === 'venmo') return Math.round(depositUsd * 100) / 100;
  return checkoutChargeUsd(depositUsd, rail);
}

export function hedgePayRailLabel(rail: DepositPayRail): string {
  if (rail === 'venmo') return 'Venmo (no fee)';
  if (rail === 'ach') return 'Bank transfer / ACH (+0.8% fee)';
  return 'Card (+3% fee)';
}
