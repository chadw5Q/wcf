# Review request cron worker

Posts once a day to the main site: `POST /api/cron/review-requests` with header `X-Cron-Secret`.

## Deploy

```bash
# Same secret on the main site Worker AND this cron worker:
npx wrangler secret put CRON_SHARED_SECRET
npx wrangler secret put CRON_SHARED_SECRET --config workers/review-cron-worker/wrangler.toml

npm run deploy:review-cron
```

## Manual run

```bash
curl -X POST "https://review-cron-worker.<your-subdomain>.workers.dev/run" \
  -H "X-Cron-Secret: $CRON_SHARED_SECRET"
```

Or call the site endpoint directly with the same header.
