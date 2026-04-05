import { getServerEnv } from './server-env';

/** Default topic for order alerts (override with NTFY_TOPIC_URL or NTFY_TOPIC). */
const DEFAULT_NTFY_URL = 'https://ntfy.sh/hedge-order';

function readWorkerString(
  workerEnv: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!workerEnv) return undefined;
  const v = workerEnv[key];
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

/** Prefer per-request Worker `env` (same object as KV bindings); then getServerEnv. */
function pick(
  workerEnv: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return readWorkerString(workerEnv, key) ?? getServerEnv(key);
}

/** Same rules as workers/cal-ntfy-worker: full URL, or topic name → https://ntfy.sh/… */
function resolveNtfyPostUrl(workerEnv?: Record<string, unknown>): string {
  const full = pick(workerEnv, 'NTFY_TOPIC_URL')?.trim() || '';
  if (full.startsWith('https://') || full.startsWith('http://')) {
    return full.replace(/\/+$/, '');
  }
  const topic = pick(workerEnv, 'NTFY_TOPIC')?.trim() || '';
  if (topic) {
    if (topic.startsWith('https://') || topic.startsWith('http://')) {
      return topic.replace(/\/+$/, '');
    }
    return `https://ntfy.sh/${encodeURIComponent(topic)}`;
  }
  return DEFAULT_NTFY_URL;
}

export type PublishNtfyOptions = {
  title: string;
  message: string;
  /**
   * Pass `locals.runtime?.env` from API routes on Cloudflare so NTFY_* Wrangler vars are read from
   * the same bindings object as ORDERS_KV (module `getEnv()` alone can miss vars in some builds).
   */
  workerEnv?: Record<string, unknown>;
};

/**
 * Publish a message to [ntfy.sh](https://ntfy.sh). Errors are logged only — callers always continue.
 * For a private topic, set NTFY_ACCESS_TOKEN or NTFY_TOKEN (Bearer) in `.env` / Wrangler secrets.
 */
export async function publishNtfyNotification(options: PublishNtfyOptions): Promise<void> {
  const { workerEnv } = options;
  const disabled = pick(workerEnv, 'NTFY_DISABLE');
  if (disabled === '1' || disabled?.toLowerCase() === 'true') {
    return;
  }

  const url = resolveNtfyPostUrl(workerEnv);
  const token =
    pick(workerEnv, 'NTFY_ACCESS_TOKEN')?.trim() || pick(workerEnv, 'NTFY_TOKEN')?.trim();

  const title = options.title.slice(0, 250);
  const headers = new Headers({
    Title: title,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: options.message,
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[ntfy] publish failed:', res.status, text);
    } else {
      console.log('[ntfy] published ok:', res.status, url.replace(/^https?:\/\/[^/]+/i, ''));
    }
  } catch (e) {
    console.error('[ntfy] publish error:', e);
  }
}
