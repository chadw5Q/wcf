/**
 * Cal.com → ntfy.sh bridge for Cloudflare Workers.
 *
 * Cal.com: Settings → Developer → Webhooks
 *   Subscriber URL: https://<this-worker>.<subdomain>.workers.dev
 *   Trigger: BOOKING_CREATED (or add others — all POSTs are forwarded)
 *
 * Env (Dashboard → Workers → this worker → Settings → Variables):
 *   NTFY_TOPIC     — required topic name (e.g. hedge-order or williamscreekfarms-orders)
 *   NTFY_TOKEN     — optional Bearer token if the ntfy topic is private
 *   CAL_WEBHOOK_SECRET — optional; if set, must match the secret in Cal.com (HMAC SHA-256 hex in x-cal-signature-256)
 *
 * Deploy from repo root:
 *   npm run deploy:cal-webhook
 * or:
 *   cd workers/cal-ntfy-worker && npx wrangler deploy
 */

function timingSafeEqualHex(a, b) {
  const x = (a || '').toLowerCase();
  const y = (b || '').toLowerCase();
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

async function hmacSha256Hex(secret, message) {
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

function buildNtfyMessage(trigger, p) {
  const title = p.title || p.type || 'Cal.com event';
  const startTime = p.startTime || '';
  const endTime = p.endTime || '';
  const attendees = Array.isArray(p.attendees) ? p.attendees : [];
  const primary = attendees[0];
  const booker =
    primary && (primary.name || primary.email)
      ? `${primary.name || 'Guest'}${primary.email ? ` <${primary.email}>` : ''}`
      : '';

  const lines = [
    `Trigger: ${trigger || 'unknown'}`,
    `Title: ${title}`,
    startTime ? `Start: ${startTime}` : '',
    endTime ? `End: ${endTime}` : '',
    booker ? `Booker: ${booker}` : '',
    p.uid ? `UID: ${p.uid}` : '',
    p.location ? `Location: ${p.location}` : '',
    p.additionalNotes ? `Notes: ${String(p.additionalNotes).slice(0, 500)}` : '',
  ].filter(Boolean);

  return { title, text: lines.join('\n') };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return new Response('cal-ntfy-worker OK — POST Cal.com webhooks here', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const topic = env.NTFY_TOPIC?.trim();
    if (!topic) {
      return new Response('Worker misconfigured: set NTFY_TOPIC', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const rawBody = await request.text();

    const calSecret = env.CAL_WEBHOOK_SECRET?.trim();
    if (calSecret) {
      const sigHeader = request.headers.get('x-cal-signature-256') || '';
      const expected = await hmacSha256Hex(calSecret, rawBody);
      if (!sigHeader || !timingSafeEqualHex(sigHeader, expected)) {
        return new Response('Invalid webhook signature', { status: 401 });
      }
    }

    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const trigger = body.triggerEvent || '';
    const p =
      body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : body;

    const { title, text } = buildNtfyMessage(trigger, p);

    const ntfyTitle =
      trigger === 'BOOKING_CREATED'
        ? `New booking: ${title}`.slice(0, 250)
        : `Cal: ${trigger || 'webhook'}`.slice(0, 250);

    const ntfyUrl = `https://ntfy.sh/${encodeURIComponent(topic)}`;
    const headers = new Headers({
      Title: ntfyTitle,
      'Content-Type': 'text/plain; charset=utf-8',
    });
    const ntfyToken = env.NTFY_TOKEN?.trim();
    if (ntfyToken) {
      headers.set('Authorization', `Bearer ${ntfyToken}`);
    }

    const ntfyRes = await fetch(ntfyUrl, {
      method: 'POST',
      headers,
      body: text,
    });

    if (!ntfyRes.ok) {
      const detail = await ntfyRes.text().catch(() => '');
      return new Response(
        JSON.stringify({
          error: 'ntfy request failed',
          status: ntfyRes.status,
          detail: detail.slice(0, 500),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
