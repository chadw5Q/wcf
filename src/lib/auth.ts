import { getServerEnv } from './server-env';

export const ADMIN_SESSION_COOKIE = 'admin_session';
const SESSION_DAYS = 7;

export function getSessionSigningSecret(): string | undefined {
  const a = getServerEnv('ADMIN_SESSION_SECRET')?.trim();
  if (a) return a;
  return getServerEnv('ADMIN_PASSWORD')?.trim();
}

export function getAdminPassword(): string | undefined {
  return getServerEnv('ADMIN_PASSWORD')?.trim();
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

/** Create signed session token: expUnix:hexSig */
export async function createAdminSessionToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = String(exp);
  const sig = await hmacHex(secret, payload);
  return `${payload}:${sig}`;
}

export async function verifyAdminSessionToken(token: string | undefined, secret: string): Promise<boolean> {
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

export function verifyAdminPassword(plain: string, stored: string | undefined): boolean {
  if (!stored || !plain) return false;
  return timingSafeEqualStr(plain, stored);
}
