import { describe, it, expect } from 'vitest';
import { checkoutChargeUsd } from '../../../src/lib/hunt-fees';
import { hunterBalanceShareUsd, hunterDepositShareUsd } from '../../../src/lib/hunt-hunter-shares';
import { createHuntPortalToken, verifyHuntPortalToken } from '../../../src/lib/hunt-portal-token';

describe('hunt fees', () => {
  it('bakes card and ACH fees into checkout totals', () => {
    expect(checkoutChargeUsd(500, 'card')).toBe(515);
    expect(checkoutChargeUsd(2500, 'ach')).toBe(2520);
  });
});

describe('hunter shares', () => {
  it('lead pays meals; others lodging-only after deposit', () => {
    const r = { mealPackage: true, mealPackageCost: 1250 };
    expect(hunterDepositShareUsd()).toBe(500);
    expect(hunterBalanceShareUsd(r, 0)).toBe(3750); // 2500 + 1250
    expect(hunterBalanceShareUsd(r, 1)).toBe(2500);
  });

  it('no meals when package false', () => {
    const r = { mealPackage: false, mealPackageCost: 0 };
    expect(hunterBalanceShareUsd(r, 0)).toBe(2500);
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
