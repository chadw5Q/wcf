import { defineMiddleware } from 'astro:middleware';
import {
  ADMIN_SESSION_COOKIE,
  getSessionSigningSecret,
  verifyAdminSessionToken,
} from './lib/auth';
import {
  HUNT_SESSION_COOKIE,
  getHuntSessionSigningSecret,
  requiresHuntSession,
  verifyHuntSessionToken,
} from './lib/hunt-auth';

function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = normalizePath(context.url.pathname);

  if (
    path === '/admin/login' ||
    path === '/api/admin/login' ||
    path === '/api/admin/logout'
  ) {
    return next();
  }

  if (path.startsWith('/admin')) {
    const secret = getSessionSigningSecret();
    const token = context.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!secret || !(await verifyAdminSessionToken(token, secret))) {
      return context.redirect('/admin/login');
    }
  }

  if (path.startsWith('/api/admin/')) {
    const secret = getSessionSigningSecret();
    const token = context.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!secret || !(await verifyAdminSessionToken(token, secret))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (requiresHuntSession(path)) {
    const huntSecret = getHuntSessionSigningSecret();
    const huntToken = context.cookies.get(HUNT_SESSION_COOKIE)?.value;
    if (!huntSecret || !(await verifyHuntSessionToken(huntToken, huntSecret))) {
      const login = new URL('/hunt/login', context.url);
      login.searchParams.set('return', path + context.url.search);
      return context.redirect(login.pathname + login.search);
    }
  }

  return next();
});
