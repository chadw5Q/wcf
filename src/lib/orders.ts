import type {
  DiscountMode,
  OrderFieldName,
  OrderLineItem,
  OrderRevisionEntry,
  OrderStatus,
  StoredOrder,
  VolumeDiscount,
} from './order-types';
import type { OrderCheckoutKey, OrderSkuRow } from './products-config';
import { attachReviewRequestOnFulfilled } from './review-queue';

export type {
  StoredOrder,
  OrderStatus,
  OrderFieldName,
  OrderRevisionEntry,
  DiscountMode,
  VolumeDiscount,
} from './order-types';

const INDEX_KEY = 'order_index';
const MAX_INDEX_IDS = 5000;
const MAX_REVISION_LOG = 100;
const AUTO_VOLUME_RATE = 0.1;
const AUTO_VOLUME_MIN_POSTS = 100;

const LINE_KEYS: OrderFieldName[] = [
  'premiumLine',
  'premiumCorner',
  'regularLine',
  'regularCorner',
  'discountBin',
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

/** Admin discount override (optional on rebuild; defaults to auto volume rule). */
export type DiscountOverrideInput = {
  mode: DiscountMode;
  /** Whole percent 0–100 when mode is `percent` (e.g. 15 = 15%). */
  percent?: number;
  /** Dollar amount when mode is `fixed`. */
  fixedAmount?: number;
};

/**
 * Admin rebuild input.
 * When `depositAmount` is provided, it sets the deposit in dollars (0 = no deposit)
 * and overrides the checkout 10% calculation. `deposit.selected` is derived from amount > 0.
 */
export interface AdminOrderRebuildInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string | null;
  quantities: Record<string, unknown>;
  /** Explicit deposit in USD. Clamped to [0, order total] on rebuild. */
  depositAmount?: number;
  /** Order-level discount mode. Defaults to `auto` when omitted. */
  discount?: DiscountOverrideInput;
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

export type OrderSkuMap = Record<OrderCheckoutKey, OrderSkuRow>;

export function isDiscountMode(s: unknown): s is DiscountMode {
  return s === 'auto' || s === 'percent' || s === 'fixed' || s === 'none';
}

/** Normalize legacy KV records that lack `mode`. */
export function normalizeVolumeDiscount(raw: Partial<VolumeDiscount> | undefined | null): VolumeDiscount {
  if (!raw || typeof raw !== 'object') {
    return { applied: false, amount: 0, mode: 'none', rate: 0 };
  }
  const amount = Math.round(Math.max(0, Number(raw.amount) || 0) * 100) / 100;
  const rate = Number(raw.rate);
  let mode: DiscountMode;
  if (isDiscountMode(raw.mode)) {
    mode = raw.mode;
  } else {
    // Legacy KV records had no mode — treat as automatic volume rule.
    mode = 'auto';
  }
  const applied = amount > 0;
  return {
    applied,
    amount,
    mode,
    rate: Number.isFinite(rate) ? rate : mode === 'auto' && applied ? AUTO_VOLUME_RATE : 0,
  };
}

/**
 * Resolve order-level discount from subtotal + post count + optional admin override.
 * Public checkout always uses `auto` (omit override).
 */
export function resolveOrderDiscount(
  subtotal: number,
  postCount: number,
  override?: DiscountOverrideInput | null
): VolumeDiscount {
  const mode: DiscountMode = override?.mode ?? 'auto';
  const sub = Math.round(Math.max(0, subtotal) * 100) / 100;

  if (mode === 'none') {
    return { applied: false, amount: 0, mode: 'none', rate: 0 };
  }

  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(override?.percent) || 0));
    const rate = Math.round(pct) / 100;
    const amount = Math.round(sub * rate * 100) / 100;
    return { applied: amount > 0, amount, mode: 'percent', rate };
  }

  if (mode === 'fixed') {
    const fixed = Math.max(0, Number(override?.fixedAmount) || 0);
    const amount = Math.round(Math.min(fixed, sub) * 100) / 100;
    return { applied: amount > 0, amount, mode: 'fixed', rate: 0 };
  }

  // auto
  const volumeApplied = postCount >= AUTO_VOLUME_MIN_POSTS;
  const amount = volumeApplied ? Math.round(sub * AUTO_VOLUME_RATE * 100) / 100 : 0;
  return {
    applied: amount > 0,
    amount,
    mode: 'auto',
    rate: AUTO_VOLUME_RATE,
  };
}

