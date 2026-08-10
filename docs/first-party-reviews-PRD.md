# Product Requirements Document
## First-Party Reviews System
### Williams Creek Farms — hedge posts site (williamscreekfarms.com)

**Scope:** Main site only — post-purchase reviews for fence / hedge post orders.  
**Not in scope:** Williams Creek Whitetails hunt subsite (`/hunt`). That has its own PRD at `docs/wcw-hunt-subsite-PRD_1.md`. Do not mix the two.

**Prepared:** 2026-08-06  
**Status:** Phases 1–2 shipped and deployed. Phases 3–5 deferred.  
**Source design:** ver0.2 (Ask day 14, email only, threshold of six, photo upload in phase 1)

---

## How to resume

Tell an agent: **“Implement Phase 3 of `docs/first-party-reviews-PRD.md`”** (then 4, then 5). Do not re-build Phases 1–2 unless something is broken.

**Smoke checks before Phase 3 (optional but recommended):**

1. Admin → Reviews → mint a link for a real order → submit (phone photo OK) → Publish / Feature.
2. Mark an order **fulfilled** after `REVIEW_FEATURE_START` → confirm `reviewRequest.queuedFor` ≈ fulfilled + 14 days.
3. Confirm secrets exist on Workers: `REVIEW_TOKEN_SECRET`, `CRON_SHARED_SECRET` (main site **and** `review-cron-worker`), plus existing Resend / ntfy.

---

## Why this exists

1. **Product quality proof** — Marketplace quotes cover the transaction; first-party reviews cover the posts themselves.
2. **Schema eligibility** — Own-site reviews can carry `Review` / `AggregateRating` on **Product** nodes (not Organization / LocalBusiness).
3. **Owned inventory** — Compounds on your infrastructure, not inside a personal Marketplace profile.

**Hard constraint:** Google ineligibility for star rich results when the entity controls reviews about itself under Organization / LocalBusiness. Markup attaches only to **Product** entities already emitted via `buildHomeProductJsonLd`.

Additional rules:

- Reviews must be **visible on the marked-up page** (homepage section + `/reviews`).
- Ratings sourced from buyers; moderation split into **Publish** vs **Feature**.
- **Never incentivize** reviews (no discounts / drawings).

---

## Decisions locked

| Question | Decision |
|---|---|
| Ask 1 timing | Day 14 after `status: 'fulfilled'` |
| Channel | Email only (no SMS) |
| Homepage flip threshold | **6** published first-party reviews |
| Approval | Admin `/admin/reviews` + ntfy on submit + daily digest if `new` > 24h |
| Photo upload | Phase 1 (client canvas resize → JPEG; strips EXIF/GPS) |
| `REVIEW_FEATURE_START` | `2026-08-06T00:00:00.000Z` (hardcoded in `src/lib/review-queue.ts`) |
| Digest email destination | Same as order receipts (`ORDER_NOTIFICATION_EMAIL` / `getOrderNotifyEmail()`) |
| Schema target | Product only — never Organization or LocalBusiness |
| Marketplace + first-party | Do **not** blend into one rating number |

---

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Token, capture, photos, KV/R2, admin moderation, ntfy | **Done** (deployed) |
| 2 | Cron worker, Ask 1 + nudge email, backfill guards | **Done** (deployed) |
| 3 | Homepage flip, `/reviews`, projection wiring, e2e | **Not started** |
| 4 | Product JSON-LD reviews + Rich Results validation | **Not started** |
| 5 | Spring Ask 2 (photo / durability) | **Not started** (after first season) |

---

## What already exists (do not rebuild)

### Libraries

| File | Role |
|---|---|
| `src/lib/review-token.ts` | HMAC token `exp:orderId:sig`, 365-day expiry |
| `src/lib/reviews.ts` | `StoredReview`, create/save/publish/hide/feature/photo/edit |
| `src/lib/reviews-kv.ts` | `REVIEWS_KV` from locals |
| `src/lib/reviews-projection.ts` | `buildReviewsPublicProjection`, `reviews:public` key helpers |
| `src/lib/review-photo.ts` | R2 key rules, MIME/size guards, public URL |
| `src/lib/review-source-selector.ts` | `marketplace` / `firstparty` / `firstparty_with_link` by count |
| `src/lib/review-queue.ts` | Feature start, queue on fulfill, ask/nudge selection, batch cap 25 |
| `src/lib/review-request-email.ts` | Ask 1 + nudge + pending digest via Resend |

### Routes / APIs

