import type {
  OrderFieldName,
  OrderLineItem,
  OrderRevisionEntry,
  OrderStatus,
  StoredOrder,
} from './order-types';

export type { StoredOrder, OrderStatus, OrderFieldName, OrderRevisionEntry } from './order-types';

const INDEX_KEY = 'order_index';
const MAX_INDEX_IDS = 5000;
const MAX_REVISION_LOG = 100;

const PRICES: Record<OrderFieldName, number> = {
  premiumLine: 25,
  premiumCorner: 40,
  regularLine: 10,
  regularCorner: 20,
  bowStave: 125,
};

const PRODUCT_LABELS: Record<OrderFieldName, string> = {
  premiumLine: 'Premium Line Posts',
  premiumCorner: 'Premium Corner/Second Posts',
  regularLine: 'Regular Line Posts',
  regularCorner: 'Regular Corner Posts',
  bowStave: 'Traditional Bow Stave Logs',
};

const LINE_KEYS: OrderFieldName[] = [
  'premiumLine',
  'premiumCorner',
  'regularLine',
  'regularCorner',
  'bowStave',
];

export interface BuildOrderInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string | null;
  depositSelected: boolean;
  quantities: Record<string, unknown>;
}

/** Admin rebuild input — `deposit.selected` is never taken from this; it stays on the stored order. */
export interface AdminOrderRebuildInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string | null;
  quantities: Record<string, unknown>;
}

type OrderComputedBody = Pick<
  StoredOrder,
  | 'customer'
  | 'items'
  | 'subtotal'
  | 'volumeDiscount'
  | 'discountedSubtotal'
  | 'deposit'
  | 'orderTotal'
  | 'depositAmount'
  | 'balanceDue'
  | 'notes'
>;

