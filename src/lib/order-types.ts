export type OrderStatus = 'pending' | 'scheduled' | 'fulfilled';

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
  balanceDue: number;
  notes: string | null;
  deliverySlot: string | null;
  status: OrderStatus;
  revisionLog?: OrderRevisionEntry[];
  /** Queued / sent post-purchase review ask (first-party reviews). */
  reviewRequest?: OrderReviewRequest;
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
