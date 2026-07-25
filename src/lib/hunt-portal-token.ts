import { getHuntSessionSigningSecret } from './hunt-auth';

const PORTAL_DAYS = 180;

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

export type HuntPortalPayload = {
  reservationId: string;
  hunterIndex: number;
  exp: number;
};

/**
 * Signed portal token: `exp:reservationId:hunterIndex:hexSig`
 * (sig over `exp:reservationId:hunterIndex`).
 */
export async function createHuntPortalToken(
  reservationId: string,
  hunterIndex: number,
  secret?: string
): Promise<string> {
  const s = secret ?? getHuntSessionSigningSecret();
  if (!s?.trim()) throw new Error('HUNT_SESSION_SECRET or HUNT_PASSWORD is required for portal tokens');
  if (!reservationId.trim()) throw new Error('reservationId required');
  if (!Number.isInteger(hunterIndex) || hunterIndex < 0) throw new Error('hunterIndex invalid');
  const exp = Math.floor(Date.now() / 1000) + PORTAL_DAYS * 24 * 3600;
  const payload = `${exp}:${reservationId.trim()}:${hunterIndex}`;
  const sig = await hmacHex(s, payload);
  return `${payload}:${sig}`;
}

export async function verifyHuntPortalToken(
  token: string | undefined,
  secret?: string
): Promise<HuntPortalPayload | null> {
  if (!token?.trim()) return null;
  const s = secret ?? getHuntSessionSigningSecret();
  if (!s?.trim()) return null;

  let normalized = token.trim();
  // Client may POST a still-percent-encoded path segment (`%3A` for `:`).
  if (normalized.includes('%3A') || normalized.includes('%3a')) {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      /* keep raw */
    }
  }

  const parts = normalized.split(':');
  if (parts.length !== 4) return null;
  const [expStr, reservationId, idxStr, sig] = parts;
  const exp = Number(expStr);
  const hunterIndex = Number(idxStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  if (!reservationId || !Number.isInteger(hunterIndex) || hunterIndex < 0) return null;
  const expected = await hmacHex(s, `${expStr}:${reservationId}:${hunterIndex}`);
  if (!timingSafeEqualStr(sig.toLowerCase(), expected.toLowerCase())) return null;
  return { reservationId, hunterIndex, exp };
}

export function huntPortalPath(token: string): string {
  return `/hunt/portal/${encodeURIComponent(token)}`;
}

/** Post-waiver thank-you + payment step. */
export function huntPortalPaymentPath(token: string): string {
  return `${huntPortalPath(token)}/payment`;
}

export function huntPortalAbsoluteUrl(siteBase: string, token: string): string {
  const base = siteBase.replace(/\/+$/, '');
  return `${base}${huntPortalPath(token)}`;
}