| Path | Role |
|---|---|
| `/review/[token]` | Capture form (stars, comment, name, town, photo resize) |
| `/review/thank-you` | Post-submit |
| `/admin/reviews` | Moderate + mint link (Phase 1 testing) |
| `POST /api/reviews/submit` | Create review, stamp `respondedAt`, ntfy |
| `POST /api/admin/review-moderate` | publish / hide / feature / photo / edit |
| `POST /api/admin/review-mint` | Mint link without email |
| `GET /api/media/review/[...key]` | Serve review photos from R2 |
| `POST /api/cron/review-requests` | Cron entry (secret header) |

### Infra

- KV: `REVIEWS_KV` (`wrangler.jsonc`)
- R2: `wcf-review-photos` → `REVIEW_PHOTOS`
- Worker: `workers/review-cron-worker/` — cron `0 14 * * *` (~9am Central)
- Deploy: `npm run deploy` + `npm run deploy:review-cron`
- Order field: `StoredOrder.reviewRequest` (`OrderReviewRequest`)
- Queue on fulfill: `attachReviewRequestOnFulfilled` from `applyOrderMetaPatch` / walk-in create

### Tests already green (Phases 1–2)

- `tests/unit/lib/review-token.test.ts`
- `tests/unit/lib/reviews.test.ts`
- `tests/unit/lib/reviews-projection.test.ts`
- `tests/unit/lib/review-photo.test.ts`
- `tests/unit/lib/review-source-selector.test.ts`
- `tests/unit/lib/review-queue.test.ts`
- `tests/unit/api/reviews-submit.test.ts`
- `tests/unit/api/review-moderate.test.ts`
- `tests/unit/api/cron-review-requests.test.ts`

---

## Publish vs Feature (integrity)

- **Publish** — Counts toward aggregate; appears on `/reviews`. Withhold only for spam, personal info, abusive, or token mismatch; always log reason.
- **Feature** — Up to **3** on the homepage. Editorial freedom; does not change the rating math.
- **Edit** — Typo/format only; never change rating; log in `revisionLog`.
- Photos approve independently of text.

---

## Phase 3 — Site integration (NEXT)

**Goal:** One KV read drives homepage social proof and a public `/reviews` page. Homepage look does **not** change until ≥6 published reviews.

### Projection (mostly built — wire it)

Key `reviews:public` in `REVIEWS_KV` (recomputed on every publish / feature / hide / photo approve via `recomputeAndStoreReviewsPublic`):

```ts
{
  aggregate: { ratingValue: 4.9, reviewCount: 23, updatedAt: "..." } | null,
  featured: [ /* up to 3 */ ],
  recent: [ /* 12 most recent published */ ],
  bySku: { premiumLine: { ratingValue: 5.0, reviewCount: 9 }, /* ... */ }
}
```

Rules:

- `aggregate` is **`null`** when empty or all-hidden — never `0` / `NaN`.
- Homepage / `/reviews` read this key only (no aggregation on page load).
- `index.astro` is already `prerender = false`.

### Homepage transition

Current section: “Worth the Drive” Marketplace quotes in `src/pages/index.astro`.

| Published count | Homepage shows |
|---|---|
| 0–5 | Marketplace quotes **as today**. No first-party schema yet. |
| 6–14 | Featured first-party + strengths card. Drop Marketplace attribution line. |
| 15+ | Featured + aggregate with count + “read all reviews” → `/reviews`. |

Use `selectReviewHomepageSource(publishedCount)` from `review-source-selector.ts`.

**Do not blend** Marketplace and first-party into one number. If both appear during transition for any reason, label them.

### `/reviews` page

- New: `src/pages/reviews.astro`
- Every published review, newest first, paginated; photos when `photoState === 'approved'`
- Short line: every review comes from a confirmed order
- Satisfies Google visibility requirement once schema (Phase 4) is added

### Tests for Phase 3

- Projection / source-selector already covered; extend if pagination helpers are added
- **New:** `tests/e2e/review-flow.spec.ts` (Playwright, mirror `forms.spec.ts`):
  - `/review/{token}?r=4` preselects 4 stars
  - Submit with comment → thank-you
  - JPEG fixture resized client-side; uploaded payload smaller than source
  - Invalid token → friendly message (not 500)
  - Resubmit → already-reviewed message

**Done when:**

- [ ] Homepage uses `reviews:public` + `selectReviewHomepageSource`
- [ ] At 0–5 published, Marketplace section unchanged visually
- [ ] At ≥6, featured first-party reviews render
- [ ] At ≥15, aggregate + link to `/reviews`
- [ ] `/reviews` lists published reviews with confirmed-order copy
- [ ] `npm run test:unit` green; e2e review-flow passes (or documented skip if env unbound)

