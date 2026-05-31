import { finalPaymentHuntYears } from './hunt-final-balance';

export type HuntBalanceRequestBody = {
  firstName: string;
  lastName: string;
  email: string;
  huntYear: number;
  hunterCount: number;
  mealPackage: boolean;
  /** Whole USD dollars (e.g. 2500.00); must match stored `balanceDue` on the matched reservation. */
  paymentAmount: number;
};

export type ParseHuntBalanceBodyResult =
  | { ok: true; value: HuntBalanceRequestBody }
  | { ok: false; error: string; status: number };

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function parseHuntBalanceRequestBody(raw: unknown): ParseHuntBalanceBodyResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object', status: 400 };
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.firstName !== 'string' || !normalizeName(o.firstName)) {
    return { ok: false, error: 'firstName is required', status: 400 };
  }
  if (typeof o.lastName !== 'string' || !normalizeName(o.lastName)) {
    return { ok: false, error: 'lastName is required', status: 400 };
  }
  if (typeof o.email !== 'string' || !o.email.trim()) {
    return { ok: false, error: 'email is required', status: 400 };
  }
  const email = o.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Invalid email address', status: 400 };
  }

  if (typeof o.huntYear !== 'number' || !Number.isInteger(o.huntYear)) {
    return { ok: false, error: 'huntYear must be an integer', status: 400 };
  }

  if (typeof o.hunterCount !== 'number' || !Number.isInteger(o.hunterCount)) {
    return { ok: false, error: 'hunterCount must be an integer', status: 400 };
  }
  if (o.hunterCount < 1 || o.hunterCount > 4) {
    return { ok: false, error: 'hunterCount must be between 1 and 4', status: 400 };
  }

  if (typeof o.mealPackage !== 'boolean') {
    return { ok: false, error: 'mealPackage must be boolean', status: 400 };
  }

  if (typeof o.paymentAmount !== 'number' || !Number.isFinite(o.paymentAmount)) {
    return { ok: false, error: 'paymentAmount must be a finite number', status: 400 };
  }
  if (o.paymentAmount < 0.5) {
    return { ok: false, error: 'paymentAmount must be at least $0.50', status: 400 };
  }

  const allowedYears = new Set(finalPaymentHuntYears());
  if (!allowedYears.has(o.huntYear)) {
    return { ok: false, error: 'huntYear is not an allowed selection', status: 400 };
  }

  return {
    ok: true,
    value: {
      firstName: normalizeName(o.firstName),
      lastName: normalizeName(o.lastName),
      email,
      huntYear: o.huntYear,
      hunterCount: o.hunterCount,
      mealPackage: o.mealPackage,
      paymentAmount: o.paymentAmount,
    },
  };
}
