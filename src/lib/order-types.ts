export type OrderStatus = 'pending' | 'scheduled' | 'fulfilled' | 'canceled';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'scheduled', 'fulfilled', 'canceled'];

/** How the order-level discount was determined (admin can override auto volume rule). */
export type DiscountMode = 'auto' | 'percent' | 'fixed' | 'none';

export interface VolumeDiscount {
  applied: boolean;
  /** Dollars off subtotal (always the resolved amount). */
  amount: number;
  mode: DiscountMode;
  /**
   * Fraction of subtotal when mode is `auto` or `percent` (e.g. 0.1 = 10%).
   * 0 for `fixed` / `none`.
   */
  rate: number;
}

export type OrderFieldName =
  | 'premiumLine'
  | 'premiumCorner'
  | 'regularLine'
  | 'regularCorner'
  | 'discountBin'
  | 'bowStave';

export interface OrderLineItem {
  product: string;
  fieldName: OrderFieldName;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Admin-visible audit trail (newest entries appended; capped on write). */
export interface OrderRevisionEntry {
  at: string;
  action: 'meta' | 'rebuild';
  summary: string;
  details?: Record<string, unknown>;
}

/** How the customer chose to pay the optional 10% deposit at checkout (Venmo preferred, then ACH, then card). */
export type DepositPayRail = 'venmo' | 'ach' | 'card';

export function parseDepositPayRail(raw: unknown): DepositPayRail | null {
  return raw === 'venmo' || raw === 'ach' || raw === 'card' ? raw : null;
}

/**
 * Where a Stripe (card / ACH) deposit stands. Only set on orders that went to Stripe Checkout.
 * - awaiting_payment: order saved, customer sent to Checkout, nothing paid yet
 * - processing: ACH authorized at Checkout, waiting for the bank to clear it
 * - paid: Stripe confirmed the money
 * - failed: the ACH debit bounced
 * - abandoned: the Checkout session expired unpaid
 */
export type CheckoutState = 'awaiting_payment' | 'processing' | 'paid' | 'failed' | 'abandoned';

export interface OrderCheckout {
  state: CheckoutState;
  updatedAt: string;
  sessionId?: string;
  sessionUrl?: string;
  /** ISO time the Checkout session stops accepting payment. */
  expiresAt?: string;
  paidAt?: string;
  /** Dollars Stripe collected, fee included. */
  amountPaid?: number;
  /** Set once the "new order" email and push have gone out, so they never repeat. */
  notifiedAt?: string;
}

export interface StoredOrder {
  id: string;
  createdAt: string;
  /** Set when the order or metadata was last changed (admin or checkout rebuild). */
  updatedAt?: string;
  customer: {
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  items: OrderLineItem[];
  subtotal: number;
  volumeDiscount: VolumeDiscount;
  discountedSubtotal: number;
  deposit: {
    selected: boolean;
    rate: 0.1;
    amount: number;
  };
  orderTotal: number;
  depositAmount: number;
  /** Deposit payment method picked at checkout; absent on older orders and walk-ins. */
  depositPayRail?: DepositPayRail | null;
  /** Stripe deposit progress; absent for Venmo, no-deposit, walk-in, and older orders. */
  checkout?: OrderCheckout;
  balanceDue: number;
  notes: string | null;
  deliverySlot: string | null;
  status: OrderStatus;
  revisionLog?: OrderRevisionEntry[];
  /** Contact this order belongs to. Set when the order is saved or backfilled. */
  contactId?: string;
  /** Queued / sent post-purchase review ask (first-party reviews). */
  reviewRequest?: OrderReviewRequest;
  /**
   * Admin confirmed the deposit arrived (Venmo, cash, check). Stripe-paid deposits count as
   * received from `checkout.state === 'paid'` without this field.
   */
  depositReceived?: { at: string; via: 'manual' };
  /** When the "your order is ready for pickup" email went out. */
  readyNotice?: { sentAt: string; to: string };
}

/** Lifecycle of the automated review email ask (Ask 1). */
export interface OrderReviewRequest {
  /** ISO date the ask becomes due. Set when status flips to fulfilled. */
  queuedFor: string;
  sentAt?: string;
  nudgedAt?: string;
  /** Set when a review is submitted against this order. */
  respondedAt?: string;
  suppressedAt?: string;
  suppressedReason?: 'buyer_opt_out' | 'admin' | 'bounced';
}
