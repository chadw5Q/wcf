import { getServerEnv } from './server-env';

export const HUNT_SESSION_COOKIE = 'hunt_session';

const SESSION_DAYS = 7;

/** PRD error copy — must match exactly for login UI. */
export const HUNT_LOGIN_ERROR_MESSAGE =
  'Incorrect password. Please try again or contact Chad at 712-254-3999.';

/**
 * Single shared password for `/hunt` (Cloudflare / `.env`: `HUNT_PASSWORD`).
 * In local dev, defaults to PRD example if unset so the shell works out of the box.
 */
export function getHuntPassword(): string | undefined {
  const p = getServerEnv('HUNT_PASSWORD')?.trim();
  if (p) return p;
  try {
    if (import.meta.env.DEV) return 'HuntIowa2026';
  } catch {
    /* import.meta unavailable in some tests */
  }
  return undefined;
}

/**
 * HMAC signing secret for `hunt_session`. Prefer `HUNT_SESSION_SECRET`; else `HUNT_PASSWORD`.
 */
export function getHuntSessionSigningSecret(): string | undefined {
  const s = getServerEnv('HUNT_SESSION_SECRET')?.trim();
  if (s) return s;
  return getHuntPassword();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Signed session token: `expUnix:hexSig` (same shape as admin session). */
export async function createHuntSessionToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = String(exp);
  const sig = await hmacHex(secret, payload);
  return `${payload}:${sig}`;
}

export async function verifyHuntSessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const idx = token.lastIndexOf(':');
  if (idx <= 0) return false;
  const expStr = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(secret, expStr);
  return timingSafeEqualStr(sig.toLowerCase(), expected.toLowerCase());
}

export function verifyHuntPassword(plain: string, stored: string | undefined): boolean {
  if (!stored || !plain) return false;
  return timingSafeEqualStr(plain, stored);
}

export const HUNT_GUEST_COOKIE = 'hunt_guest';

/** Signed guest token: `expUnix:slug:hexSig` (sig over `expUnix:slug`). */
export async function createHuntGuestToken(secret: string, slug: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = `${exp}:${slug}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}:${sig}`;
}

/** Returns the guest slug when the token is valid and unexpired, else null. */
export async function verifyHuntGuestToken(
  token: string | undefined,
  secret: string
): Promise<string | null> {
  if (!token || !secret) return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [expStr, slug, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  if (!slug) return null;
  const expected = await hmacHex(secret, `${expStr}:${slug}`);
  return timingSafeEqualStr(sig.toLowerCase(), expected.toLowerCase()) ? slug : null;
}

/**
 * Paths that require a valid `hunt_session` cookie (middleware).
 * `/hunt/login` and everything outside `/hunt` are false.
 */
export function requiresHuntSession(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (!p.startsWith('/hunt')) return false;
  if (p.length > 5 && p[5] !== '/') return false; // e.g. `/hunter`, not `/hunt` or `/hunt/...`
  if (p === '/hunt/login') return false;
  // Tokenized guest portal + public Know Before You Go (linked from portal email)
  if (p === '/hunt/know-before-you-go' || p.startsWith('/hunt/know-before-you-go/')) return false;
  if (p === '/hunt/portal' || p.startsWith('/hunt/portal/')) return false;
  return true;
}

const MAX_RETURN_LEN = 256;

/**
 * Only allow same-origin relative returns under `/hunt` (open-redirect safe).
 * Resolves `.` / `..` via the URL parser so `/hunt/../admin` cannot escape.
 */
export function safeHuntReturnParam(raw: string | null | undefined): string {
  if (raw == null || raw === '') return '/hunt';
  const s = raw.trim();
  if (s.length > MAX_RETURN_LEN) return '/hunt';
  if (s.startsWith('//') || s.includes('://')) return '/hunt';
  try {
    const url = new URL(s, 'https://williamscreekfarms.com');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/hunt/login') return '/hunt';
    if (!path.startsWith('/hunt')) return '/hunt';
    return url.pathname + url.search;
  } catch {
    return '/hunt';
  }
}

export const HUNT_SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 3600;

export function huntSessionCookieOptions(): {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  maxAge: number;
} {
  return {
    path: '/hunt',
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    maxAge: HUNT_SESSION_MAX_AGE_SEC,
  };
}