/** Shared pricing / line items for new orders and admin rebuilds. */
export function computeOrderBody(input: BuildOrderInput): OrderComputedBody {
  const q = {
    premiumLine: Math.max(0, Math.floor(Number(input.quantities.premiumLine) || 0)),
    premiumCorner: Math.max(0, Math.floor(Number(input.quantities.premiumCorner) || 0)),
    premiumExtraLong: Math.max(0, Math.floor(Number(input.quantities.premiumExtraLong) || 0)),
    regularLine: Math.max(0, Math.floor(Number(input.quantities.regularLine) || 0)),
    regularCorner: Math.max(0, Math.floor(Number(input.quantities.regularCorner) || 0)),
    bowStave: Math.max(0, Math.floor(Number(input.quantities.bowStave) || 0)),
  };

  if (q.premiumExtraLong > 0) {
    throw new Error('Premium Extra Long Posts are sold out.');
  }

  const items: OrderLineItem[] = [];
  let subtotal = 0;

  for (const key of LINE_KEYS) {
    const qty = q[key];
    if (qty <= 0) continue;
    const unitPrice = PRICES[key];
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;
    items.push({
      product: PRODUCT_LABELS[key],
      fieldName: key,
      quantity: qty,
      unitPrice,
      lineTotal,
    });
  }

  if (items.length === 0) {
    throw new Error('Order must include at least one line item.');
  }

  const postCount = q.premiumLine + q.premiumCorner + q.regularLine + q.regularCorner;
  const volumeApplied = postCount >= 100;
  const discountAmount = volumeApplied ? Math.round(subtotal * 0.1 * 100) / 100 : 0;
  const discountedSubtotal = Math.round((subtotal - discountAmount) * 100) / 100;

  const depositAmount =
    input.depositSelected && discountedSubtotal > 0
      ? Math.round(discountedSubtotal * 0.1 * 100) / 100
      : 0;

  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();

  return {
    customer: {
      name: `${firstName} ${lastName}`.trim() || 'Customer',
      firstName,
      lastName,
      email: String(input.email || '').trim(),
      phone: String(input.phone || '').trim(),
    },
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    volumeDiscount: {
      applied: volumeApplied,
      rate: 0.1,
      amount: discountAmount,
    },
    discountedSubtotal,
    deposit: {
      selected: input.depositSelected,
      rate: 0.1,
      amount: depositAmount,
    },
    orderTotal: discountedSubtotal,
    depositAmount,
    balanceDue: Math.round((discountedSubtotal - depositAmount) * 100) / 100,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
}

/** Server-side totals: >= 100 posts (excluding bow stave) → 10% off subtotal. */
export function buildStoredOrder(input: BuildOrderInput, id: string, createdAt: string): StoredOrder {
  const body = computeOrderBody(input);
  return {
    id,
    createdAt,
    ...body,
    deliverySlot: null,
    status: 'pending',
  };
}

function pushRevision(order: StoredOrder, entry: OrderRevisionEntry): void {
  const log = order.revisionLog ?? [];
  log.push(entry);
  order.revisionLog = log.length > MAX_REVISION_LOG ? log.slice(-MAX_REVISION_LOG) : log;
  order.updatedAt = entry.at;
}

/**
 * Recompute line items and totals from admin input. Preserves id, createdAt, status, deliverySlot,
 * and deposit.selected (recalculates deposit amount only if deposit was selected at checkout).
 */
export function rebuildStoredOrder(existing: StoredOrder, input: AdminOrderRebuildInput): StoredOrder {
  const buildInput: BuildOrderInput = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    depositSelected: existing.deposit.selected,
    quantities: input.quantities,
  };

  const body = computeOrderBody(buildInput);
  const now = new Date().toISOString();

  const entry: OrderRevisionEntry = {
    at: now,
    action: 'rebuild',
    summary: 'Order details updated (quantities, customer, and/or notes). Deposit-at-checkout flag unchanged.',
    details: {
      depositSelectedUnchanged: existing.deposit.selected,
      totals: {
        before: existing.discountedSubtotal,
        after: body.discountedSubtotal,
      },
      itemsBefore: existing.items.map((i) => ({ fieldName: i.fieldName, quantity: i.quantity })),
      itemsAfter: body.items.map((i) => ({ fieldName: i.fieldName, quantity: i.quantity })),
      customerBefore: {
        name: existing.customer.name,
        email: existing.customer.email,
        phone: existing.customer.phone,
      },
      customerAfter: {
        name: body.customer.name,
        email: body.customer.email,
        phone: body.customer.phone,
      },
    },
  };

  const next: StoredOrder = {
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...body,
    deliverySlot: existing.deliverySlot,
    status: existing.status,
    revisionLog: [...(existing.revisionLog ?? [])],
  };
  pushRevision(next, entry);
  return next;
}

async function readIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(kv: KVNamespace, ids: string[]): Promise<void> {
  const trimmed = ids.slice(0, MAX_INDEX_IDS);
  await kv.put(INDEX_KEY, JSON.stringify(trimmed));
}

export async function saveOrder(kv: KVNamespace, order: StoredOrder): Promise<void> {
  await kv.put(order.id, JSON.stringify(order));
  const ids = await readIndex(kv);
  const next = [order.id, ...ids.filter((x) => x !== order.id)];
  await writeIndex(kv, next);
}

export async function getOrder(kv: KVNamespace, id: string): Promise<StoredOrder | null> {
  const raw = await kv.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredOrder;
  } catch {
    return null;
  }
}

export async function getAllOrders(kv: KVNamespace): Promise<StoredOrder[]> {
  const ids = await readIndex(kv);
  const orders: StoredOrder[] = [];
  for (const id of ids) {
    const o = await getOrder(kv, id);
    if (o) orders.push(o);
  }
  orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return orders;
}

export async function getOrdersByDateRange(
  kv: KVNamespace,
  start: Date,
  end: Date
): Promise<StoredOrder[]> {
  const all = await getAllOrders(kv);
  const s = start.getTime();
  const e = end.getTime();
  return all.filter((o) => {
    const t = new Date(o.createdAt).getTime();
    return t >= s && t <= e;
  });
}

