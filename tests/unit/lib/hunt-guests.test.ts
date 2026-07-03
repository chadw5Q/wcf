import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import {
  findHuntGuestByPassword,
  getHuntGuestBySlug,
  getHuntGuestPassword,
  HUNT_GUESTS,
} from '../../../src/lib/hunt-guests';
import { createHuntGuestToken, verifyHuntGuestToken } from '../../../src/lib/hunt-auth';

const allen = HUNT_GUESTS[0];

describe('hunt guests', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
  });

  it('registers Allen Wright with his landing page', () => {
    expect(getHuntGuestBySlug('allen-wright')).toMatchObject({
      name: 'Allen Wright',
      landingPath: '/hunt/guest/allen-wright',
      passwordEnv: 'HUNT_GUEST_ALLEN_PASSWORD',
    });
  });

  it('prefers the env password over the dev default', () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'HUNT_GUEST_ALLEN_PASSWORD' ? 'ProdSecret123' : undefined
    );
    expect(getHuntGuestPassword(allen)).toBe('ProdSecret123');
    expect(findHuntGuestByPassword('ProdSecret123')?.slug).toBe('allen-wright');
    expect(findHuntGuestByPassword(allen.devDefaultPassword)).toBeUndefined();
  });

  it('falls back to the dev default password in dev/test', () => {
    expect(getHuntGuestPassword(allen)).toBe(allen.devDefaultPassword);
    expect(findHuntGuestByPassword(allen.devDefaultPassword)?.slug).toBe('allen-wright');
  });

  it('rejects wrong or empty passwords', () => {
    expect(findHuntGuestByPassword('nope')).toBeUndefined();
    expect(findHuntGuestByPassword('')).toBeUndefined();
  });
});

describe('hunt guest token', () => {
  const secret = 'test-secret';

  it('round-trips a valid guest slug', async () => {
    const token = await createHuntGuestToken(secret, 'allen-wright');
    await expect(verifyHuntGuestToken(token, secret)).resolves.toBe('allen-wright');
  });

  it('rejects a tampered slug', async () => {
    const token = await createHuntGuestToken(secret, 'allen-wright');
    const [exp, , sig] = token.split(':');
    await expect(verifyHuntGuestToken(`${exp}:other-guest:${sig}`, secret)).resolves.toBeNull();
  });

  it('rejects the wrong secret and malformed tokens', async () => {
    const token = await createHuntGuestToken(secret, 'allen-wright');
    await expect(verifyHuntGuestToken(token, 'other-secret')).resolves.toBeNull();
    await expect(verifyHuntGuestToken('garbage', secret)).resolves.toBeNull();
    await expect(verifyHuntGuestToken(undefined, secret)).resolves.toBeNull();
  });
});
