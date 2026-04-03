/**
 * Cal.com webhook helpers (signature verification + payload parsing).
 * Aligns with workers/cal-ntfy-worker behavior and Cal’s `x-cal-signature-256` header.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timingSafeEqualHex(a: string, b: string): boolean {
  const x = (a || '').toLowerCase();
  const y = (b || '').toLowerCase();
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyCalWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  const sig = (signatureHeader || '').trim();
  if (!secret.trim() || !sig) return false;
  const expected = await hmacSha256Hex(secret.trim(), rawBody);
  return timingSafeEqualHex(sig, expected);
}

export function parseCalWebhookBody(rawBody: string, contentTypeHeader: string): Record<string, unknown> {
  const ct = (contentTypeHeader || '').toLowerCase();
  const raw = rawBody || '';

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    for (const value of params.values()) {
      const t = value.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          return JSON.parse(t) as Record<string, unknown>;
        } catch {
          /* continue */
        }
      }
    }
  }

  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {
      triggerEvent: 'NON_JSON_BODY',
      _rawSnippet: raw.slice(0, 1500),
    };
  }
}

export function normalizeCalPayload(body: Record<string, unknown>): {
  trigger: string;
  payload: Record<string, unknown>;
} {
  let trigger = String(body.triggerEvent || body._nonStandardTrigger || '').trim();
  let p = body.payload;

  if (typeof p === 'string') {
    try {
      p = JSON.parse(p) as Record<string, unknown>;
    } catch {
      p = {};
    }
  }

  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    p = body;
  }

  return { trigger, payload: p as Record<string, unknown> };
}

function readResponseValue(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && v !== null && 'value' in v) {
    const val = (v as { value: unknown }).value;
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

/** Pull order UUID from Cal booking payload (URL param `orderId`, responses, metadata). */
export function extractOrderIdFromCalPayload(p: Record<string, unknown>): string | undefined {
  const tryUuid = (s: string | undefined): string | undefined => {
    const t = s?.trim();
    if (t && UUID_RE.test(t)) return t;
    return undefined;
  };

  for (const key of ['orderId', 'order_id']) {
    const v = p[key];
    if (typeof v === 'string') {
      const u = tryUuid(v);
      if (u) return u;
    }
  }

  const meta = p.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    for (const key of ['orderId', 'order_id']) {
      const v = (meta as Record<string, unknown>)[key];
      if (typeof v === 'string') {
        const u = tryUuid(v);
        if (u) return u;
      }
    }
  }

  const responses = p.responses;
  if (responses && typeof responses === 'object' && !Array.isArray(responses)) {
    const r = responses as Record<string, unknown>;
    const candidateKeys = ['orderId', 'order_id', 'Order ID', 'Order id', 'order id'];
    for (const k of candidateKeys) {
      if (k in r) {
        const u = tryUuid(readResponseValue(r[k]));
        if (u) return u;
      }
    }
    for (const v of Object.values(r)) {
      const s = readResponseValue(v);
      const u = tryUuid(s);
      if (u) return u;
    }
  }

  const customInputs = p.customInputs;
  if (customInputs && typeof customInputs === 'object' && !Array.isArray(customInputs)) {
    for (const v of Object.values(customInputs as Record<string, unknown>)) {
      const s = readResponseValue(v);
      const u = tryUuid(s);
      if (u) return u;
    }
  }

  return undefined;
}

/** Human-readable pickup window in America/Chicago for KV / admin. */
export function formatCalPickupSlot(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} – ${endIso}`;
  }
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const startT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  }).format(start);
  const endT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(end);
  return `${datePart}, ${startT} – ${endT}`;
}
