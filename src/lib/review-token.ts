import { getServerEnv } from './server-env';

const REVIEW_TOKEN_DAYS = 365;

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

export function getReviewTokenSecret(): string | undefined {
  return getServerEnv('REVIEW_TOKEN_SECRET')?.trim() || undefined;
}

export type ReviewTokenPayload = {
  orderId: string;
  exp: number;
};

/**
 * Signed review token: `exp:orderId:hexSig` (sig over `exp:orderId`).
 * 365-day expiry. Pass `secret` in tests.
 */
export async function createReviewToken(
  orderId: string,
  secret?: string,
  now: Date = new Date()
): Promise<string> {
  const s = secret ?? getReviewTokenSecret();
  if (!s?.trim()) throw new Error('REVIEW_TOKEN_SECRET is required for review tokens');
  if (!orderId.trim()) throw new Error('orderId required');
  const exp = Math.floor(now.getTime() / 1000) + REVIEW_TOKEN_DAYS * 24 * 3600;
  const payload = `${exp}:${orderId.trim()}`;
  const sig = await hmacHex(s, payload);
  return `${payload}:${sig}`;
}

export async function verifyReviewToken(
  token: string | undefined,
  secret?: string,
  now: Date = new Date()
): Promise<ReviewTokenPayload | null> {
  if (!token?.trim()) return null;
  const s = secret ?? getReviewTokenSecret();
  if (!s?.trim()) return null;

  let normalized = token.trim();
  if (normalized.includes('%3A') || normalized.includes('%3a')) {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      /* keep raw */
    }
  }

  const parts = normalized.split(':');
  if (parts.length !== 3) return null;
  const [expStr, orderId, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(now.getTime() / 1000)) return null;
  if (!orderId?.trim()) return null;
  const expected = await hmacHex(s, `${expStr}:${orderId}`);
  if (!timingSafeEqualStr(sig.toLowerCase(), expected.toLowerCase())) return null;
  return { orderId, exp };
}

export function reviewPath(token: string, rating?: number): string {
  const base = `/review/${encodeURIComponent(token)}`;
  if (rating != null && rating >= 1 && rating <= 5) return `${base}?r=${rating}`;
  return base;
}

export function reviewAbsoluteUrl(siteBase: string, token: string, rating?: number): string {
  return `${siteBase.replace(/\/+$/, '')}${reviewPath(token, rating)}`;
}
