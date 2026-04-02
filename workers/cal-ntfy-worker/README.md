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
| `NTFY_TOPIC` | Plaintext | **Yes** | ntfy topic name only (e.g. `hedge-order` or `williamscreekfarms-orders`). No URL. |
| `NTFY_TOKEN` | Secret | No | Bearer token if the topic is [private](https://docs.ntfy.sh/config/#access-control). |
| `CAL_WEBHOOK_SECRET` | Secret | No | Same secret as in Cal.com webhook settings; enables `X-Cal-Signature-256` verification. |

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

Open the worker URL in a browser — you should see: `cal-ntfy-worker OK — POST Cal.com webhooks here`.
