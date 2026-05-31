import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createHuntSessionToken,
  verifyHuntSessionToken,
  verifyHuntPassword,
  HUNT_LOGIN_ERROR_MESSAGE,
} from '../../../src/lib/hunt-auth';

describe('hunt-auth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports the PRD login error copy', () => {
    expect(HUNT_LOGIN_ERROR_MESSAGE).toBe(
      'Incorrect password. Please try again or contact Chad at 712-254-3999.'
    );
  });

  it('verifyHuntPassword accepts exact match', () => {
    expect(verifyHuntPassword('secret', 'secret')).toBe(true);
    expect(verifyHuntPassword('secret', 'other')).toBe(false);
    expect(verifyHuntPassword('', 'secret')).toBe(false);
  });

  it('createHuntSessionToken + verifyHuntSessionToken roundtrip', async () => {
    const secret = 'unit-test-hunt-secret';
    const token = await createHuntSessionToken(secret);
    expect(await verifyHuntSessionToken(token, secret)).toBe(true);
  });

  it('rejects verification with wrong secret', async () => {
    const token = await createHuntSessionToken('secret-a');
    expect(await verifyHuntSessionToken(token, 'secret-b')).toBe(false);
  });

  it('rejects tampered signature', async () => {
    const token = await createHuntSessionToken('secret');
    const parts = token.split(':');
    expect(parts.length).toBe(2);
    const sig = parts[1];
    const last = sig.slice(-1);
    const flip = last === '0' ? '1' : '0';
    const tampered = `${parts[0]}:${sig.slice(0, -1)}${flip}`;
    expect(await verifyHuntSessionToken(tampered, 'secret')).toBe(false);
  });

  it('rejects expired token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    const token = await createHuntSessionToken('secret');
    vi.setSystemTime(new Date('2020-02-01T00:00:00Z'));
    expect(await verifyHuntSessionToken(token, 'secret')).toBe(false);
  });

  it('rejects malformed token', async () => {
    expect(await verifyHuntSessionToken(undefined, 's')).toBe(false);
    expect(await verifyHuntSessionToken('nocolon', 's')).toBe(false);
    expect(await verifyHuntSessionToken('abc:short', 's')).toBe(false);
  });
});
