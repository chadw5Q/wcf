/**
 * Williams Creek Whitetails hunt reservations in Cloudflare KV (`HUNT_KV`).
 * Shape matches PRD **Reservation Data Structure**; `draft` is allowed before checkout (Phase 4–5).
 */

/** PRD statuses plus `draft` for records created before Stripe deposit completes. */
export type HuntReservationStatus =
  | 'draft'
  | 'deposit_paid'
  | 'confirmed'
  | 'balance_paid'
  | 'fulfilled'
  | 'cancelled';

export const HUNT_RESERVATION_STATUSES: readonly HuntReservationStatus[] = [
  'draft',
  'deposit_paid',
  'confirmed',
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
};

export const HUNT_RESERVATION_KEY_PREFIX = 'reservation:';

export function reservationKvKey(id: string): string {
  return `${HUNT_RESERVATION_KEY_PREFIX}${id}`;
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

export type ValidateReservationResult =
  | { ok: true; value: HuntReservation }
  | { ok: false; error: string };

/**
 * Parse and validate a reservation object (e.g. after `JSON.parse` from KV).
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
  };

  return { ok: true, value };
}

/** Stable JSON for KV (optional fields normalized to `null`). */
export function serializeReservation(r: HuntReservation): string {
  const normalized: HuntReservation = {
    ...r,
    stripeBalanceSessionId: r.stripeBalanceSessionId ?? null,
    notes: r.notes ?? null,
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
    if (r.status !== 'deposit_paid' && r.status !== 'confirmed') continue;
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
  };
  const v = validateReservation(r);
  if (!v.ok) throw new Error(v.error);
  return v.value;
}
