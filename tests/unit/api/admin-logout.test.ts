import { describe, it, expect, vi } from 'vitest';
import { POST } from '../../../src/pages/api/admin/logout';
import { ADMIN_SESSION_COOKIE } from '../../../src/lib/auth';

describe('POST /api/admin/logout', () => {
  it('clears the admin cookie and redirects to the login page', async () => {
    const del = vi.fn();
    const res = await POST({
      cookies: { delete: del },
      redirect: (to: string, status: number) =>
        new Response(null, { status, headers: { Location: to } }),
    } as unknown as Parameters<typeof POST>[0]);
    expect(del).toHaveBeenCalledWith(ADMIN_SESSION_COOKIE, { path: '/' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/login');
  });
});
