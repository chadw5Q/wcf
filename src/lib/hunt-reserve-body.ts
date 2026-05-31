import { allowedHuntReserveYears, isPreferredWeekAvailable } from './hunt-weeks';
import type { HuntHunter } from './hunt-reservations';
import { US_STATES } from './us-states';

export type HuntReserveRequestBody = {
  hunters: HuntHunter[];
  huntYear: number;
  preferredWeek: string;
  mealPackage: boolean;
  notes: string | null;
};

const US_CODES = new Set(US_STATES.map((s) => s.code));

function isHunterShape(v: unknown): v is HuntHunter {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const str = (k: string) => typeof o[k] === 'string' && String(o[k]).trim().length > 0;
  if (!str('firstName') || !str('lastName') || !str('email') || !str('phone')) return false;
  if (!str('state')) return false;
  const st = String(o.state).trim().toUpperCase();
  if (st.length !== 2 || !US_CODES.has(st)) return false;
  const email = String(o.email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return true;
}

function normalizeHunter(v: HuntHunter): HuntHunter {
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: v.email.trim().toLowerCase(),
    phone: v.phone.trim(),
    state: v.state.trim().toUpperCase(),
  };
}

export type ParseHuntReserveBodyResult =
  | { ok: true; value: HuntReserveRequestBody }
  | { ok: false; error: string; status: number };

export function parseHuntReserveRequestBody(raw: unknown): ParseHuntReserveBodyResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object', status: 400 };
  }
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.hunters)) {
    return { ok: false, error: 'hunters must be an array', status: 400 };
  }
  if (o.hunters.length < 1 || o.hunters.length > 4) {
    return { ok: false, error: 'hunters must include 1 to 4 entries', status: 400 };
  }
  const hunters: HuntHunter[] = [];
  for (let i = 0; i < o.hunters.length; i++) {
    if (!isHunterShape(o.hunters[i])) {
      return { ok: false, error: `Invalid hunter at index ${i}`, status: 400 };
    }
    hunters.push(normalizeHunter(o.hunters[i] as HuntHunter));
  }

  if (typeof o.huntYear !== 'number' || !Number.isInteger(o.huntYear)) {
    return { ok: false, error: 'huntYear must be an integer', status: 400 };
  }
  const allowedYears = new Set(allowedHuntReserveYears());
  if (!allowedYears.has(o.huntYear)) {
    return { ok: false, error: 'huntYear is not an allowed selection', status: 400 };
  }

  if (typeof o.preferredWeek !== 'string' || !o.preferredWeek.trim()) {
    return { ok: false, error: 'preferredWeek is required', status: 400 };
  }
  const preferredWeek = o.preferredWeek.trim();
  if (!isPreferredWeekAvailable(o.huntYear, preferredWeek)) {
    return { ok: false, error: 'Selected week is not available', status: 400 };
  }

  if (typeof o.mealPackage !== 'boolean') {
    return { ok: false, error: 'mealPackage must be boolean', status: 400 };
  }

  let notes: string | null = null;
  if (o.notes !== undefined && o.notes !== null) {
    if (typeof o.notes !== 'string') {
      return { ok: false, error: 'notes must be a string or null', status: 400 };
    }
    const t = o.notes.trim();
    notes = t.length ? t : null;
  }

  return {
    ok: true,
    value: {
      hunters,
      huntYear: o.huntYear,
      preferredWeek,
      mealPackage: o.mealPackage,
      notes,
    },
  };
}
