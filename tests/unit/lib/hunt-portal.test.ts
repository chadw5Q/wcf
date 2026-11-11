import { describe, it, expect } from 'vitest';
import { checkoutChargeUsd } from '../../../src/lib/hunt-fees';
import {
  hunterBalanceShareUsd,
  hunterDepositShareUsd,
  hunterPaysNothing,
} from '../../../src/lib/hunt-hunter-shares';
import { createHuntPortalToken, verifyHuntPortalToken } from '../../../src/lib/hunt-portal-token';

describe('hunt fees', () => {
  it('bakes card and ACH fees into checkout totals', () => {
    expect(checkoutChargeUsd(500, 'card')).toBe(515);
    expect(checkoutChargeUsd(2500, 'ach')).toBe(2520);
  });
});

describe('hunter shares', () => {
  const perPerson = { pricingModel: 'per_person' as const, totalDeposit: 1000, balanceDue: 6250 };

  it('per_person: lead pays meals; others lodging-only after deposit', () => {
    const r = { ...perPerson, mealPackage: true, mealPackageCost: 1250 };
    expect(hunterDepositShareUsd(r, 0)).toBe(500);
    expect(hunterDepositShareUsd(r, 1)).toBe(500);
    expect(hunterBalanceShareUsd(r, 0)).toBe(3750); // 2500 + 1250
    expect(hunterBalanceShareUsd(r, 1)).toBe(2500);
    expect(hunterPaysNothing(r, 1)).toBe(false);
  });

  it('per_person: no meals when package false', () => {
    const r = { ...perPerson, mealPackage: false, mealPackageCost: 0 };
    expect(hunterBalanceShareUsd(r, 0)).toBe(2500);
  });

  it('group_flat: lead pays the whole deposit and balance; others pay nothing', () => {
    const r = {
      pricingModel: 'group_flat' as const,
      mealPackage: true,
      mealPackageCost: 0,
      totalDeposit: 2000,
      balanceDue: 7000,
    };
    expect(hunterDepositShareUsd(r, 0)).toBe(2000);
    expect(hunterBalanceShareUsd(r, 0)).toBe(7000);
    expect(hunterDepositShareUsd(r, 2)).toBe(0);
    expect(hunterBalanceShareUsd(r, 2)).toBe(0);
    expect(hunterPaysNothing(r, 0)).toBe(false);
    expect(hunterPaysNothing(r, 2)).toBe(true);
  });
});

describe('portal tokens', () => {
  it('round-trips reservation id and hunter index', async () => {
    const secret = 'test-portal-secret';
    const token = await createHuntPortalToken('res-1', 2, secret);
    const payload = await verifyHuntPortalToken(token, secret);
    expect(payload).toEqual({ reservationId: 'res-1', hunterIndex: 2, exp: expect.any(Number) });
  });

  it('rejects tampered tokens', async () => {
    const secret = 'test-portal-secret';
    const token = await createHuntPortalToken('res-1', 0, secret);
    expect(await verifyHuntPortalToken(token + 'x', secret)).toBeNull();
    expect(await verifyHuntPortalToken(token, 'other')).toBeNull();
  });

  it('accepts percent-encoded tokens from URL path segments', async () => {
    const secret = 'test-portal-secret';
    const token = await createHuntPortalToken('res-1', 0, secret);
    const payload = await verifyHuntPortalToken(encodeURIComponent(token), secret);
    expect(payload).toEqual({ reservationId: 'res-1', hunterIndex: 0, exp: expect.any(Number) });
  });

  it('builds waiver and payment portal paths', async () => {
    const { huntPortalPath, huntPortalPaymentPath } = await import('../../../src/lib/hunt-portal-token');
    const token = '123:abc:0:deadbeef';
    expect(huntPortalPath(token)).toBe(`/hunt/portal/${encodeURIComponent(token)}`);
    expect(huntPortalPaymentPath(token)).toBe(`/hunt/portal/${encodeURIComponent(token)}/payment`);
  });
});
