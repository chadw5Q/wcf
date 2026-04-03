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

/** Cal.com sends raw hex; some proxies or tools prefix the digest. */
function normalizeSignatureHeader(header: string): string {
  const s = header.trim();
  if (s.toLowerCase().startsWith('sha256=')) return s.slice(7).trim();
  if (s.toLowerCase().startsWith('v0=')) return s.slice(3).trim();
  return s;
}

export async function verifyCalWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  const sig = normalizeSignatureHeader(signatureHeader || '');
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

  const flat = p as Record<string, unknown>;
  const nestedBooking = flat.booking;
  if (nestedBooking && typeof nestedBooking === 'object' && !Array.isArray(nestedBooking)) {
    p = { ...flat, ...(nestedBooking as Record<string, unknown>) };
  }

  return { trigger, payload: p as Record<string, unknown> };
}

/** Map Cal trigger strings to BOOKING_CREATED-style enums (handles `booking.created`, etc.). */
export function normalizeCalTriggerEvent(trigger: string): string {
  return String(trigger || '')
    .trim()
    .replace(/\./g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function readResponseValue(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && v !== null && 'value' in v) {
    const val = (v as { value: unknown }).value;
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

function tryUuid(s: string | undefined): string | undefined {
  const t = s?.trim();
  if (t && UUID_RE.test(t)) return t;
  return undefined;
}

/** `orderId=uuid` or `order_id=uuid` in a URL or redirect string (Cal prefill / booker links). */
export function extractOrderIdFromUrlString(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const base = s.startsWith('http://') || s.startsWith('https://') ? undefined : 'https://cal.local';
    const u = new URL(s, base);
    for (const key of ['orderId', 'order_id']) {
      const id = u.searchParams.get(key);
      const x = tryUuid(id ?? undefined);
      if (x) return x;
    }
  } catch {
    /* ignore */
  }
  const m = s.match(
    /(?:^|[?&#])order[_-]?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return m ? tryUuid(m[1]) : undefined;
}

function scanResponseLikeObject(obj: Record<string, unknown>): string | undefined {
  const candidateKeys = [
    'orderId',
    'order_id',
    'Order ID',
    'Order id',
    'order id',
    'OrderID',
  ];
  for (const k of candidateKeys) {
    if (k in obj) {
      const u = tryUuid(readResponseValue(obj[k]));
      if (u) return u;
    }
  }
  for (const key of Object.keys(obj)) {
    if (/order[_\s-]?id/i.test(key)) {
      const u = tryUuid(readResponseValue(obj[key]));
      if (u) return u;
    }
  }
  for (const v of Object.values(obj)) {
    const s = readResponseValue(v);
    const u = tryUuid(s);
    if (u) return u;
  }
  return undefined;
}

/** Pull order UUID from Cal booking payload (prefill URL, responses, metadata, custom fields). */
export function extractOrderIdFromCalPayload(p: Record<string, unknown>): string | undefined {
  for (const key of ['orderId', 'order_id']) {
    const v = p[key];
    if (typeof v === 'string') {
      const u = tryUuid(v);
      if (u) return u;
    }
  }

  for (const urlKey of ['bookerUrl', 'bookingUrl', 'booker_url']) {
    const v = p[urlKey];
    if (typeof v === 'string') {
      const fromQuery = extractOrderIdFromUrlString(v);
      if (fromQuery) return fromQuery;
    }
  }

  const meta = p.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const mo = meta as Record<string, unknown>;
    for (const key of Object.keys(mo)) {
      if (!/order/i.test(key)) continue;
      const v = mo[key];
      if (typeof v === 'string') {
        const u = tryUuid(v);
        if (u) return u;
      }
    }
  }

  for (const block of ['responses', 'userFieldsResponses', 'customInputs']) {
    const o = p[block];
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const u = scanResponseLikeObject(o as Record<string, unknown>);
      if (u) return u;
    }
  }

  return undefined;
}

/** Cal payloads use `startTime` / `endTime`; some templates or versions vary. */
export function extractCalBookingTimes(payload: Record<string, unknown>): { start: string; end: string } {
  const start = String(
    payload.startTime ?? payload.start ?? payload.start_time ?? ''
  ).trim();
  const end = String(
    payload.endTime ?? payload.end ?? payload.end_time ?? ''
  ).trim();
  return { start, end };
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
