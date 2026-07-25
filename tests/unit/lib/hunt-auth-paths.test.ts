import { describe, it, expect } from 'vitest';
import { requiresHuntSession } from '../../../src/lib/hunt-auth';

describe('requiresHuntSession', () => {
  it('is false for /hunt/login and trailing slash variant', () => {
    expect(requiresHuntSession('/hunt/login')).toBe(false);
    expect(requiresHuntSession('/hunt/login/')).toBe(false);
  });

  it('is true for other /hunt paths', () => {
    expect(requiresHuntSession('/hunt')).toBe(true);
    expect(requiresHuntSession('/hunt/')).toBe(true);
    expect(requiresHuntSession('/hunt/reserve')).toBe(true);
    expect(requiresHuntSession('/hunt/reserve/')).toBe(true);
    expect(requiresHuntSession('/hunt/final-payment')).toBe(true);
    expect(requiresHuntSession('/hunt/final-payment/confirmed')).toBe(true);
  });

  it('is false for guest portal and Know Before You Go', () => {
    expect(requiresHuntSession('/hunt/portal')).toBe(false);
    expect(requiresHuntSession('/hunt/portal/abc')).toBe(false);
    expect(requiresHuntSession('/hunt/portal/abc/payment')).toBe(false);
    expect(requiresHuntSession('/hunt/know-before-you-go')).toBe(false);
    expect(requiresHuntSession('/hunt/know-before-you-go/')).toBe(false);
  });

  it('is false outside /hunt', () => {
    expect(requiresHuntSession('/')).toBe(false);
    expect(requiresHuntSession('/admin')).toBe(false);
    expect(requiresHuntSession('/api/hunt-login')).toBe(false);
    expect(requiresHuntSession('/api/hunt-logout')).toBe(false);
    expect(requiresHuntSession('/api/hunt-reserve')).toBe(false);
    expect(requiresHuntSession('/api/hunt-balance')).toBe(false);
    expect(requiresHuntSession('/api/webhooks/stripe-hunt')).toBe(false);
    expect(requiresHuntSession('/contact')).toBe(false);
  });

  it('is false for typos that are not under /hunt', () => {
    expect(requiresHuntSession('/hunter')).toBe(false);
  });
});