/** Customer/admin-facing discount line label, or null when nothing to show. */
export function volumeDiscountLabel(vd: VolumeDiscount): string | null {
  const n = normalizeVolumeDiscount(vd);
  if (!n.applied || n.amount <= 0) return null;
  if (n.mode === 'auto') return 'Volume discount (10%)';
  if (n.mode === 'percent') {
    const pct = Math.round(n.rate * 1000) / 10; // one decimal if needed
    const label = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
    return `Discount (${label}%)`;
  }
  if (n.mode === 'fixed') return 'Discount';
  return 'Discount';
}

/** Shared pricing / line items for new orders and admin rebuilds. */
export function computeOrderBody(
  input: BuildOrderInput,
  skuMap: OrderSkuMap,
  discount?: DiscountOverrideInput | null
): OrderComputedBody {
  const q = {
    premiumLine: Math.max(0, Math.floor(Number(input.quantities.premiumLine) || 0)),
    premiumCorner: Math.max(0, Math.floor(Number(input.quantities.premiumCorner) || 0)),
    regularLine: Math.max(0, Math.floor(Number(input.quantities.regularLine) || 0)),
    regularCorner: Math.max(0, Math.floor(Number(input.quantities.regularCorner) || 0)),
    discountBin: Math.max(0, Math.floor(Number(input.quantities.discountBin) || 0)),
    bowStave: Math.max(0, Math.floor(Number(input.quantities.bowStave) || 0)),
  };

  for (const key of LINE_KEYS) {
    const sku = skuMap[key];
    if (!sku) throw new Error(`Missing product config for ${key}`);
    if (sku.soldOut && q[key] > 0) {
      throw new Error(`${sku.label} are currently sold out.`);
    }
  }

  const items: OrderLineItem[] = [];
  let subtotal = 0;

  for (const key of LINE_KEYS) {
    const qty = q[key];
    if (qty <= 0) continue;
    const sku = skuMap[key];
    const unitPrice = sku.unitPrice;
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;
    items.push({
      product: sku.label,
      fieldName: key,
      quantity: qty,
      unitPrice,
      lineTotal,
    });
  }

  if (items.length === 0) {
    throw new Error('Order must include at least one line item.');
  }

  const postCount =
    q.premiumLine + q.premiumCorner + q.regularLine + q.regularCorner + q.discountBin;
  const roundedSub = Math.round(subtotal * 100) / 100;
  const volumeDiscount = resolveOrderDiscount(roundedSub, postCount, discount ?? { mode: 'auto' });
  const discountedSubtotal = Math.round((roundedSub - volumeDiscount.amount) * 100) / 100;

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
    subtotal: roundedSub,
    volumeDiscount,
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

/** Server-side totals: >= 100 posts (excluding bow stave) → 10% off subtotal (auto mode). */
export function buildStoredOrder(
  input: BuildOrderInput,
  id: string,
  createdAt: string,
  skuMap: OrderSkuMap,
  discount?: DiscountOverrideInput | null
): StoredOrder {
  const body = computeOrderBody(input, skuMap, discount ?? { mode: 'auto' });
  return {
    id,
    createdAt,
    ...body,
    deliverySlot: null,
    status: 'pending',
  };
}

export interface WalkInOrderInput extends AdminOrderRebuildInput {
  status?: OrderStatus;
  deliverySlot?: string | null;
}

/**
 * Create an admin walk-in order (no public checkout / schedule email).
 * Defaults status to `fulfilled`. Applies optional dollar deposit and pickup slot.
 */
export function createWalkInStoredOrder(
  input: WalkInOrderInput,
  id: string,
  createdAt: string,
  skuMap: OrderSkuMap
): StoredOrder {
  const depositAmountRaw = input.depositAmount ?? 0;
  const order = buildStoredOrder(
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
      depositSelected: depositAmountRaw > 0,
      quantities: input.quantities,
    },
    id,
    createdAt,
    skuMap,
    input.discount ?? { mode: 'auto' }
  );

  const depositAmount =
    Math.round(Math.max(0, Math.min(depositAmountRaw, order.discountedSubtotal)) * 100) / 100;
  order.deposit = {
    selected: depositAmount > 0,
    rate: 0.1,
    amount: depositAmount,
  };
  order.depositAmount = depositAmount;
  order.balanceDue = Math.round((order.discountedSubtotal - depositAmount) * 100) / 100;

  const status: OrderStatus = input.status ?? 'fulfilled';
  if (!['pending', 'scheduled', 'fulfilled'].includes(status)) {
    throw new Error('Invalid status');
  }
  order.status = status;
  order.deliverySlot = input.deliverySlot?.trim() ? input.deliverySlot.trim() : null;

  if (status === 'fulfilled') {
    attachReviewRequestOnFulfilled(order, new Date(createdAt));
  }

  pushRevision(order, {
    at: createdAt,
    action: 'meta',
    summary: 'Walk-in order created (no schedule email).',
    details: {
      source: 'admin_walk_in',
      status: order.status,
      depositAmount: order.depositAmount,
      ...(order.reviewRequest?.queuedFor
        ? { reviewRequestQueuedFor: order.reviewRequest.queuedFor }
        : {}),
    },
  });

  return order;
}

