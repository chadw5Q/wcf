# Cal.com → ntfy Worker

Forwards [Cal.com](https://cal.com) webhook POSTs to [ntfy.sh](https://ntfy.sh) so you get a phone push when someone books.

## 1. Deploy

From the **repository root**:

```bash
npm run deploy:cal-webhook
```

Or:

```bash
cd workers/cal-ntfy-worker
npx wrangler deploy
```

First run will prompt you to log in to Cloudflare. Note the worker URL (e.g. `https://cal-ntfy-worker.<account>.workers.dev`).

## 2. Environment variables

In **Cloudflare Dashboard → Workers & Pages → cal-ntfy-worker → Settings → Variables**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `NTFY_TOPIC` | Plaintext | One of topic/url required | Topic **name only** (e.g. `hedge-order`). A full `https://ntfy.sh/...` URL here is also accepted. |
| `NTFY_TOPIC_URL` | Plaintext | No | Optional full publish URL (self-hosted ntfy or `https://ntfy.sh/...`). |
| `NTFY_TOKEN` | Secret | No | Bearer token if the topic is [private](https://docs.ntfy.sh/config/#access-control). |
| `CAL_WEBHOOK_SECRET` | Secret | No | Must **exactly match** Cal.com’s webhook secret. Mismatch → **401**. When debugging, clear the secret in **both** places. |

CLI for secrets:

```bash
cd workers/cal-ntfy-worker
npx wrangler secret put NTFY_TOKEN
npx wrangler secret put CAL_WEBHOOK_SECRET
```

Add `NTFY_TOPIC` in the dashboard (Variables → **Add variable** → type **Text**).

## 3. Cal.com webhook

1. Cal.com → **Settings** → **Developer** → **Webhooks**
2. **Subscriber URL:** `https://cal-ntfy-worker.<your-subdomain>.workers.dev` (your deployed URL)
3. **Trigger:** `BOOKING_CREATED` (or others you want pushed to ntfy)
4. **Secret:** optional; if set, add the same value as `CAL_WEBHOOK_SECRET` in the worker

Docs: [Cal.com webhooks](https://cal.com/docs/developing/guides/automation/webhooks)

## 4. Smoke test

- Open the worker root in a browser — you should see: `cal-ntfy-worker OK — POST Cal.com webhooks here`.
- Open **`/health`** (e.g. `https://cal-ntfy-worker.your-subdomain.workers.dev/health`) — JSON should show `"ntfyConfigured": true`. If it is **false**, `NTFY_TOPIC` / `NTFY_TOPIC_URL` is missing in this Worker’s **Variables** (not on the Astro site Worker).

## 5. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| **503** on the worker URL | Worker not deployed, wrong name/route, or script error. Redeploy: `npm run deploy:cal-webhook`. In Cloudflare: **Workers** → **cal-ntfy-worker** → **Logs** for errors. |
| Cal.com shows webhook **failed** / **401** | `CAL_WEBHOOK_SECRET` in Cloudflare must match Cal’s webhook secret **character-for-character**. Easiest fix: remove secret from both Cal webhook and Worker, redeploy worker, save Cal webhook. |
| Cal **502** from worker | ntfy rejected the request (wrong topic, **401** without `NTFY_TOKEN` on a private topic, etc.). Check **Logs** for `[cal-ntfy] ntfy failed`. |
| **ntfyConfigured: false** on `/health` | Add **`NTFY_TOPIC`** as a **plain text** variable on **this** Worker (`cal-ntfy-worker`), not only in `.env` for Astro. |

Subscriber URL in Cal.com should be exactly your workers.dev URL, **no trailing slash required**, e.g.  
`https://cal-ntfy-worker.<your-subdomain>.workers.dev`

## 6. Still no phone notification?

Work through these in order:

### A. Confirm you are **subscribed** to the topic in ntfy

The Worker only **publishes** to a topic. Your phone only **receives** if the [ntfy](https://ntfy.sh) app (or web client) is **subscribed to that exact topic name** (e.g. `https://ntfy.sh/hedge-order` in the app). If you never subscribed, you will not see pushes.

### B. Prove Worker → ntfy (without Cal.com)

1. In Cloudflare → **cal-ntfy-worker** → **Variables**, add a **Secret** `NTFY_SELF_TEST_SECRET` (any long random string). Redeploy the worker.
2. Run (replace URL and secret):

```bash
curl -sS -X POST "https://cal-ntfy-worker.YOUR_SUBDOMAIN.workers.dev/test-ntfy" \
  -H "X-Test-Secret: YOUR_SECRET_VALUE"
```

- If the response is `{"ok":true,...}` but **no** ntfy message → topic name wrong or app not subscribed (A).
- If you get `ntfy rejected` / 502 → wrong topic, or private topic without `NTFY_TOKEN`.

`GET /health` shows `"selfTestAvailable": true` when `NTFY_SELF_TEST_SECRET` is set.

### C. Cal.com is actually calling **this** Worker

- **Settings → Developer → Webhooks** → open your subscription → **Subscriber URL** must be the **same** account/subdomain as the Worker that passes `/health` with `ntfyConfigured: true`.
- Check **Webhook delivery / activity** (or similar) in Cal.com: status should be **200**. If **401**, fix or remove `CAL_WEBHOOK_SECRET` / Cal secret. If **500/502**, read the JSON `hint` in the response body.

### D. Trigger and event type

- Subscribe to **Booking created** (`BOOKING_CREATED`) for the events you care about. Other triggers (e.g. rescheduled) need separate subscriptions if you want those too.
- If you use a **custom payload template** on the webhook, the body might not match what this Worker expects; try **default** payload first.

### E. Two Cloudflare accounts

If `/health` works on `1-five-q-innovations` but Cal still points at `williamscreekfarms.workers.dev`, that other URL may be a different account or an undeployed worker — **update Cal.com to the URL that works**.