**Out of scope for Phase 3:** JSON-LD / Rich Results (Phase 4); Ask 2 email (Phase 5).

---

## Phase 4 — Product JSON-LD

**Goal:** Stars eligible for Product rich results without risking Organization/LocalBusiness manual action.

### Implementation

- New: `src/lib/reviews-jsonld.ts`
- Attach to each Product node in `buildHomeProductJsonLd` (see `src/lib/products-config.ts` / homepage JSON-LD):

```ts
{
  "@type": "Product",
  "name": "Premium Line Post, 9 ft",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "5.0",
    "reviewCount": "9"
  },
  "review": [ /* published reviews for that SKU rendered on the page */ ]
}
```

### Rules

- Product nodes **only** — assert **absence** on Organization / LocalBusiness
- Only markup reviews actually rendered on that page
- `reviewCount` = published count (matches `/reviews`)
- SKU with zero published reviews: **omit** `aggregateRating` entirely (never `ratingValue: 0`)
- Customer photos are page content only — **do not** add to `Product.image`

### Tests

**New:** `tests/unit/lib/reviews-jsonld.test.ts`

- `aggregateRating` on Product nodes
- **No** `aggregateRating` / `review` on Organization or LocalBusiness anywhere in the graph
- Per-SKU `reviewCount` matches published
- Zero-review SKU emits **no** `aggregateRating` key
- `review` array ⊆ reviews rendered on page
- Valid JSON; every node has `@type`

### Manual

- Google Rich Results Test before deploy and again ~1 week after

**Done when:** Unit file passes; Rich Results Test clean for homepage Product nodes; no Org/LocalBusiness ratings.

---

## Phase 5 — Spring Ask 2

**Goal:** Follow-up next season **only** to buyers who responded to Ask 1 — ask for a set-fence photo + durability quote.

- Lower response rate expected; highest-value content when it lands
- Do not start until a season of Ask 1 data exists
- Same integrity rules (no incentives; publish vs feature)

**Done when:** Separate email path + queue rules documented and tested; does not re-contact non-responders to Ask 1.

---

## Email copy (Ask 1 — already shipping)

Subject: `How are the posts working for you, [FirstName]?`

Plain text, Chad voice, five star links (`/review/{token}?r=1..5`). One nudge at day 21 if no response; then stop forever (two emails max for non-responders).

Capture page H1 / placeholder: **“How are the posts working for you?”**

---

## Secrets & ops

| Secret / binding | Where |
|---|---|
| `REVIEW_TOKEN_SECRET` | Main Worker |
| `CRON_SHARED_SECRET` | Main Worker **and** `review-cron-worker` (same value) |
| `RESEND_API_KEY` / `RESEND_FROM` | Main Worker (existing) |
| `REVIEWS_KV` / `REVIEW_PHOTOS` | `wrangler.jsonc` |
| Cron | `0 14 * * *` → POST `/api/cron/review-requests` |

Commands:

```bash
npx wrangler secret put REVIEW_TOKEN_SECRET
npx wrangler secret put CRON_SHARED_SECRET
npx wrangler secret put CRON_SHARED_SECRET --config workers/review-cron-worker/wrangler.toml
npm run deploy
npm run deploy:review-cron
```

### Not covered by automated tests

- Cloudflare cron actually firing (`wrangler tail` + manual `/run`)
- Resend deliverability (Gmail / Outlook / iCloud + spam)
- Rich Results validation (manual)
- HEIC conversion on a real iPhone (hand-test before relying on customers)

---

## Measuring success

- Ask 1 response rate: `respondedAt` / `sentAt` (healthy ≈ >20%)
- Photo attach rate (worth watching; >10% makes Phase 5 valuable)
- Benchmark: 11 Marketplace ratings over ~4 years — beat that in one season of fulfilled orders (≥15 published first-party)

---

## Files still to create (Phases 3–4)

**Phase 3**

- `src/pages/reviews.astro`
- Wire `src/pages/index.astro` to projection + source selector
- `tests/e2e/review-flow.spec.ts`

**Phase 4**

- `src/lib/reviews-jsonld.ts`
- Modify product JSON-LD builder / homepage structured data
- `tests/unit/lib/reviews-jsonld.test.ts`

---

## Sources

- [Review snippet (Review, AggregateRating)](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
- [General structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
