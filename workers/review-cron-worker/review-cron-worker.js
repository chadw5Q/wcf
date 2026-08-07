/**
 * Standalone cron worker: POSTs the Astro app's review-request endpoint once a day.
 * Deploy separately from the main site worker.
 */

function timingSafeEqualSecret(a, b) {
  const x = new TextEncoder().encode(String(a || ''));
  const y = new TextEncoder().encode(String(b || ''));
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}

function resolveTargetUrl(env) {
  const raw = String(env.REVIEW_CRON_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  const site = String(env.SITE_URL || 'https://williamscreekfarms.com').replace(/\/+$/, '');
  return `${site}/api/cron/review-requests`;
}

async function pingReviewCron(env) {
  const secret = String(env.CRON_SHARED_SECRET || '').trim();
  if (!secret) {
    console.error('[review-cron] CRON_SHARED_SECRET missing');
    return { ok: false, error: 'CRON_SHARED_SECRET missing' };
  }
  const url = resolveTargetUrl(env);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cron-Secret': secret,
    },
    body: '{}',
  });
  const text = await res.text().catch(() => '');
  console.log('[review-cron] POST', url, res.status, text.slice(0, 400));
  return { ok: res.ok, status: res.status, body: text.slice(0, 1000) };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      pingReviewCron(env).catch((e) => {
        console.error('[review-cron] scheduled failed', e);
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: 'review-cron-worker',
            target: resolveTargetUrl(env),
            cronSecretSet: Boolean(String(env.CRON_SHARED_SECRET || '').trim()),
          },
          null,
          2
        ),
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (request.method === 'POST' && path === '/run') {
      const hdr = request.headers.get('X-Cron-Secret') || '';
      const secret = String(env.CRON_SHARED_SECRET || '').trim();
      if (!secret || !timingSafeEqualSecret(hdr, secret)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const result = await pingReviewCron(env);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
