import type { APIRoute } from 'astro';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminPassword,
  getSessionSigningSecret,
  verifyAdminPassword,
} from '../../../lib/auth';

export const prerender = false;

const MAX_AGE_SEC = 7 * 24 * 3600;

export const POST: APIRoute = async ({ request, cookies }) => {
  const configuredPassword = getAdminPassword();
  if (!configuredPassword) {
    return new Response(
      JSON.stringify({
        error: 'Admin login is not configured',
        details: 'Set ADMIN_PASSWORD (and optionally ADMIN_SESSION_SECRET) in the environment.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const secret = getSessionSigningSecret();
  if (!secret) {
    return new Response(
      JSON.stringify({
        error: 'Session signing is not configured',
        details: 'Set ADMIN_SESSION_SECRET or ADMIN_PASSWORD.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const plain = String(body.password ?? '');
  if (!verifyAdminPassword(plain, configuredPassword)) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await createAdminSessionToken(secret);
  cookies.set(ADMIN_SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    maxAge: MAX_AGE_SEC,
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
