import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/hunt-login';

// In vitest import.meta.env.DEV is true, so the dev fallbacks apply:
// master password `HuntIowa2026`, Allen's guest password `AllenGun2026`.

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/hunt-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockCookies() {
  return { set: vi.fn() };
}

async function login(body: unknown) {
  const cookies = mockCookies();
  const res = await POST({
    request: jsonRequest(body),
    cookies,
  } as unknown as Parameters<typeof POST>[0]);
  return { res, cookies };
}

describe('POST /api/hunt-login', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
  });

  it('master password logs in and redirects to /hunt', async () => {
    const { res, cookies } = await login({ password: 'HuntIowa2026' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { redirect?: string };
    expect(data.redirect).toBe('/hunt');
    const names = cookies.set.mock.calls.map((c) => c[0]);
    expect(names).toContain('hunt_session');
    expect(names).not.toContain('hunt_guest');
  });

  it("Allen's guest password redirects to his page and sets the guest cookie", async () => {
    const { res, cookies } = await login({ password: 'AllenGun2026', return: '/hunt/reserve' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { redirect?: string };
    expect(data.redirect).toBe('/hunt/guest/allen-wright');
    const names = cookies.set.mock.calls.map((c) => c[0]);
    expect(names).toContain('hunt_session');
    expect(names).toContain('hunt_guest');
  });

  it('rejects a wrong password with 401 and no cookies', async () => {
    const { res, cookies } = await login({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect(cookies.set).not.toHaveBeenCalled();
  });
});
