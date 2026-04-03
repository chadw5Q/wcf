import { getServerEnv } from './server-env';

/** Default topic for order alerts (override with NTFY_TOPIC_URL or NTFY_TOPIC). */
const DEFAULT_NTFY_URL = 'https://ntfy.sh/hedge-order';

/** Same rules as workers/cal-ntfy-worker: full URL, or topic name → https://ntfy.sh/… */
function resolveNtfyPostUrl(): string {
  const full = getServerEnv('NTFY_TOPIC_URL')?.trim() || '';
  if (full.startsWith('https://') || full.startsWith('http://')) {
    return full.replace(/\/+$/, '');
  }
  const topic = getServerEnv('NTFY_TOPIC')?.trim() || '';
  if (topic) {
    if (topic.startsWith('https://') || topic.startsWith('http://')) {
      return topic.replace(/\/+$/, '');
    }
    return `https://ntfy.sh/${encodeURIComponent(topic)}`;
  }
  return DEFAULT_NTFY_URL;
}

/**
 * Publish a message to [ntfy.sh](https://ntfy.sh). Errors are logged only — callers always continue.
 * For a private topic, set NTFY_ACCESS_TOKEN or NTFY_TOKEN (Bearer) in `.env` / Wrangler secrets.
 */
export async function publishNtfyNotification(options: {
  title: string;
  message: string;
}): Promise<void> {
  const disabled = getServerEnv('NTFY_DISABLE');
  if (disabled === '1' || disabled?.toLowerCase() === 'true') {
    return;
  }

  const url = resolveNtfyPostUrl();
  const token =
    getServerEnv('NTFY_ACCESS_TOKEN')?.trim() || getServerEnv('NTFY_TOKEN')?.trim();

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
    }
  } catch (e) {
    console.error('[ntfy] publish error:', e);
  }
}