/** Apply status / delivery slot changes and append `revisionLog` when something changed. Returns whether the order mutated. */
export function applyOrderMetaPatch(
  order: StoredOrder,
  patch: { status?: OrderStatus; deliverySlot?: string | null }
): boolean {
  const now = new Date().toISOString();
  const details: Record<string, unknown> = {};
  let changed = false;

  if (patch.status !== undefined) {
    if (!['pending', 'confirmed', 'fulfilled'].includes(patch.status)) {
      throw new Error('Invalid status');
    }
    if (patch.status !== order.status) {
      details.status = { from: order.status, to: patch.status };
      order.status = patch.status;
      changed = true;
    }
  }

  if (patch.deliverySlot !== undefined) {
    const next = patch.deliverySlot?.trim() || null;
    if (next !== order.deliverySlot) {
      details.deliverySlot = { from: order.deliverySlot, to: next };
      order.deliverySlot = next;
      changed = true;
    }
  }

  if (changed) {
    const parts: string[] = [];
    if (details.status) {
      const st = details.status as { from: string; to: string };
      parts.push(`Status: ${st.from} → ${st.to}`);
    }
    if (details.deliverySlot) parts.push('Delivery / pickup slot updated');
    pushRevision(order, {
      at: now,
      action: 'meta',
      summary: parts.join('. ') || 'Metadata updated',
      details,
    });
  }

  return changed;
}

export async function updateOrderFields(
  kv: KVNamespace,
  id: string,
  patch: { status?: OrderStatus; deliverySlot?: string | null }
): Promise<StoredOrder | null> {
  const order = await getOrder(kv, id);
  if (!order) return null;
  applyOrderMetaPatch(order, patch);
  await kv.put(order.id, JSON.stringify(order));
  return order;
}

/** True when admin rebuild input matches the stored order (no recomputation needed). */
export function adminRebuildMatchesExisting(existing: StoredOrder, input: AdminOrderRebuildInput): boolean {
  if (String(input.firstName || '').trim() !== existing.customer.firstName) return false;
  if (String(input.lastName || '').trim() !== existing.customer.lastName) return false;
  if (String(input.email || '').trim() !== existing.customer.email) return false;
  if (String(input.phone || '').trim() !== existing.customer.phone) return false;
  const inNotes = input.notes?.trim() ? input.notes.trim() : null;
  if (inNotes !== (existing.notes ?? null)) return false;

  for (const key of LINE_KEYS) {
    const want = Math.max(0, Math.floor(Number(input.quantities[key]) || 0));
    const have = existing.items.find((i) => i.fieldName === key)?.quantity ?? 0;
    if (want !== have) return false;
  }
  const extra = Math.max(0, Math.floor(Number(input.quantities.premiumExtraLong) || 0));
  if (extra !== 0) return false;
  return true;
}

export function parseAdminRebuildPayload(r: Record<string, unknown>): AdminOrderRebuildInput {
  const firstName = String(r.firstName ?? '').trim();
  const lastName = String(r.lastName ?? '').trim();
  const email = String(r.email ?? '').trim();
  if (!firstName || !lastName || !email) {
    throw new Error('Customer first name, last name, and email are required');
  }
  const quantities = r.quantities;
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities)) {
    throw new Error('Missing or invalid quantities');
  }
  const notesRaw = r.notes;
  const notes =
    notesRaw === null || notesRaw === undefined
      ? null
      : String(notesRaw).trim()
        ? String(notesRaw).trim()
        : null;
  return {
    firstName,
    lastName,
    email,
    phone: String(r.phone ?? '').trim(),
    notes,
    quantities: quantities as Record<string, unknown>,
  };
}

export function summarizeItemsForNtfy(items: OrderLineItem[]): string {
  return items.map((i) => `${i.quantity}× ${i.product}`).join(', ');
}
