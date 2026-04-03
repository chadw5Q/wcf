export type OrderStatus = 'pending' | 'scheduled' | 'fulfilled';

export type OrderFieldName =
  | 'premiumLine'
  | 'premiumCorner'
  | 'regularLine'
  | 'regularCorner'
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
  volumeDiscount: {
    applied: boolean;
    rate: 0.1;
    amount: number;
  };
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
}
