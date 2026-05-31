import { describe, it, expect } from 'vitest';
import {
  HUNT_RESERVATION_KEY_PREFIX,
  createDraftReservation,
  getReservation,
  parseReservationJson,
  putReservation,
  reservationKvKey,
  serializeReservation,
  validateReservation,
  type HuntReservation,
} from '../../../src/lib/hunt-reservations';

function sampleHunter(over: Partial<{ firstName: string }> = {}) {
  return {
    firstName: 'Pat',
    lastName: 'Hunter',
    email: 'pat@example.com',
    phone: '555-0100',
    state: 'IA',
    ...over,
  };
}

function sampleReservation(over: Partial<HuntReservation> = {}): HuntReservation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2027-01-15T12:00:00.000Z',
    status: 'draft',
    huntYear: 2027,
    preferredWeek: 'w2',
    mealPackage: true,
    hunters: [sampleHunter(), sampleHunter({ firstName: 'Kim', email: 'kim@example.com' })],
    hunterCount: 2,
    huntCostPerPerson: 3000,
    mealPackageCost: 1000,
    totalHuntCost: 7000,
    depositPerPerson: 500,
    totalDeposit: 1000,
    balanceDue: 6000,
    stripeDepositSessionId: '',
    stripeBalanceSessionId: null,
    notes: null,
    ...over,
  };
}

function createMemoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

describe('validateReservation', () => {
  it('accepts a valid reservation', () => {
    const r = sampleReservation();
    const v = validateReservation(r);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.id).toBe(r.id);
  });

  it('rejects empty hunters array', () => {
    const r = sampleReservation({ hunters: [], hunterCount: 0 });
    const v = validateReservation(r);
    expect(v.ok).toBe(false);
  });

  it('rejects hunterCount mismatch', () => {
    const r = sampleReservation({ hunterCount: 99 });
    const v = validateReservation(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain('hunterCount');
  });

  it('rejects invalid status', () => {
    const r = { ...sampleReservation(), status: 'paid_in_full' };
    const v = validateReservation(r);
    expect(v.ok).toBe(false);
  });

  it('accepts all PRD statuses plus draft', () => {
    for (const status of ['draft', 'deposit_paid', 'confirmed', 'balance_paid', 'fulfilled', 'cancelled'] as const) {
      const v = validateReservation({ ...sampleReservation(), status });
      expect(v.ok).toBe(true);
    }
  });

  it('normalizes optional nulls for stripeBalanceSessionId and notes', () => {
    const raw = {
      ...sampleReservation(),
      stripeBalanceSessionId: null,
      notes: null,
    };
    const v = validateReservation(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.stripeBalanceSessionId).toBeNull();
      expect(v.value.notes).toBeNull();
    }
  });

  it('accepts optional string fields', () => {
    const v = validateReservation({
      ...sampleReservation(),
      stripeBalanceSessionId: 'cs_balance_123',
      notes: 'Need ground blind.',
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.stripeBalanceSessionId).toBe('cs_balance_123');
      expect(v.value.notes).toBe('Need ground blind.');
    }
  });

  it('rejects more than 4 hunters', () => {
    const hunters = [sampleHunter(), sampleHunter({ email: 'a2@e.com' }), sampleHunter({ email: 'a3@e.com' }), sampleHunter({ email: 'a4@e.com' }), sampleHunter({ email: 'a5@e.com' })];
    const v = validateReservation({
      ...sampleReservation(),
      hunters,
      hunterCount: 5,
    });
    expect(v.ok).toBe(false);
  });
});

describe('serializeReservation / parseReservationJson', () => {
  it('roundtrips preserving shape', () => {
    const r = sampleReservation({
      stripeBalanceSessionId: null,
      notes: 'Hello',
      stripeDepositSessionId: 'cs_test_abc',
    });
    const json = serializeReservation(r);
    const back = parseReservationJson(json);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value).toEqual(r);
    }
  });

  it('parses JSON with omitted optional keys as nulls where applicable', () => {
    const minimal = {
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: '2027-02-01T00:00:00.000Z',
      status: 'deposit_paid',
      huntYear: 2028,
      preferredWeek: 'w1',
      mealPackage: false,
      hunters: [sampleHunter()],
      hunterCount: 1,
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
      stripeDepositSessionId: 'cs_dep',
    };
    const v = validateReservation(minimal);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.stripeBalanceSessionId).toBeNull();
      expect(v.value.notes).toBeNull();
      const json = serializeReservation(v.value);
      const again = parseReservationJson(json);
      expect(again.ok).toBe(true);
    }
  });
});

describe('KV helpers', () => {
  it('uses reservation:{id} key pattern', () => {
    expect(reservationKvKey('abc')).toBe(`${HUNT_RESERVATION_KEY_PREFIX}abc`);
  });

  it('putReservation + getReservation roundtrip on mock KV', async () => {
    const kv = createMemoryKv();
    const r = sampleReservation({ id: '33333333-3333-4333-8333-333333333333' });
    await putReservation(kv, r);
    const got = await getReservation(kv, r.id);
    expect(got).toEqual(r);
  });

  it('getReservation returns null for missing key', async () => {
    const kv = createMemoryKv();
    expect(await getReservation(kv, 'missing-id')).toBeNull();
  });

  it('getReservation returns null for corrupt JSON', async () => {
    const kv = createMemoryKv();
    await kv.put(reservationKvKey('bad'), '{ not json');
    expect(await getReservation(kv, 'bad')).toBeNull();
  });
});

describe('createDraftReservation', () => {
  it('creates a draft with new id and ISO createdAt', () => {
    const r = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [sampleHunter()],
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
    });
    expect(r.status).toBe('draft');
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.hunterCount).toBe(1);
    expect(r.stripeDepositSessionId).toBe('');
    expect(r.stripeBalanceSessionId).toBeNull();
    expect(r.notes).toBeNull();
  });

  it('persists via mock KV without Stripe', async () => {
    const kv = createMemoryKv();
    const r = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: true,
      hunters: [sampleHunter(), sampleHunter({ firstName: 'Alex', email: 'alex@example.com' })],
      huntCostPerPerson: 3000,
      mealPackageCost: 1000,
      totalHuntCost: 7000,
      depositPerPerson: 500,
      totalDeposit: 1000,
      balanceDue: 6000,
      notes: 'Test',
    });
    await putReservation(kv, r);
    const got = await getReservation(kv, r.id);
    expect(got?.notes).toBe('Test');
    expect(got?.status).toBe('draft');
  });
});
