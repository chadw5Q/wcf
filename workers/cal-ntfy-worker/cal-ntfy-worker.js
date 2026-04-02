/**
 * Cal.com → ntfy.sh bridge for Cloudflare Workers.
 *
 * Env: NTFY_TOPIC, NTFY_TOPIC_URL, NTFY_TOKEN, CAL_WEBHOOK_SECRET
 * Optional: NTFY_SELF_TEST_SECRET — if set, POST /test-ntfy with header X-Test-Secret: <same> sends a test push
 */

function timingSafeEqualHex(a, b) {
  const x = (a || '').toLowerCase();
  const y = (b || '').toLowerCase();
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

function timingSafeEqualSecret(a, b) {
  const x = new TextEncoder().encode(String(a || ''));
  const y = new TextEncoder().encode(String(b || ''));
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
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

function asciiTitle(s, maxLen) {
  const t = String(s || '')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return t || 'Cal.com';
}

function resolveNtfyPostUrl(env) {
  const full = String(env.NTFY_TOPIC_URL || '').trim();
  if (full.startsWith('https://') || full.startsWith('http://')) {
    return full.replace(/\/+$/, '');
  }
  const topic = String(env.NTFY_TOPIC || '').trim();
  if (!topic) return '';
  if (topic.startsWith('https://') || topic.startsWith('http://')) {
    return topic.replace(/\/+$/, '');
  }
  return `https://ntfy.sh/${encodeURIComponent(topic)}`;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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
    p.location ? `Location: ${String(p.location)}` : '',
    p.additionalNotes ? `Notes: ${String(p.additionalNotes).slice(0, 500)}` : '',
  ].filter(Boolean);

  return { title, text: lines.join('\n') };
}

async function postToNtfy(env, ntfyUrl, titleAscii, bodyText, priorityHigh) {
  const headers = new Headers({
    Title: titleAscii,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  if (priorityHigh) {
    headers.set('Priority', 'high');
  }
  const ntfyToken = String(env.NTFY_TOKEN || '').trim();
  if (ntfyToken) {
    headers.set('Authorization', `Bearer ${ntfyToken}`);
  }
  return fetch(ntfyUrl, { method: 'POST', headers, body: bodyText });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';

      if (request.method === 'GET' && (path === '/' || path === '/health')) {
        const ntfyUrl = resolveNtfyPostUrl(env);
        const body = {
          ok: true,
          service: 'cal-ntfy-worker',
          ntfyConfigured: Boolean(ntfyUrl),
          calSignatureCheckEnabled: Boolean(String(env.CAL_WEBHOOK_SECRET || '').trim()),
          ntfyAuthTokenSet: Boolean(String(env.NTFY_TOKEN || '').trim()),
          selfTestAvailable: Boolean(String(env.NTFY_SELF_TEST_SECRET || '').trim()),
        };
        return new Response(path === '/health' ? JSON.stringify(body, null, 2) : 'cal-ntfy-worker OK — POST Cal.com webhooks here\nGET /health for config flags (no secrets).\nPOST /test-ntfy with X-Test-Secret (see README) to verify ntfy.', {
          headers: {
            'Content-Type': path === '/health' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
          },
        });
      }

      if (request.method === 'POST' && path === '/test-ntfy') {
        const testSecret = String(env.NTFY_SELF_TEST_SECRET || '').trim();
        if (!testSecret) {
          return jsonResponse(
            {
              error: 'Self-test disabled',
              hint: 'Set Worker secret NTFY_SELF_TEST_SECRET in Cloudflare, redeploy, then POST with header X-Test-Secret matching that value.',
            },
            404
          );
        }
        const hdr = request.headers.get('X-Test-Secret') || '';
        if (!timingSafeEqualSecret(hdr, testSecret)) {
          return jsonResponse({ error: 'Unauthorized', hint: 'Send header X-Test-Secret with the same value as NTFY_SELF_TEST_SECRET.' }, 401);
        }
        const ntfyUrl = resolveNtfyPostUrl(env);
        if (!ntfyUrl) {
          return jsonResponse(
            { error: 'ntfy not configured', hint: 'Set NTFY_TOPIC (or NTFY_TOPIC_URL) on this Worker.' },
            500
          );
        }
        const testBody =
          'cal-ntfy-worker test\n\nIf you see this in ntfy, Worker → ntfy is working. Next: fix Cal.com webhook URL and trigger (BOOKING_CREATED).';
        const res = await postToNtfy(env, ntfyUrl, 'Test: cal-ntfy-worker', testBody, true);
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return jsonResponse(
            {
              error: 'ntfy rejected test',
              ntfyStatus: res.status,
              detail: detail.slice(0, 300),
              hint: 'Private topic? Set NTFY_TOKEN. Wrong topic? Check NTFY_TOPIC matches the topic you subscribed to in the ntfy app.',
            },
            502
          );
        }
        return jsonResponse({ ok: true, message: 'Check your ntfy app for the test notification.' }, 200);
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const ntfyUrl = resolveNtfyPostUrl(env);
      if (!ntfyUrl) {
        console.error('[cal-ntfy] missing NTFY_TOPIC or NTFY_TOPIC_URL');
        return jsonResponse(
          {
            error: 'Worker misconfigured',
            hint: 'Set plain-text variable NTFY_TOPIC on this Worker (e.g. hedge-order), or NTFY_TOPIC_URL. Must be on cal-ntfy-worker, not your main site worker.',
          },
          500
        );
      }

      const rawBody = await request.text();

      const calSecret = String(env.CAL_WEBHOOK_SECRET || '').trim();
      if (calSecret) {
        const sigHeader = request.headers.get('x-cal-signature-256') || '';
        const expected = await hmacSha256Hex(calSecret, rawBody);
        if (!sigHeader || !timingSafeEqualHex(sigHeader, expected)) {
          console.error('[cal-ntfy] signature mismatch or missing x-cal-signature-256');
          return jsonResponse(
            {
              error: 'Invalid webhook signature',
              hint: 'CAL_WEBHOOK_SECRET in Cloudflare must exactly match the secret in Cal.com for this webhook. Or remove the secret from both places.',
            },
            401
          );
        }
      }

      let body;
      try {
        body = JSON.parse(rawBody || '{}');
      } catch (e) {
        console.error('[cal-ntfy] invalid JSON', e);
        return jsonResponse(
          {
            error: 'Invalid JSON',
            hint: 'Cal.com may be using a custom payload template. Reset webhook to default JSON or ensure body is valid JSON.',
          },
          400
        );
      }

      const trigger = body.triggerEvent || '';
      const p =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : body;

      const { title, text } = buildNtfyMessage(trigger, p);
      console.log('[cal-ntfy] webhook', trigger || 'unknown', '→ ntfy');

      const ntfyTitleAscii = asciiTitle(
        trigger === 'BOOKING_CREATED' ? `New booking: ${title}` : `Cal: ${trigger || 'webhook'}`,
        250
      );

      const ntfyRes = await postToNtfy(env, ntfyUrl, ntfyTitleAscii, text, true);

      if (!ntfyRes.ok) {
        const detail = await ntfyRes.text().catch(() => '');
        console.error('[cal-ntfy] ntfy failed', ntfyRes.status, detail.slice(0, 200));
        return jsonResponse(
          {
            error: 'ntfy request failed',
            status: ntfyRes.status,
            detail: detail.slice(0, 500),
            hint:
              ntfyRes.status === 401 || ntfyRes.status === 403
                ? 'Topic may be private: set NTFY_TOKEN (Bearer) on this Worker.'
                : 'Check NTFY_TOPIC matches the topic you opened in the ntfy app.',
          },
          502
        );
      }

      console.log('[cal-ntfy] ntfy ok');
      return jsonResponse({ ok: true }, 200);
    } catch (e) {
      console.error('[cal-ntfy] unhandled', e);
      return jsonResponse(
        {
          error: 'Worker crashed',
          message: e instanceof Error ? e.message : String(e),
          hint: 'See Cloudflare Worker Logs for stack trace. Redeploy after fixing.',
        },
        500
      );
    }
  },
};
