import type { APIRoute } from 'astro';
import {
  createHuntSessionToken,
  getHuntPassword,
  getHuntSessionSigningSecret,
  HUNT_SESSION_COOKIE,
  huntSessionCookieOptions,
  safeHuntReturnParam,
  verifyHuntPassword,
} from '../../lib/hunt-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const configuredPassword = getHuntPassword();
  if (!configuredPassword) {
    return new Response(
      JSON.stringify({
        error: 'Hunt login is not configured',
        details: 'Set HUNT_PASSWORD in the environment (see .env.example).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const secret = getHuntSessionSigningSecret();
  if (!secret) {
    return new Response(
      JSON.stringify({
        error: 'Hunt session signing is not configured',
        details: 'Set HUNT_SESSION_SECRET or HUNT_PASSWORD.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { password?: string; return?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const plain = String(body.password ?? '');
  if (!verifyHuntPassword(plain, configuredPassword)) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = await createHuntSessionToken(secret);
  cookies.set(HUNT_SESSION_COOKIE, token, huntSessionCookieOptions());

  const next = safeHuntReturnParam(body.return);

  return new Response(JSON.stringify({ success: true, redirect: next }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