function pushRevision(order: StoredOrder, entry: OrderRevisionEntry): void {
  const log = order.revisionLog ?? [];
  log.push(entry);
  order.revisionLog = log.length > MAX_REVISION_LOG ? log.slice(-MAX_REVISION_LOG) : log;
  order.updatedAt = entry.at;
}

/**
 * Recompute line items and totals from admin input. Preserves id, createdAt, status, deliverySlot.
 * When `input.depositAmount` is set, applies that dollar deposit (clamped to the order total).
 * Otherwise keeps `deposit.selected` and recalculates the 10% checkout deposit.
 */
export function rebuildStoredOrder(
  existing: StoredOrder,
  input: AdminOrderRebuildInput,
  skuMap: OrderSkuMap
): StoredOrder {
  const buildInput: BuildOrderInput = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    depositSelected: existing.deposit.selected,
    quantities: input.quantities,
  };

  const body = computeOrderBody(buildInput, skuMap, input.discount ?? { mode: 'auto' });

  if (input.depositAmount !== undefined) {
    const depositAmount =
      Math.round(Math.max(0, Math.min(input.depositAmount, body.discountedSubtotal)) * 100) / 100;
    const depositSelected = depositAmount > 0;
    body.deposit = {
      selected: depositSelected,
      rate: 0.1,
      amount: depositAmount,
    };
    body.depositAmount = depositAmount;
    body.balanceDue = Math.round((body.discountedSubtotal - depositAmount) * 100) / 100;
  }

  const now = new Date().toISOString();

  const entry: OrderRevisionEntry = {
    at: now,
    action: 'rebuild',
    summary:
      input.depositAmount !== undefined
        ? 'Order details updated (quantities, customer, notes, and/or deposit amount).'
        : 'Order details updated (quantities, customer, and/or notes). Deposit-at-checkout flag unchanged.',
    details: {
      depositBefore: {
        selected: existing.deposit.selected,
        amount: existing.depositAmount,
      },
      depositAfter: {
        selected: body.deposit.selected,
        amount: body.depositAmount,
      },
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

function normalizeStoredOrderStatus(order: StoredOrder): void {
  // Legacy KV records used `confirmed`; admin UI now uses `scheduled`.
  if ((order.status as string) === 'confirmed') {
    order.status = 'scheduled';
  }
}

function normalizeStoredOrderDiscount(order: StoredOrder): void {
  order.volumeDiscount = normalizeVolumeDiscount(order.volumeDiscount);
}

export async function getOrder(kv: KVNamespace, id: string): Promise<StoredOrder | null> {
  const raw = await kv.get(id);
  if (!raw) return null;
  try {
    const order = JSON.parse(raw) as StoredOrder;
    normalizeStoredOrderStatus(order);
    normalizeStoredOrderDiscount(order);
    return order;
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

/** Remove order record and drop its id from the index. Returns false if the id was not an order. */
export async function deleteOrder(kv: KVNamespace, id: string): Promise<boolean> {
  const trimmed = id.trim();
  if (!trimmed || trimmed === INDEX_KEY) return false;
  const existing = await getOrder(kv, trimmed);
  if (!existing) return false;
  await kv.delete(trimmed);
  const ids = await readIndex(kv);
  const next = ids.filter((x) => x !== trimmed);
  await writeIndex(kv, next);
  return true;
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
  patch: { status?: OrderStatus; deliverySlot?: string | null },
  now: Date = new Date()
): boolean {
  const nowIso = now.toISOString();
  const details: Record<string, unknown> = {};
  let changed = false;
  let becameFulfilled = false;

  if (patch.status !== undefined) {
    if (!['pending', 'scheduled', 'fulfilled'].includes(patch.status)) {
      throw new Error('Invalid status');
    }
    if (patch.status !== order.status) {
      details.status = { from: order.status, to: patch.status };
      becameFulfilled = patch.status === 'fulfilled';
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

  if (becameFulfilled) {
    if (attachReviewRequestOnFulfilled(order, now)) {
      details.reviewRequestQueuedFor = order.reviewRequest?.queuedFor;
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
    if (details.reviewRequestQueuedFor) parts.push('Review ask queued');
    pushRevision(order, {
      at: nowIso,
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

/** Set delivery/pickup slot from a Cal.com webhook; sets status scheduled/pending; appends revision log. */
export async function applyCalBookingToOrder(
  kv: KVNamespace,
  orderId: string,
  deliverySlot: string | null,
  calTrigger: string
): Promise<{ order: StoredOrder | null; updated: boolean }> {
  const order = await getOrder(kv, orderId);
  if (!order) return { order: null, updated: false };

  const trimmed = deliverySlot?.trim() || null;
  const nextStatus: OrderStatus = trimmed
    ? 'scheduled'
    : order.status === 'scheduled'
      ? 'pending'
      : order.status;

  if (trimmed === order.deliverySlot && nextStatus === order.status) {
    return { order, updated: false };
  }

  const now = new Date().toISOString();
  const details: Record<string, unknown> = {
    source: 'cal.com',
    trigger: calTrigger,
  };

  if (trimmed !== order.deliverySlot) {
    details.deliverySlot = { from: order.deliverySlot, to: trimmed };
    order.deliverySlot = trimmed;
  }
  if (nextStatus !== order.status) {
    details.status = { from: order.status, to: nextStatus };
    order.status = nextStatus;
  }

  const parts: string[] = [];
  if (details.deliverySlot) {
    parts.push(
      trimmed
        ? `Pickup scheduled (Cal.com ${calTrigger}): ${trimmed}`
        : `Pickup slot cleared (Cal.com ${calTrigger})`
    );
  }
  if (details.status) {
    const st = details.status as { from: string; to: string };
    parts.push(`Status: ${st.from} → ${st.to}`);
  }

  pushRevision(order, {
    at: now,
    action: 'meta',
    summary: parts.join('. ') || `Cal.com ${calTrigger}`,
    details,
  });
  await kv.put(order.id, JSON.stringify(order));
  return { order, updated: true };
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

  if (input.depositAmount !== undefined) {
    const want =
      Math.round(Math.max(0, Math.min(input.depositAmount, existing.discountedSubtotal)) * 100) / 100;
    if (want !== existing.depositAmount) return false;
    if ((want > 0) !== existing.deposit.selected) return false;
  }

  const existingVd = normalizeVolumeDiscount(existing.volumeDiscount);
  const wantDiscount: DiscountOverrideInput = input.discount ?? { mode: 'auto' };
  if (wantDiscount.mode !== existingVd.mode) return false;
  if (wantDiscount.mode === 'percent') {
    const pct = Math.round(Math.max(0, Math.min(100, Number(wantDiscount.percent) || 0)));
    const existingPct = Math.round(existingVd.rate * 100);
    if (pct !== existingPct) return false;
  }
  if (wantDiscount.mode === 'fixed') {
    const fixed = Math.round(Math.max(0, Number(wantDiscount.fixedAmount) || 0) * 100) / 100;
    if (fixed !== existingVd.amount) return false;
  }

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

  const out: AdminOrderRebuildInput = {
    firstName,
    lastName,
    email,
    phone: String(r.phone ?? '').trim(),
    notes,
    quantities: quantities as Record<string, unknown>,
  };

  if ('depositAmount' in r && r.depositAmount !== undefined && r.depositAmount !== null && r.depositAmount !== '') {
    const n = Number(r.depositAmount);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('Deposit amount must be a number greater than or equal to 0');
    }
    out.depositAmount = Math.round(n * 100) / 100;
  }

  if ('discount' in r && r.discount != null) {
    if (typeof r.discount !== 'object' || Array.isArray(r.discount)) {
      throw new Error('Invalid discount');
    }
    const d = r.discount as Record<string, unknown>;
    if (!isDiscountMode(d.mode)) {
      throw new Error('Discount mode must be auto, percent, fixed, or none');
    }
    const discount: DiscountOverrideInput = { mode: d.mode };
    if (d.mode === 'percent') {
      const pct = Number(d.percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error('Discount percent must be between 0 and 100');
      }
      discount.percent = Math.round(pct * 100) / 100;
    }
    if (d.mode === 'fixed') {
      const fixed = Number(d.fixedAmount);
      if (!Number.isFinite(fixed) || fixed < 0) {
        throw new Error('Discount amount must be a number greater than or equal to 0');
      }
      discount.fixedAmount = Math.round(fixed * 100) / 100;
    }
    out.discount = discount;
  }

  return out;
}

export function summarizeItemsForNtfy(items: OrderLineItem[]): string {
  return items.map((i) => `${i.quantity}× ${i.product}`).join(', ');
}
