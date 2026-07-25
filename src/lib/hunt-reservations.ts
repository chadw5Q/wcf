/**
 * Williams Creek Whitetails hunt reservations in Cloudflare KV (`HUNT_KV`).
 */

import { computeHuntOrderSummary } from './hunt-pricing';

/** PRD statuses plus `draft` for records created before deposit clears. */
export type HuntReservationStatus =
  | 'draft'
  | 'deposit_paid'
  | 'confirmed'
  | 'tag_received'
  | 'balance_paid'
  | 'fulfilled'
  | 'cancelled';

export const HUNT_RESERVATION_STATUSES: readonly HuntReservationStatus[] = [
  'draft',
  'deposit_paid',
  'confirmed',
  'tag_received',
  'balance_paid',
  'fulfilled',
  'cancelled',
] as const;

export type HuntHunter = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  state: string;
};

export type HuntPaymentMethod = 'venmo' | 'stripe_ach' | 'stripe_card' | 'other';

export const HUNT_PAYMENT_METHODS: readonly HuntPaymentMethod[] = [
  'venmo',
  'stripe_ach',
  'stripe_card',
  'other',
] as const;

/** Per-hunter payment + waiver progress. */
export type HuntHunterPayment = {
  depositPaid: boolean;
  depositPaidAt: string | null;
  depositMethod: HuntPaymentMethod | null;
  depositRef: string | null;
  balancePaid: boolean;
  balancePaidAt: string | null;
  balanceMethod: HuntPaymentMethod | null;
  balanceRef: string | null;
  waiverId: string | null;
  portalSentAt: string | null;
};

export type HuntEvent = {
  at: string;
  kind: string;
  detail: string;
  hunterIndex: number | null;
};

/** PRD reservation document (JSON in KV). */
export type HuntReservation = {
  id: string;
  createdAt: string;
  status: HuntReservationStatus;
  huntYear: number;
  preferredWeek: string;
  mealPackage: boolean;
  hunters: HuntHunter[];
  hunterCount: number;
  huntCostPerPerson: number;
  mealPackageCost: number;
  totalHuntCost: number;
  depositPerPerson: number;
  totalDeposit: number;
  balanceDue: number;
  stripeDepositSessionId: string;
  stripeBalanceSessionId: string | null;
  notes: string | null;
  hunterPayments: HuntHunterPayment[];
  events: HuntEvent[];
  tagReceivedAt: string | null;
};

export const HUNT_RESERVATION_KEY_PREFIX = 'reservation:';

export function reservationKvKey(id: string): string {
  return `${HUNT_RESERVATION_KEY_PREFIX}${id}`;
}

export function emptyHunterPayment(): HuntHunterPayment {
  return {
    depositPaid: false,
    depositPaidAt: null,
    depositMethod: null,
    depositRef: null,
    balancePaid: false,
    balancePaidAt: null,
    balanceMethod: null,
    balanceRef: null,
    waiverId: null,
    portalSentAt: null,
  };
}

export function ensureHunterPayments(r: HuntReservation): HuntHunterPayment[] {
  const n = r.hunters.length;
  const existing = r.hunterPayments ?? [];
  const out: HuntHunterPayment[] = [];
  for (let i = 0; i < n; i++) {
    out.push(existing[i] ? { ...emptyHunterPayment(), ...existing[i] } : emptyHunterPayment());
  }
  return out;
}

export function appendHuntEvent(
  r: HuntReservation,
  kind: string,
  detail: string,
  hunterIndex: number | null = null
): HuntReservation {
  const events = [...(r.events ?? []), { at: new Date().toISOString(), kind, detail, hunterIndex }];
  return { ...r, events };
}

