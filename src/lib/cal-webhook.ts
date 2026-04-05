/**
 * Cal.com webhook helpers (signature verification + payload parsing).
 * Aligns with workers/cal-ntfy-worker behavior and Cal’s `x-cal-signature-256` header.
 */

/** RFC-style UUID v1–v5 (strict variant nibble). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept any hyphenated 8-4-4-4-12 hex (some runtimes emit non-RFC variant bits). */
const LOOSE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NIL_UUID_RE = /^0{8}-0{4}-0{4}-0{4}-0{12}$/i;

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
    if (val && typeof val === 'object' && val !== null && 'value' in val) {
      const inner = (val as { value: unknown }).value;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return undefined;
}

function tryUuid(s: string | undefined): string | undefined {
  const t = s?.trim();
  if (t && UUID_RE.test(t)) return t;
  return undefined;
}

function tryLooseUuid(s: string | undefined): string | undefined {
  const t = s?.trim();
  if (!t || NIL_UUID_RE.test(t) || !LOOSE_UUID_RE.test(t)) return undefined;
  return t;
}

/** `orderId=uuid` or `order_id=uuid` in a URL or redirect string (Cal prefill / booker links). */
export function extractOrderIdFromUrlString(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const base = s.startsWith('http://') || s.startsWith('https://') ? undefined : 'https://cal.local';
    const u = new URL(s, base);
    for (const key of ['orderId', 'orderID', 'order_id', 'order-id']) {
      const id = u.searchParams.get(key);
      const x = tryUuid(id ?? undefined) || tryLooseUuid(id ?? undefined);
      if (x) return x;
    }
  } catch {
    /* ignore */
  }
  const m = s.match(
    /(?:^|[?&#])order[_-]?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return m ? tryUuid(m[1]) || tryLooseUuid(m[1]) : undefined;
}

const RAW_BODY_SCAN_MAX = 200_000;

/**
 * Find order id in the raw HTTP body. Cal.com often omits `?orderId=` from structured fields;
 * the UUID may still appear once in JSON (responses, custom template, or stringified URL).
 */
export function extractOrderIdFromRawBody(raw: string): string | undefined {
  const slice = raw.length > RAW_BODY_SCAN_MAX ? raw.slice(0, RAW_BODY_SCAN_MAX) : raw;
  const patterns: RegExp[] = [
    /["']orderId["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi,
    /["']order_id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi,
    /["']order-id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(slice);
    if (m) {
      const u = tryUuid(m[1]) || tryLooseUuid(m[1]);
      if (u) return u;
    }
  }
  for (const re of [
    /orderId%3D([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /order_id%3D([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /order%2Did%3D([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
  ]) {
    const m = re.exec(slice);
    if (m) {
      const u = tryUuid(m[1]) || tryLooseUuid(m[1]);
      if (u) return u;
    }
  }
  for (const re of [
    /orderId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /order_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /order-id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
  ]) {
    const m = re.exec(slice);
    if (m) {
      const u = tryUuid(m[1]) || tryLooseUuid(m[1]);
      if (u) return u;
    }
  }
  return undefined;
}

/** Depth-first search for a booking order UUID in nested Cal payload objects. */
export function deepFindOrderIdInValue(value: unknown, depth: number): string | undefined {
  if (depth <= 0 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const fromQ = extractOrderIdFromUrlString(value);
    if (fromQ) return fromQ;
    return tryUuid(value) || tryLooseUuid(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const x = deepFindOrderIdInValue(item, depth - 1);
      if (x) return x;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      const x = deepFindOrderIdInValue(v, depth - 1);
      if (x) return x;
    }
  }
  return undefined;
}

function scanResponseLikeObject(obj: Record<string, unknown>): string | undefined {
  const candidateKeys = [
    'orderId',
    'order_id',
    'order-id',
    'Order ID',
    'Order id',
    'order id',
    'OrderID',
  ];
  for (const k of candidateKeys) {
    if (k in obj) {
      const s = readResponseValue(obj[k]);
      const u = tryUuid(s) || tryLooseUuid(s);
      if (u) return u;
    }
  }
  for (const key of Object.keys(obj)) {
    if (/order[_\s-]?id/i.test(key)) {
      const s = readResponseValue(obj[key]);
      const u = tryUuid(s) || tryLooseUuid(s);
      if (u) return u;
    }
  }
  for (const v of Object.values(obj)) {
    const s = readResponseValue(v);
    const u = tryUuid(s) || tryLooseUuid(s);
    if (u) return u;
  }
  return undefined;
}

/** Pull order UUID from Cal booking payload (prefill URL, responses, metadata, custom fields). */
export function extractOrderIdFromCalPayload(p: Record<string, unknown>): string | undefined {
  for (const key of ['orderId', 'order_id', 'order-id']) {
    const v = p[key];
    if (typeof v === 'string') {
      const u = tryUuid(v) || tryLooseUuid(v);
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
        const u = tryUuid(v) || tryLooseUuid(v);
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

/**
 * Scan only Cal “booking question” / metadata subtrees — not the whole payload (top-level `uid` /
 * booking `id` are Cal’s own UUIDs and must not win over the customer order id).
 */
function resolveOrderIdFromScopedCalObjects(payload: Record<string, unknown>): string | undefined {
  const scanBlocks = (obj: Record<string, unknown>): string | undefined => {
    for (const block of ['responses', 'userFieldsResponses', 'customInputs', 'metadata']) {
      const o = obj[block];
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const u = deepFindOrderIdInValue(o, 12);
        if (u) return u;
      }
    }
    return undefined;
  };

  const top = scanBlocks(payload);
  if (top) return top;

  const b = payload.booking;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const inner = scanBlocks(b as Record<string, unknown>);
    if (inner) return inner;
  }
  return undefined;
}

/** String fields that may embed `?orderId=` (booker link, notes, location). */
function extractOrderIdFromUrlLikePayloadFields(payload: Record<string, unknown>): string | undefined {
  for (const key of [
    'bookerUrl',
    'bookingUrl',
    'booker_url',
    'location',
    'videoCallUrl',
    'notes',
    'description',
  ]) {
    const v = payload[key];
    if (typeof v === 'string') {
      const u = extractOrderIdFromUrlString(v);
      if (u) return u;
    }
  }
  return undefined;
}

/**
 * Resolve order UUID: structured Cal fields first, then scoped subtrees and URL-like strings, then
 * raw-body regex (catches `orderId=` anywhere in JSON). Avoids full-payload deep scan picking
 * Cal’s `uid` / internal ids.
 */
export function resolveOrderIdFromCalWebhook(
  rawBody: string,
  body: Record<string, unknown>,
  payload: Record<string, unknown>
): string | undefined {
  return (
    extractOrderIdFromCalPayload(payload) ??
    extractOrderIdFromCalPayload(body) ??
    resolveOrderIdFromScopedCalObjects(payload) ??
    extractOrderIdFromUrlLikePayloadFields(payload) ??
    extractOrderIdFromRawBody(rawBody)
  );
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

/** ntfy + log text when Cal fired but we could not resolve an order UUID (fix booking question + links). */
export function formatCalBookingAlertWithoutOrderId(
  payload: Record<string, unknown>,
  trigger: string
): string {
  const { start, end } = extractCalBookingTimes(payload);
  let slotLine = '';
  if (start && end) {
    slotLine = formatCalPickupSlot(start, end);
  }
  const attendees = payload.attendees;
  let booker = '';
  if (Array.isArray(attendees) && attendees[0] && typeof attendees[0] === 'object') {
    const a = attendees[0] as Record<string, unknown>;
    const n = a.name != null ? String(a.name) : '';
    const e = a.email != null ? String(a.email) : '';
    booker = [n, e].filter(Boolean).join(' · ');
  }
  const type = String(payload.type ?? '').trim();
  return [
    'Cal hedge pickup fired but NO order ID reached the webhook — order was NOT updated in admin.',
    'Fix in Cal: Event type → Advanced → Booking questions → add Short text, identifier exactly: orderId (camelCase).',
    'Customer must open the scheduling link from your email/site (?orderId=<uuid> pre-fills it).',
    `Trigger: ${trigger}`,
    slotLine ? `Slot: ${slotLine}` : '',
    booker ? `Booker: ${booker}` : '',
    type ? `Event type slug: ${type}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** ntfy when we resolved a UUID but it is not a key in ORDERS_KV (wrong id or test KV). */
export function formatCalBookingOrderNotFoundAlert(
  orderId: string,
  payload: Record<string, unknown>,
  trigger: string
): string {
  const { start, end } = extractCalBookingTimes(payload);
  const slot = start && end ? formatCalPickupSlot(start, end) : '';
  const attendees = payload.attendees;
  let booker = '';
  if (Array.isArray(attendees) && attendees[0] && typeof attendees[0] === 'object') {
    const a = attendees[0] as Record<string, unknown>;
    booker = [a.name != null ? String(a.name) : '', a.email != null ? String(a.email) : '']
      .filter(Boolean)
      .join(' · ');
  }
  return [
    'Cal webhook linked to a UUID that is NOT in your order store — slot was not saved.',
    `Resolved id: ${orderId}`,
    'Check: customer used the thank-you scheduling link (?orderId=…) and that this order exists in admin.',
    `Trigger: ${trigger}`,
    slot ? `Slot: ${slot}` : '',
    booker ? `Booker: ${booker}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
