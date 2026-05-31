import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/hunt-deposit-email', () => ({
  sendHuntDepositConfirmationEmails: vi.fn().mockResolvedValue(undefined),
  notifyChadNewHuntReservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/hunt-balance-email', () => ({
  sendHuntBalanceConfirmationEmails: vi.fn().mockResolvedValue(undefined),
}));

import { sendHuntBalanceConfirmationEmails } from '../../../src/lib/hunt-balance-email';
import { sendHuntDepositConfirmationEmails, notifyChadNewHuntReservation } from '../../../src/lib/hunt-deposit-email';
import { handleHuntCheckoutSessionCompleted } from '../../../src/lib/hunt-stripe-webhook';
import { createDraftReservation, getReservation, putReservation } from '../../../src/lib/hunt-reservations';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function sessionStub(over: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_session',
    payment_status: 'paid',
    metadata: {
      hunt_checkout_kind: 'deposit',
      reservation_id: 'will-be-replaced',
    },
    ...over,
  } as import('stripe').Stripe.Checkout.Session;
}

describe('handleHuntCheckoutSessionCompleted', () => {
  beforeEach(() => {
    vi.mocked(sendHuntDepositConfirmationEmails).mockClear();
    vi.mocked(notifyChadNewHuntReservation).mockClear();
    vi.mocked(sendHuntBalanceConfirmationEmails).mockClear();
  });

  it('balance checkout with unknown reservation is not handled', async () => {
    const kv = memoryKv();
    const s = sessionStub({
      metadata: { hunt_checkout_kind: 'balance', reservation_id: '00000000-0000-0000-0000-000000000000' },
    });
    const r = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(r).toEqual({ handled: false, detail: 'reservation_not_found' });
    expect(sendHuntBalanceConfirmationEmails).not.toHaveBeenCalled();
  });

  it('unknown hunt_checkout_kind is ignored', async () => {
    const kv = memoryKv();
    const s = sessionStub({ metadata: { hunt_checkout_kind: 'other', reservation_id: 'x' } });
    const r = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(r).toEqual({ handled: false, detail: 'not_hunt_checkout' });
  });

  it('updates draft reservation to deposit_paid and sends emails once', async () => {
    const kv = memoryKv();
    const res = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [
        {
          firstName: 'A',
          lastName: 'B',
          email: 'a@example.com',
          phone: '7125550100',
          state: 'IA',
        },
      ],
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
      notes: null,
    });
    await putReservation(kv, res);

    const s = sessionStub({
      metadata: { hunt_checkout_kind: 'deposit', reservation_id: res.id },
    });

    const first = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(first).toEqual({ handled: true, detail: 'deposit_confirmed' });

    const stored = await getReservation(kv, res.id);
    expect(stored?.status).toBe('deposit_paid');
    expect(stored?.stripeDepositSessionId).toBe('cs_test_session');
    expect(sendHuntDepositConfirmationEmails).toHaveBeenCalledTimes(1);

    const second = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(second).toEqual({ handled: true, detail: 'idempotent_already_deposit_paid' });
    expect(sendHuntDepositConfirmationEmails).toHaveBeenCalledTimes(1);
  });

  it('updates deposit_paid reservation to balance_paid and sends balance emails once', async () => {
    const kv = memoryKv();
    let res = createDraftReservation({
      huntYear: 2027,
      preferredWeek: 'w2',
      mealPackage: false,
      hunters: [
        {
          firstName: 'A',
          lastName: 'B',
          email: 'a@example.com',
          phone: '7125550100',
          state: 'IA',
        },
      ],
      huntCostPerPerson: 3000,
      mealPackageCost: 0,
      totalHuntCost: 3000,
      depositPerPerson: 500,
      totalDeposit: 500,
      balanceDue: 2500,
      notes: null,
    });
    res = { ...res, status: 'deposit_paid', stripeDepositSessionId: 'cs_dep' };
    await putReservation(kv, res);

    const s = sessionStub({
      id: 'cs_balance_session',
      metadata: { hunt_checkout_kind: 'balance', reservation_id: res.id },
    });

    const first = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(first).toEqual({ handled: true, detail: 'balance_confirmed' });
    const stored = await getReservation(kv, res.id);
    expect(stored?.status).toBe('balance_paid');
    expect(stored?.stripeBalanceSessionId).toBe('cs_balance_session');
    expect(sendHuntBalanceConfirmationEmails).toHaveBeenCalledTimes(1);

    const second = await handleHuntCheckoutSessionCompleted(s, kv);
    expect(second).toEqual({ handled: true, detail: 'idempotent_already_balance_paid' });
    expect(sendHuntBalanceConfirmationEmails).toHaveBeenCalledTimes(1);
  });
});