/** Derive party status from per-hunter flags (does not overwrite cancelled/fulfilled). */
export function derivePartyStatus(r: HuntReservation): HuntReservationStatus {
  if (r.status === 'cancelled' || r.status === 'fulfilled') return r.status;
  const payments = ensureHunterPayments(r);
  const allDeposit = payments.every((p) => p.depositPaid);
  const allBalance = payments.every((p) => p.balancePaid);
  // Balance paid implies the party is complete even if deposit flags were backfilled oddly.
  if (allBalance) return 'balance_paid';
  if (allDeposit) {
    if (r.tagReceivedAt || r.status === 'tag_received') return 'tag_received';
    return 'deposit_paid';
  }
  return 'draft';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isHuntHunter(v: unknown): v is HuntHunter {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.firstName) &&
    isNonEmptyString(v.lastName) &&
    isNonEmptyString(v.email) &&
    isNonEmptyString(v.phone) &&
    isNonEmptyString(v.state)
  );
}

function parsePaymentMethod(v: unknown): HuntPaymentMethod | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && (HUNT_PAYMENT_METHODS as readonly string[]).includes(v)) {
    return v as HuntPaymentMethod;
  }
  return null;
}

function parseHunterPayment(v: unknown): HuntHunterPayment | null {
  if (!isPlainObject(v)) return null;
  const base = emptyHunterPayment();
  return {
    depositPaid: Boolean(v.depositPaid),
    depositPaidAt: typeof v.depositPaidAt === 'string' ? v.depositPaidAt : null,
    depositMethod: parsePaymentMethod(v.depositMethod) ?? base.depositMethod,
    depositRef: typeof v.depositRef === 'string' ? v.depositRef : null,
    balancePaid: Boolean(v.balancePaid),
    balancePaidAt: typeof v.balancePaidAt === 'string' ? v.balancePaidAt : null,
    balanceMethod: parsePaymentMethod(v.balanceMethod) ?? base.balanceMethod,
    balanceRef: typeof v.balanceRef === 'string' ? v.balanceRef : null,
    waiverId: typeof v.waiverId === 'string' ? v.waiverId : null,
    portalSentAt: typeof v.portalSentAt === 'string' ? v.portalSentAt : null,
  };
}

function parseEvents(v: unknown): HuntEvent[] {
  if (!Array.isArray(v)) return [];
  const out: HuntEvent[] = [];
  for (const item of v) {
    if (!isPlainObject(item)) continue;
    if (typeof item.at !== 'string' || typeof item.kind !== 'string' || typeof item.detail !== 'string') continue;
    const hunterIndex =
      typeof item.hunterIndex === 'number' && Number.isInteger(item.hunterIndex)
        ? item.hunterIndex
        : item.hunterIndex === null
          ? null
          : null;
    out.push({ at: item.at, kind: item.kind, detail: item.detail, hunterIndex });
  }
  return out;
}

export type ValidateReservationResult =
  | { ok: true; value: HuntReservation }
  | { ok: false; error: string };

/**
 * Parse and validate a reservation object (e.g. after `JSON.parse` from KV).
 * Missing hunterPayments/events are defaulted for backward compatibility.
 */
