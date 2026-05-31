import { describe, it, expect } from 'vitest';
import { safeHuntReturnParam } from '../../../src/lib/hunt-auth';

describe('safeHuntReturnParam', () => {
  it('defaults to /hunt', () => {
    expect(safeHuntReturnParam(undefined)).toBe('/hunt');
    expect(safeHuntReturnParam('')).toBe('/hunt');
    expect(safeHuntReturnParam('   ')).toBe('/hunt');
  });

  it('allows same-origin /hunt paths', () => {
    expect(safeHuntReturnParam('/hunt/reserve')).toBe('/hunt/reserve');
    expect(safeHuntReturnParam('/hunt/reserve?x=1')).toBe('/hunt/reserve?x=1');
  });

  it('blocks open redirects', () => {
    expect(safeHuntReturnParam('//evil.com/hunt')).toBe('/hunt');
    expect(safeHuntReturnParam('https://evil.com/hunt')).toBe('/hunt');
    expect(safeHuntReturnParam('/hedge')).toBe('/hunt');
    expect(safeHuntReturnParam('/hunt/../admin')).toBe('/hunt');
  });

  it('does not return to login as post-login landing', () => {
    expect(safeHuntReturnParam('/hunt/login')).toBe('/hunt');
    expect(safeHuntReturnParam('/hunt/login?x=1')).toBe('/hunt');
  });
});