export function validateReservation(input: unknown): ValidateReservationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'Reservation must be a JSON object' };
  }

  if (!isNonEmptyString(input.id)) return { ok: false, error: 'Missing id' };
  if (!isNonEmptyString(input.createdAt)) return { ok: false, error: 'Missing createdAt' };
  if (typeof input.status !== 'string' || !HUNT_RESERVATION_STATUSES.includes(input.status as HuntReservationStatus)) {
    return { ok: false, error: 'Invalid or missing status' };
  }
  const status = input.status as HuntReservationStatus;

  if (typeof input.huntYear !== 'number' || !Number.isInteger(input.huntYear)) {
    return { ok: false, error: 'huntYear must be an integer' };
  }
  if (!isNonEmptyString(input.preferredWeek)) return { ok: false, error: 'Missing preferredWeek' };
  if (typeof input.mealPackage !== 'boolean') return { ok: false, error: 'mealPackage must be boolean' };

  if (!Array.isArray(input.hunters)) return { ok: false, error: 'hunters must be an array' };
  if (input.hunters.length === 0) return { ok: false, error: 'hunters must not be empty' };
  if (input.hunters.length > 4) return { ok: false, error: 'hunters may include at most 4 entries' };
  for (let i = 0; i < input.hunters.length; i++) {
    if (!isHuntHunter(input.hunters[i])) {
      return { ok: false, error: `Invalid hunter at index ${i}` };
    }
  }
  const hunters = input.hunters as HuntHunter[];

  if (typeof input.hunterCount !== 'number' || !Number.isInteger(input.hunterCount)) {
    return { ok: false, error: 'hunterCount must be an integer' };
  }
  if (input.hunterCount !== hunters.length) {
    return { ok: false, error: 'hunterCount must equal hunters.length' };
  }

  const nums: (keyof HuntReservation)[] = [
    'huntCostPerPerson',
    'mealPackageCost',
    'totalHuntCost',
    'depositPerPerson',
    'totalDeposit',
    'balanceDue',
  ];
  for (const k of nums) {
    const n = input[k as string];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Invalid number field: ${String(k)}` };
    }
  }

  if (typeof input.stripeDepositSessionId !== 'string') {
    return { ok: false, error: 'stripeDepositSessionId must be a string' };
  }

  let stripeBalanceSessionId: string | null;
  if (input.stripeBalanceSessionId === null || input.stripeBalanceSessionId === undefined) {
    stripeBalanceSessionId = null;
  } else if (typeof input.stripeBalanceSessionId === 'string') {
    stripeBalanceSessionId = input.stripeBalanceSessionId;
  } else {
    return { ok: false, error: 'stripeBalanceSessionId must be string or null' };
  }

  let notes: string | null;
  if (input.notes === null || input.notes === undefined) {
    notes = null;
  } else if (typeof input.notes === 'string') {
    notes = input.notes;
  } else {
    return { ok: false, error: 'notes must be string or null' };
  }

  const hunterPayments: HuntHunterPayment[] = [];
  if (Array.isArray(input.hunterPayments)) {
    for (let i = 0; i < hunters.length; i++) {
      const parsed = input.hunterPayments[i] != null ? parseHunterPayment(input.hunterPayments[i]) : null;
      hunterPayments.push(parsed ?? emptyHunterPayment());
    }
  } else {
    for (let i = 0; i < hunters.length; i++) hunterPayments.push(emptyHunterPayment());
    // Legacy: party deposit_paid / balance_paid without per-hunter flags
    if (status === 'deposit_paid' || status === 'confirmed' || status === 'tag_received' || status === 'balance_paid' || status === 'fulfilled') {
      for (const p of hunterPayments) {
        p.depositPaid = true;
        p.depositPaidAt = p.depositPaidAt ?? input.createdAt;
        p.depositMethod = p.depositMethod ?? 'stripe_card';
      }
    }
    if (status === 'balance_paid' || status === 'fulfilled') {
      for (const p of hunterPayments) {
        p.balancePaid = true;
        p.balancePaidAt = p.balancePaidAt ?? input.createdAt;
        p.balanceMethod = p.balanceMethod ?? 'stripe_card';
      }
    }
  }

  const events = parseEvents(input.events);
  const tagReceivedAt =
    typeof input.tagReceivedAt === 'string'
      ? input.tagReceivedAt
      : status === 'tag_received'
        ? input.createdAt
        : null;

  const value: HuntReservation = {
    id: input.id.trim(),
    createdAt: input.createdAt.trim(),
    status,
    huntYear: input.huntYear,
    preferredWeek: input.preferredWeek.trim(),
    mealPackage: input.mealPackage,
    hunters,
    hunterCount: input.hunterCount,
    huntCostPerPerson: input.huntCostPerPerson,
    mealPackageCost: input.mealPackageCost,
    totalHuntCost: input.totalHuntCost,
    depositPerPerson: input.depositPerPerson,
    totalDeposit: input.totalDeposit,
    balanceDue: input.balanceDue,
    stripeDepositSessionId: input.stripeDepositSessionId,
    stripeBalanceSessionId,
    notes,
    hunterPayments,
    events,
    tagReceivedAt,
  };

  return { ok: true, value };
}

/** Stable JSON for KV (optional fields normalized to `null`). */
export function serializeReservation(r: HuntReservation): string {
  const normalized: HuntReservation = {
    ...r,
    stripeBalanceSessionId: r.stripeBalanceSessionId ?? null,
    notes: r.notes ?? null,
    hunterPayments: ensureHunterPayments(r),
    events: r.events ?? [],
    tagReceivedAt: r.tagReceivedAt ?? null,
  };
  return JSON.stringify(normalized);
}

export function parseReservationJson(raw: string): ValidateReservationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  return validateReservation(parsed);
}

export async function putReservation(kv: KVNamespace, r: HuntReservation): Promise<void> {
  const v = validateReservation(r);
  if (!v.ok) throw new Error(v.error);
  const key = reservationKvKey(v.value.id);
  await kv.put(key, serializeReservation(v.value));
}

export async function deleteReservation(kv: KVNamespace, id: string): Promise<boolean> {
  const key = reservationKvKey(id.trim());
  const existing = await kv.get(key);
  if (existing === null || existing === undefined || existing === '') return false;
  await kv.delete(key);
  return true;
}

export async function getReservation(kv: KVNamespace, id: string): Promise<HuntReservation | null> {
  const raw = await kv.get(reservationKvKey(id));
  if (raw === null || raw === undefined || raw === '') return null;
  const v = parseReservationJson(raw);
  if (!v.ok) return null;
  return v.value;
}

/** Lists reservation UUIDs under `reservation:` (used for final payment lookup). */
export async function listReservationIds(kv: KVNamespace): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix: HUNT_RESERVATION_KEY_PREFIX, cursor });
    for (const k of page.keys) {
      const id = k.name.slice(HUNT_RESERVATION_KEY_PREFIX.length);
      if (id) ids.push(id);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return ids;
}

export async function listAllReservations(kv: KVNamespace): Promise<HuntReservation[]> {
  const ids = await listReservationIds(kv);
  const out: HuntReservation[] = [];
  for (const id of ids) {
    const r = await getReservation(kv, id);
    if (r) out.push(r);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

export type FinalPaymentLookupCriteria = {
  email: string;
  firstName: string;
  lastName: string;
  huntYear: number;
  hunterCount: number;
  mealPackage: boolean;
};

/**
 * Finds the reservation for balance checkout: deposit paid (or confirmed), matching party + year + meal flag,
 * and hunter identity on the matching email.
 */
export async function findReservationForFinalPayment(
  kv: KVNamespace,
  criteria: FinalPaymentLookupCriteria
): Promise<HuntReservation | null> {
  const email = criteria.email.trim().toLowerCase();
  const fn = criteria.firstName.trim().toLowerCase();
  const ln = criteria.lastName.trim().toLowerCase();

  const ids = await listReservationIds(kv);
  const matches: HuntReservation[] = [];

  for (const id of ids) {
    const r = await getReservation(kv, id);
    if (!r) continue;
    if (r.status !== 'deposit_paid' && r.status !== 'confirmed' && r.status !== 'tag_received') continue;
    if (r.huntYear !== criteria.huntYear) continue;
    if (r.hunterCount !== criteria.hunterCount) continue;
    if (r.mealPackage !== criteria.mealPackage) continue;

    const hunter = r.hunters.find((h) => h.email.trim().toLowerCase() === email);
    if (!hunter) continue;
    if (hunter.firstName.trim().toLowerCase() !== fn || hunter.lastName.trim().toLowerCase() !== ln) continue;

    matches.push(r);
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return matches[0]!;
}

export type NewDraftReservationInput = {
  huntYear: number;
  preferredWeek: string;
  mealPackage: boolean;
  hunters: HuntHunter[];
  huntCostPerPerson: number;
  mealPackageCost: number;
  totalHuntCost: number;
  depositPerPerson: number;
  totalDeposit: number;
  balanceDue: number;
  /** Use `''` before Stripe creates a Checkout Session. */
  stripeDepositSessionId?: string;
  stripeBalanceSessionId?: string | null;
  notes?: string | null;
};

/**
 * Build a new `draft` reservation (e.g. before Stripe). Caller should `putReservation` when ready.
 * Does not touch the network.
 */
export function createDraftReservation(input: NewDraftReservationInput): HuntReservation {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const hunters = input.hunters;
  const r: HuntReservation = {
    id,
    createdAt,
    status: 'draft',
    huntYear: input.huntYear,
    preferredWeek: input.preferredWeek,
    mealPackage: input.mealPackage,
    hunters,
    hunterCount: hunters.length,
    huntCostPerPerson: input.huntCostPerPerson,
    mealPackageCost: input.mealPackageCost,
    totalHuntCost: input.totalHuntCost,
    depositPerPerson: input.depositPerPerson,
    totalDeposit: input.totalDeposit,
    balanceDue: input.balanceDue,
    stripeDepositSessionId: input.stripeDepositSessionId ?? '',
    stripeBalanceSessionId: input.stripeBalanceSessionId ?? null,
    notes: input.notes ?? null,
    hunterPayments: hunters.map(() => emptyHunterPayment()),
    events: [{ at: createdAt, kind: 'created', detail: 'Draft reservation created', hunterIndex: null }],
    tagReceivedAt: null,
  };
  const v = validateReservation(r);
  if (!v.ok) throw new Error(v.error);
  return v.value;
}

export function markHunterDepositPaid(
  r: HuntReservation,
  hunterIndex: number,
  method: HuntPaymentMethod,
  ref: string | null = null,
  paidAt: string | null = null
): HuntReservation {
  const hunterPayments = ensureHunterPayments(r);
  if (hunterIndex < 0 || hunterIndex >= hunterPayments.length) throw new Error('Invalid hunterIndex');
  const now = paidAt ?? new Date().toISOString();
  hunterPayments[hunterIndex] = {
    ...hunterPayments[hunterIndex]!,
    depositPaid: true,
    depositPaidAt: now,
    depositMethod: method,
    depositRef: ref,
  };
  let next: HuntReservation = { ...r, hunterPayments };
  next = appendHuntEvent(next, 'deposit_paid', `Deposit marked paid via ${method}`, hunterIndex);
  next = { ...next, status: derivePartyStatus(next) };
  return next;
}

export function markHunterBalancePaid(
  r: HuntReservation,
  hunterIndex: number,
  method: HuntPaymentMethod,
  ref: string | null = null,
  paidAt: string | null = null
): HuntReservation {
  const hunterPayments = ensureHunterPayments(r);
  if (hunterIndex < 0 || hunterIndex >= hunterPayments.length) throw new Error('Invalid hunterIndex');
  const now = paidAt ?? new Date().toISOString();
  hunterPayments[hunterIndex] = {
    ...hunterPayments[hunterIndex]!,
    balancePaid: true,
    balancePaidAt: now,
    balanceMethod: method,
    balanceRef: ref,
  };
  let next: HuntReservation = { ...r, hunterPayments };
  next = appendHuntEvent(next, 'balance_paid', `Balance marked paid via ${method}`, hunterIndex);
  next = { ...next, status: derivePartyStatus(next) };
  return next;
}

/** Mark every hunter's deposit paid (legacy party Stripe Checkout). */
export function markAllDepositsPaid(
  r: HuntReservation,
  method: HuntPaymentMethod,
  ref: string | null = null
): HuntReservation {
  let next = r;
  for (let i = 0; i < r.hunters.length; i++) {
    if (!ensureHunterPayments(next)[i]?.depositPaid) {
      next = markHunterDepositPaid(next, i, method, ref);
    }
  }
  return next;
}

export function markAllBalancesPaid(
  r: HuntReservation,
  method: HuntPaymentMethod,
  ref: string | null = null
): HuntReservation {
  let next = r;
  for (let i = 0; i < r.hunters.length; i++) {
    const pay = ensureHunterPayments(next)[i];
    if (!pay?.depositPaid) {
      next = markHunterDepositPaid(next, i, method, ref);
    }
    if (!ensureHunterPayments(next)[i]?.balancePaid) {
      next = markHunterBalancePaid(next, i, method, ref);
    }
  }
  return next;
}

/**
 * Remove one hunter from a party and recalculate totals.
 * Returns null when the party would be empty — caller should delete the reservation instead.
 */
export function removeHunterFromReservation(
  r: HuntReservation,
  hunterIndex: number
): HuntReservation | null {
  if (hunterIndex < 0 || hunterIndex >= r.hunters.length) {
    throw new Error('Invalid hunterIndex');
  }
  if (r.hunters.length <= 1) return null;

  const hunters = r.hunters.filter((_, i) => i !== hunterIndex);
  const hunterPayments = ensureHunterPayments(r).filter((_, i) => i !== hunterIndex);
  const removed = r.hunters[hunterIndex]!;
  const summary = computeHuntOrderSummary(hunters.length, r.mealPackage);

  let next: HuntReservation = {
    ...r,
    hunters,
    hunterPayments,
    hunterCount: hunters.length,
    huntCostPerPerson: summary.huntLodging / hunters.length,
    mealPackageCost: summary.mealLine,
    totalHuntCost: summary.totalHuntCost,
    depositPerPerson: summary.depositPerPerson,
    totalDeposit: summary.totalDeposit,
    balanceDue: summary.balanceDueJuly1,
  };
  next = appendHuntEvent(
    next,
    'hunter_removed',
    `Removed ${removed.firstName} ${removed.lastName}`,
    null
  );
  next = { ...next, status: derivePartyStatus(next) };
  return next;
}

function applyPartyTotals(r: HuntReservation, hunterCount: number, mealPackage: boolean): HuntReservation {
  const summary = computeHuntOrderSummary(hunterCount, mealPackage);
  return {
    ...r,
    mealPackage,
    hunterCount,
    huntCostPerPerson: hunterCount > 0 ? summary.huntLodging / hunterCount : r.huntCostPerPerson,
    mealPackageCost: summary.mealLine,
    totalHuntCost: summary.totalHuntCost,
    depositPerPerson: summary.depositPerPerson,
    totalDeposit: summary.totalDeposit,
    balanceDue: summary.balanceDueJuly1,
  };
}

export type PartyDetailsPatch = {
  huntYear?: number;
  preferredWeek?: string;
  mealPackage?: boolean;
  notes?: string | null;
};

/** Update year / week / meals / notes and recalculate totals when party size or meals change. */
export function updatePartyDetails(r: HuntReservation, patch: PartyDetailsPatch): HuntReservation {
  if (r.status === 'fulfilled' || r.status === 'cancelled') {
    throw new Error('Cannot edit a fulfilled or cancelled party');
  }
  const huntYear = patch.huntYear ?? r.huntYear;
  const preferredWeek = patch.preferredWeek?.trim() || r.preferredWeek;
  const mealPackage = patch.mealPackage ?? r.mealPackage;
  const notes =
    patch.notes === undefined ? r.notes : patch.notes === null || patch.notes.trim() === '' ? null : patch.notes.trim();

  if (!Number.isInteger(huntYear) || huntYear < 2000 || huntYear > 2100) {
    throw new Error('Invalid huntYear');
  }
  if (!preferredWeek) throw new Error('preferredWeek is required');

  let next: HuntReservation = {
    ...r,
    huntYear,
    preferredWeek,
    notes,
  };
  next = applyPartyTotals(next, next.hunters.length, mealPackage);

  const bits: string[] = [];
  if (huntYear !== r.huntYear) bits.push(`year ${r.huntYear}→${huntYear}`);
  if (preferredWeek !== r.preferredWeek) bits.push(`week ${r.preferredWeek}→${preferredWeek}`);
  if (mealPackage !== r.mealPackage) bits.push(mealPackage ? 'meals on' : 'meals off');
  if (notes !== r.notes) bits.push('notes updated');
  if (bits.length === 0) return r;

  next = appendHuntEvent(next, 'party_updated', bits.join('; '), null);
  next = { ...next, status: derivePartyStatus(next) };
  return next;
}

export type HunterDetailsPatch = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  state?: string;
};

/** Update contact fields for one hunter. */
export function updateHunterDetails(
  r: HuntReservation,
  hunterIndex: number,
  patch: HunterDetailsPatch
): HuntReservation {
  if (r.status === 'fulfilled' || r.status === 'cancelled') {
    throw new Error('Cannot edit a fulfilled or cancelled party');
  }
  if (hunterIndex < 0 || hunterIndex >= r.hunters.length) throw new Error('Invalid hunterIndex');
  const cur = r.hunters[hunterIndex]!;
  const nextHunter: HuntHunter = {
    firstName: (patch.firstName ?? cur.firstName).trim(),
    lastName: (patch.lastName ?? cur.lastName).trim(),
    email: (patch.email ?? cur.email).trim(),
    phone: (patch.phone ?? cur.phone).trim(),
    state: (patch.state ?? cur.state).trim().toUpperCase(),
  };
  if (!nextHunter.firstName || !nextHunter.lastName) throw new Error('Name is required');
  if (!nextHunter.email.includes('@')) throw new Error('Valid email is required');
  if (!nextHunter.phone) throw new Error('Phone is required');
  if (!/^[A-Z]{2}$/.test(nextHunter.state)) throw new Error('State must be a 2-letter code');

  const unchanged =
    nextHunter.firstName === cur.firstName &&
    nextHunter.lastName === cur.lastName &&
    nextHunter.email === cur.email &&
    nextHunter.phone === cur.phone &&
    nextHunter.state === cur.state;
  if (unchanged) return r;

  const hunters = r.hunters.map((h, i) => (i === hunterIndex ? nextHunter : h));
  let next: HuntReservation = { ...r, hunters };
  next = appendHuntEvent(
    next,
    'hunter_updated',
    `Updated ${nextHunter.firstName} ${nextHunter.lastName}`,
    hunterIndex
  );
  return next;
}

/** Add a hunter to the party and recalculate totals. */
export function addHunterToReservation(r: HuntReservation, hunter: HuntHunter): HuntReservation {
  if (r.status === 'fulfilled' || r.status === 'cancelled') {
    throw new Error('Cannot edit a fulfilled or cancelled party');
  }
  if (r.hunters.length >= 4) {
    throw new Error('Parties may include at most 4 hunters');
  }
  const nextHunter: HuntHunter = {
    firstName: hunter.firstName.trim(),
    lastName: hunter.lastName.trim(),
    email: hunter.email.trim(),
    phone: hunter.phone.trim(),
    state: hunter.state.trim().toUpperCase(),
  };
  if (!nextHunter.firstName || !nextHunter.lastName) throw new Error('Name is required');
  if (!nextHunter.email.includes('@')) throw new Error('Valid email is required');
  if (!nextHunter.phone) throw new Error('Phone is required');
  if (!/^[A-Z]{2}$/.test(nextHunter.state)) throw new Error('State must be a 2-letter code');

  const hunters = [...r.hunters, nextHunter];
  const hunterPayments = [...ensureHunterPayments(r), emptyHunterPayment()];
  let next: HuntReservation = {
    ...r,
    hunters,
    hunterPayments,
  };
  next = applyPartyTotals(next, hunters.length, r.mealPackage);
  next = appendHuntEvent(
    next,
    'hunter_added',
    `Added ${nextHunter.firstName} ${nextHunter.lastName}`,
    hunters.length - 1
  );
  next = { ...next, status: derivePartyStatus(next) };
  return next;
}
