# Product Requirements Document
## Williams Creek Whitetails — Private Hunt Subsite
### `/hunt` — Password-Protected Section of williamscreekfarms.com

---

## Overview

Build a completely separate, password-protected subsite within the existing williamscreekfarms.com Astro project. This section lives at `/hunt` and serves as a private sales tool for whitetail hunting prospects and clients. It should feel completely different from the hedge website — rustic, dark, atmospheric, and premium — evoking the feel of high-end outfitter sites like madisoncreekoutfitters.com.

---

## Implementation phases

Use these phases when asking an agent to implement the subsite incrementally. Complete each phase before starting the next unless noted.

**Testing conventions:** Use **Vitest** via `npm run test:unit`, mirroring existing suites under `tests/unit/lib/` and `tests/unit/api/`. Mock external services (Stripe, Resend, Cloudflare KV) in unit tests; keep tests deterministic and offline-friendly. Each phase below lists **Unit / automated tests** appropriate to that slice; Phase 7 adds broader manual and optional E2E (Playwright) checks.

### Phase 1 — Foundation, theme, and SEO

**Goal:** Hunt UI shell is isolated from the main site; crawlers are instructed to ignore `/hunt`.

- **Tech Stack** (project wiring): Astro SSR + Cloudflare patterns; Tailwind extension for hunt tokens from CSS variables; no UI libraries.
- **Design Language** + **Layout Principles**: `.hunt-theme` scoped variables, typography (Playfair + Lora in hunt layout only), button/hr/blockquote patterns, grain/vignette as feasible.
- **File Structure** (skeleton): `HuntLayout.astro`, `components/hunt/*` stubs as needed, `src/pages/hunt/` placeholder routes.
- **Navigation**: `HuntNav.astro` — sticky bar, wordmark, links to `/hunt`, `/hunt/reserve`, `/hunt/final-payment`; mobile hamburger + overlay. Logout can link to a stub until Phase 2.
- **SEO / Robots**: `robots.txt` disallow rules; `noindex, nofollow` on all hunt pages via layout; no sitemap entries for `/hunt`.
- **Image Placeholder Paths**: `public/hunt/images/` structure; gradient + labeled placeholders until real assets exist.
- **Build Notes for Cursor**: Hunt-only fonts in `HuntLayout`; do not modify hedge pages or main nav.

**Unit / automated tests:**
- [ ] **`tests/unit/lib/hunt-seo.test.ts`** (or equivalent): Assert `public/robots.txt` contains the PRD `Disallow` lines for `/hunt` and `/hunt/` (read file from disk in test).
- [ ] If hunt URLs are excluded from the Astro sitemap via **code** (not only manual config), add a focused test that no generated sitemap entry path starts with `/hunt` (or that the filter helper excludes `/hunt` paths). Skip if exclusion is purely static/config with no testable function.

**Out of scope:** Password gate, KV, Stripe, Resend, full page copy beyond minimal stubs.

**Done when:**
- [ ] Hunt routes use `HuntLayout.astro` (not the main site layout); main hedge pages and nav are unchanged.
- [ ] Tailwind includes hunt tokens wired to the PRD CSS variables; hunt styles live under `.hunt-theme` only (no visual bleed into non-hunt pages).
- [ ] Playfair Display + Lora load from `HuntLayout` / hunt pages only — not the global site `<head>`.
- [ ] `src/pages/hunt/` exists with stub routes at minimum: `index.astro`, `login.astro`, `reserve/index.astro`, `reserve/confirmed.astro`, `final-payment/index.astro`, `final-payment/confirmed.astro` (placeholders okay).
- [ ] `src/layouts/HuntLayout.astro` and `src/components/hunt/` exist with `HuntNav.astro` (sticky, wordmark, PRD link labels + targets); desktop layout matches PRD; mobile hamburger opens a full-screen dark overlay menu.
- [ ] Hunt nav does not link to any main hedge URLs; Logout may be stubbed until Phase 2.
- [ ] `public/hunt/images/` exists with `hero.jpg`, `cabin.jpg`, `cabin-wide.jpg`, `gallery/` (e.g. `buck-01` … `buck-12`), and `public/hunt/videos/` folder for drone assets — each missing file replaced by an explicit placeholder (gradient + label text per PRD) or documented stub so builds do not rely on binary commits.
- [ ] `robots.txt` disallows `/hunt` and `/hunt/` as specified; every hunt page emits `<meta name="robots" content="noindex, nofollow">` via the hunt layout.
- [ ] Sitemap generation (if any) excludes all `/hunt` URLs.
- [ ] `npm run build` (or the repo’s equivalent) succeeds with the new hunt skeleton.
- [ ] Phase 1 **Unit / automated tests** pass (`npm run test:unit`); skip sitemap test item only if truly N/A (document in test file why).

---

### Phase 2 — Authentication

**Goal:** Only authenticated visitors see hunt content.

- **Authentication** (password gate): `HUNT_PASSWORD`; `/hunt/login`; signed `hunt_session` cookie (7-day); error copy per PRD.
- **lib/hunt-auth.ts**: Cookie sign/verify helpers (separate from hedge admin auth).
- **Middleware Updates**: Protect `/hunt/*` except `/hunt/login`. `/api/*` routes are unchanged by hunt cookie gating (align handler logic with actual `/api/*` filenames in this repo).
- **Navigation**: Logout clears session and redirects to `/hunt/login`.

**Unit / automated tests:**
- [ ] **`tests/unit/lib/hunt-auth.test.ts`**: Cookie **sign + verify** roundtrip with a fixed secret; tampered payload or signature fails; expired payload fails (if expiry is encoded); optional test that wrong secret rejects.
- [ ] **Hunt middleware path helper**: Export a pure function (e.g. `requiresHuntSession(pathname: string): boolean`) meaning “this URL is under `/hunt` but is not the login page.” **`tests/unit/lib/hunt-auth-paths.test.ts`** asserts: `/hunt/login` → false; `/hunt`, `/hunt/reserve`, `/hunt/final-payment`, etc. → true; `/api/hunt-reserve`, `/api/webhooks/stripe-hunt`, `/`, `/admin` → false (API and main site are not gated by the hunt cookie — adjust if you intentionally nest APIs under `/hunt`).

**Out of scope:** Reservation forms, payments, emails.

**Done when:**
- [ ] `HUNT_PASSWORD` is read from env (documented in `.env.example` or project env docs); wrong password shows the exact PRD error string including Chad’s phone.
- [ ] `/hunt/login` renders in hunt theme (full-screen, centered wordmark, password field, submit).
- [ ] Successful login sets signed `hunt_session` with 7-day expiry; cookie is httpOnly/secure/sameSite appropriate for production.
- [ ] `src/lib/hunt-auth.ts` centralizes sign/verify/clear helpers; hedge admin auth remains separate.
- [ ] Middleware protects every `/hunt/*` path except `/hunt/login`. Hunt APIs and webhooks live under `/api/*` and are **not** blocked by the hunt cookie (they use Stripe webhook signatures and server-side validation instead).
- [ ] Unauthenticated visit to any protected hunt URL redirects to `/hunt/login` (with sensible return behavior if implemented).
- [ ] Nav **Logout** clears `hunt_session` and redirects to `/hunt/login`.
- [ ] Manual check: fresh browser session → blocked from `/hunt` → login → access → logout → blocked again.
- [ ] Phase 2 **Unit / automated tests** pass (`npm run test:unit`).

---

### Phase 3 — About landing page (`/hunt`)

**Goal:** Full marketing page matches PRD sections and tone.

- **Page 1** (`/hunt`): Hero (gradient, CTA, chevron), About two-column, Property stats + pull quote, Cabin full-width section, Trail Camera Gallery (masonry), **Video Integration** (“See the Property”), Hunt Details cards, Iowa Tag Info, Pricing table, Booking & Availability, hunt-specific **Footer**.
- Reusable pieces: `HuntHero.astro`, `HuntGallery.astro`, `HuntFooter.astro` as appropriate.
- Parallax / polish can be Phase 7 if needed for velocity.

**Unit / automated tests:**
- [ ] **Optional.** Phase 3 is primarily markup; skip unit tests unless you extract **pure data** (e.g. stats copy array, hunt detail cards config). If extracted, add **`tests/unit/lib/hunt-landing-content.test.ts`** to assert array lengths, required fields, and valid external URLs (e.g. Iowa DNR link, podcast URL).
- [ ] Do **not** block phase completion on component snapshot tests.

**Out of scope:** Live reserve/final-payment logic beyond links to those routes.

**Done when:**
- [ ] `/hunt` (`index.astro`) implements all Page 1 sections in PRD order: Hero (gradient, copy, CTA to `/hunt/reserve`, animated chevron), About two-column + cabin image, Property 2×2 stats + gold pull quote, Cabin full-width band, Trail Camera Gallery (masonry 3/2 cols), **See the Property** video block (controls, poster, muted default, no autoplay, gold border, fallback text), Hunt Details 2×2 icon cards, Iowa Tag card + DNR link, Pricing table + disclaimer, Booking & Availability + CTA to `/hunt/reserve`, hunt footer (wordmark, phone, email, © line, no hedge links).
- [ ] Copy matches PRD intent (including podcast link, gallery caption, booking status text — update later via content edits only).
- [ ] `HuntHero`, `HuntGallery`, `HuntFooter` (or equivalent) are used so sections stay maintainable.
- [ ] Reserve/Final Payment buttons only navigate; forms may still be stubs from Phase 1 until Phase 5–6.
- [ ] Page validates as hunt-themed (dark/rustic) and readable on mobile and desktop.
- [ ] If optional content-config tests were added in **Unit / automated tests**, they pass; otherwise N/A.

---

### Phase 4 — KV and reservation model

**Goal:** Persistence layer exists before payment wiring.

- **Data Storage**: `HUNT_KV` binding in `wrangler.toml` (namespace ID in env/docs only as appropriate for the repo).
- **lib/hunt-reservations.ts**: Read/write helpers and types matching **Reservation Data Structure**.
- Creating/updating draft reservations from server code can land here or at the start of Phase 5.

**Unit / automated tests:**
- [ ] **`tests/unit/lib/hunt-reservations.test.ts`**: Validate/normalize reservation objects (required fields, hunter count vs `hunters.length`, allowed `status` values); JSON roundtrip preserves shape.
- [ ] **KV adapter mocked**: Test `put` + `get` flow using an in-memory `Map` or Vitest mock implementing the KV subset your helpers use; assert correct key pattern (e.g. `reservation:{id}`).
- [ ] **Edge cases**: empty hunters array rejected; `hunterCount` mismatch rejected; optional fields (`notes`, `stripeBalanceSessionId`) omitted vs present.

**Out of scope:** Stripe Checkout, webhooks, HTML emails (unless you merge with Phase 5).

**Done when:**
- [ ] `wrangler.toml` (or equivalent) declares `HUNT_KV` binding; README or deploy docs note creating the KV namespace and setting the ID for prod/preview.
- [ ] `src/lib/hunt-reservations.ts` exports typed helpers and matches the **Reservation Data Structure** JSON shape in this PRD.
- [ ] All **Unit / automated tests** for this phase pass (`npm run test:unit`).
- [ ] Creating a reservation record (draft or full) from server code works locally / in preview without Stripe (optional helper or script acceptable).

---

### Phase 5 — Reserve flow, deposit checkout, webhook, deposit email

**Goal:** End-to-end deposit path works.

- **Page 2** (`/hunt/reserve`): Full form (group size, per-hunter fields, year, weeks from static `huntWeeks` config, meal package, summary, notes); client validation; POST to **`POST /api/hunt-reserve`**.
- **`POST /api/hunt-reserve`**: Validate body; save to KV; create Stripe Checkout Session; return `{ reservationId, stripeUrl }`; success/cancel URLs per PRD.
- **`/hunt/reserve/confirmed`**: Post-payment messaging per PRD.
- **`POST /api/webhooks/stripe-hunt`**: On `checkout.session.completed` for deposit: set status `deposit_paid`; **Resend** deposit confirmation to all hunter emails (**Deposit Confirmation Email**).
- **Environment Variables**: `STRIPE_WEBHOOK_SECRET_HUNT`, `HUNT_NOTIFY_EMAIL`, etc., as listed.

**Depends on:** Phase 2 (protected routes), Phase 4 (KV).

**Unit / automated tests:**
- [ ] **`tests/unit/lib/hunt-pricing.test.ts`** (or `hunt-order-summary.test.ts`): Pure functions for hunt total, meal add-on (1 hunter vs additional hunters per PRD copy), deposit `(hunters × $500)`, and balance due July 1 — table-driven cases for 1–4 hunters, with/without meals.
- [ ] **`tests/unit/lib/hunt-weeks.test.ts`** (optional): If `huntWeeks` lives in TypeScript, assert each configured year has expected week ids and `available` flags for snapshot stability.
- [ ] **`tests/unit/api/hunt-reserve.test.ts`**: POST body validation (missing hunter email → 4xx); happy path with **mocked** Stripe client and **mocked** KV — expect `{ reservationId, stripeUrl }`; assert Checkout `success_url` contains `session_id` placeholder or equivalent per Stripe API.
- [ ] **`tests/unit/api/stripe-hunt-webhook.test.ts`** (or split files): Construct signed webhook payload for `checkout.session.completed` **deposit** (use Stripe test helpers or mock `constructEvent`); assert reservation updated to `deposit_paid` and Resend send called with expected recipient list (mock Resend).

**Done when:**
- [ ] `/hunt/reserve` implements all form steps: party size 1–4 with dynamic hunter blocks; required fields; US state dropdown; hunt year dropdown (current through +5); week picker from static `huntWeeks` with unavailable weeks disabled/`Booked`; meal checkbox; live **Order Summary** card; notes textarea; deposit terms copy under submit.
- [ ] Client-side validation blocks submit with clear errors; submit POSTs to `POST /api/hunt-reserve`.
- [ ] API validates body, persists reservation to `HUNT_KV`, creates Stripe Checkout for `hunters × $500`, returns `{ reservationId, stripeUrl }`; success URL includes `session_id`; cancel returns to `/hunt/reserve`.
- [ ] User completes test Checkout → lands on `/hunt/reserve/confirmed` with PRD messaging.
- [ ] `POST /api/webhooks/stripe-hunt` verifies signature (`STRIPE_WEBHOOK_SECRET_HUNT`), handles `checkout.session.completed` for deposits: reservation status → `deposit_paid`; Resend sends deposit HTML email to every hunter with year, week, party, costs, balance due July 1, next steps, Chad contact, DNR reminder (per **Deposit Confirmation Email**).
- [ ] Chad notify email fires if `HUNT_NOTIFY_EMAIL` is set (optional but recommended).
- [ ] Env vars documented: `STRIPE_WEBHOOK_SECRET_HUNT`, `HUNT_NOTIFY_EMAIL`, shared `STRIPE_SECRET_KEY` / `RESEND_API_KEY` as applicable.
- [ ] Phase 5 **Unit / automated tests** pass (`npm run test:unit`).

---

### Phase 6 — Final payment flow and balance email

**Goal:** Returning clients can pay balance; webhook handles balance completion.

- **Page 3** (`/hunt/final-payment`): Form fields and default balance calculation per PRD.
- **`POST /api/hunt-balance`**: Stripe Checkout Session for balance; redirect URLs to **`/hunt/final-payment/confirmed`**.
- **Webhook**: Balance-paid branch → status `balance_paid`; **Balance Confirmation Email** via Resend.
- Optional: persist balance session id on reservation per **Reservation Data Structure**.

**Depends on:** Phase 5 (Stripe + webhook pattern established).

**Unit / automated tests:**
- [ ] **`tests/unit/lib/hunt-final-balance.test.ts`**: Default balance formula matches PRD: `(hunters × 3000) + (meals ? 1000 : 0) − (hunters × 500)` for representative inputs; optional tests for manual override if implemented as separate code path.
- [ ] **`tests/unit/api/hunt-balance.test.ts`**: Validation (missing fields → 4xx); happy path with mocked Stripe + KV; assert session amount/metadata identifies **balance** vs deposit if your webhook relies on it.
- [ ] **Extend `stripe-hunt-webhook` tests**: `checkout.session.completed` **balance** path updates status to `balance_paid` and triggers balance email (mock Resend); deposit path still behaves as in Phase 5.

**Done when:**
- [ ] `/hunt/final-payment` includes all PRD fields; default **Payment Amount** matches `(hunters × $3,000) + (meal ? $1,000 : 0) − (hunters × $500)` with editable override if specified.
- [ ] Submit POSTs to `POST /api/hunt-balance`; API creates Stripe Checkout for the balance; success → `/hunt/final-payment/confirmed` with thank-you + contact info per PRD.
- [ ] Webhook distinguishes deposit vs balance sessions (metadata or line items); balance completion sets status `balance_paid` and sends **Balance Confirmation Email** via Resend.
- [ ] Optional: `stripeBalanceSessionId` (or equivalent) stored on the reservation record.
- [ ] Phase 6 **Unit / automated tests** pass (`npm run test:unit`).

---

### Phase 7 — Polish and QA

**Goal:** Match “premium outfitter” feel and PRD edge cases.

- Hero parallax, gallery refinement, placeholder swaps when assets exist; responsive passes.
- Confirm **`/api/hunt-*`** and **`/api/webhooks/stripe-hunt`** behave correctly without a hunt session (they are not `/hunt/*` page routes).
- Manual test checklist: login/logout, reserve → Stripe test mode → webhook → email; final payment path; robots/noindex verified.

**Unit / automated tests:**
- [ ] **Regression sweep:** `npm run test:unit` passes with full hunt suite; fix any flaky timing in mocks.
- [ ] **Optional E2E:** Add **`tests/e2e/hunt-flow.spec.ts`** (Playwright): login → hit `/hunt` → navigate to reserve (assert form visible); run only when env provides test credentials/Stripe test keys — keep out of default CI if secrets missing, or gate with `process.env`.
- [ ] **Middleware matrix:** If not already covered in Phase 2, extend path tests for any new `/hunt/*` or `/api/hunt-*` routes added during polish.

**Done when:**
- [ ] Hero uses parallax or equivalent motion per PRD without hurting CLS or mobile performance (or documented deferral with owner approval).
- [ ] Gallery masonry layout is polished (spacing, captions if any); broken images fall back gracefully.
- [ ] Responsive pass on all hunt pages: typography, nav overlay, forms, tables (pricing).
- [ ] Middleware re-audited: hunt cookie required for all `/hunt/*` except `/hunt/login`; `/api/*` hunt endpoints remain reachable without hunt session (secured by Stripe secrets, validation, and deployment controls as appropriate).
- [ ] End-to-end smoke (test Stripe mode): login → reserve → deposit webhook → deposit emails → final payment → balance webhook → balance email.
- [ ] SEO smoke: `robots.txt`, meta robots, and sitemap behavior re-verified; View Source on `/hunt` confirms `noindex`.
- [ ] Full unit suite passes (`npm run test:unit`); optional Playwright hunt spec documented or wired per **Unit / automated tests** for this phase.

---

## Tech Stack
- Same Astro project (SSR mode, Cloudflare adapter)
- TypeScript
- Tailwind CSS (custom theme extension for hunt section)
- Cloudflare KV for hunt reservations (new namespace: HUNT_KV)
- Stripe for $500/person deposit payments
- Resend for email confirmations
- No external UI component libraries — custom Tailwind only
- Google Fonts: **Playfair Display** (headings) + **Lora** (body) — serif, editorial, rustic

---

## Design Language

### Visual Identity
- **Brand name**: Williams Creek Whitetails
- **Tone**: Rustic, premium, trophy-class. Think: dark timber lodge, firelight, October mornings in the timber.
- **Color Palette** (define as CSS variables scoped to `.hunt-theme`):
  - `--hunt-bg`: `#1a1410` (near-black warm brown)
  - `--hunt-surface`: `#2a1f16` (dark walnut)
  - `--hunt-surface-2`: `#3d2e20` (medium warm brown)
  - `--hunt-gold`: `#c9a84c` (antique gold — primary accent)
  - `--hunt-gold-light`: `#e8c97a` (light gold for hover states)
  - `--hunt-cream`: `#f0e6d3` (parchment — body text on dark)
  - `--hunt-muted`: `#9a8a78` (muted text)
  - `--hunt-border`: `#4a3a28` (subtle borders)
  - `--hunt-red`: `#8b1a1a` (deep burgundy — used sparingly)
- **Typography**:
  - Headings: `'Playfair Display', serif` — italic variants for subheadings
  - Body: `'Lora', serif`
  - Labels/UI: `'Lora', serif` at small weights
- **Textures**: Use CSS `background-image` with subtle grain/noise overlay on hero sections (`radial-gradient` + `noise` filter or SVG noise pattern)
- **Decorative elements**: Thin gold horizontal rules (`<hr>` styled), antler or oak leaf SVG dividers inline, subtle vignette on hero images
- **Buttons**: Dark background with gold border + gold text; hover fills with gold. Slightly rounded (4px). Uppercase, letter-spaced.
- **Photography**: Full-bleed hero images, parallax scroll effect on hero, dark overlay to ensure text readability

### Layout Principles
- Full-width hero sections with dramatic photography
- Generous whitespace between sections
- Section content max-width: 900px centered
- Two-column grids for stat/feature callouts
- Heavy use of `<blockquote>`-style pull quotes in gold italic
- Photo gallery: masonry-style grid

---

## SEO / Robots

Add to `robots.txt`:
```
User-agent: *
Disallow: /hunt/
Disallow: /hunt
```

Add `<meta name="robots" content="noindex, nofollow">` to ALL `/hunt/*` pages.
No sitemap entries for any hunt pages.

---

## Authentication

### Password Gate
- All `/hunt/*` routes are protected by a single shared password
- Password stored as Cloudflare env var: `HUNT_PASSWORD` (default: `HuntIowa2026` — easily changed)
- Login page: `/hunt/login`
- On successful login, set a signed session cookie: `hunt_session` (7-day expiry)
- Middleware intercepts all `/hunt/*` requests and redirects to `/hunt/login` if cookie is invalid or missing
- Logout link in nav clears the cookie and redirects to `/hunt/login`
- Login page design matches the hunt theme (dark, full-screen, logo centered, password field, submit button)
- No username — password only
- Login page error message: "Incorrect password. Please try again or contact Chad at 712-254-3999."

---

## Navigation

### Hunt Nav (completely separate from main site nav)
- Sticky top navigation, dark background (`--hunt-surface`)
- Logo/wordmark: **"Williams Creek Whitetails"** in Playfair Display, gold — links to `/hunt`
- Optional: small antler icon SVG to the left of the wordmark
- Nav links (right-aligned, desktop):
  - **About** → `/hunt`
  - **Reserve Your Hunt** → `/hunt/reserve`
  - **Make Final Payment** → `/hunt/final-payment`
  - **Logout** → clears session, redirects to `/hunt/login`
- Mobile: hamburger menu, full-screen overlay in dark theme
- Do NOT show or link to any part of the main hedge website from hunt nav

---

## Pages

---

### Page 1: `/hunt` — About / Main Landing Page

**Purpose**: Sell the hunt. Convince qualified prospects this is the right choice. CTA drives to Reserve.

#### Section 1: Hero
- Full-bleed background image (use placeholder path: `/hunt/images/hero.jpg` — Chad will upload)
- Dark gradient overlay: `linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(26,20,16,0.85) 100%)`
- Centered content:
  - Small all-caps label: `"Zone 4 • Adams & Montgomery County, Iowa"`
  - H1: `"Trophy Whitetail. Guided Archery Hunts."`
  - Subhead: `"A father and son operation. 725 acres of managed timber. No more than 4 hunters per year."`
  - CTA button: `"Reserve Your Hunt →"` links to `/hunt/reserve`
- Scroll-down indicator (animated chevron)

#### Section 2: "About the Operation" — Two columns
- Left: narrative text (from FAQ):
  - We are a small operation run by a father and son, Lee and Chad Williams
  - Passionate about hunting and love serving people
  - No more than 4 non-residents per year
  - Own/manage ~725 acres in Zone 4 (Adams and Montgomery County)
  - As archery hunters ourselves, we know the property well
  - Featured on Jake Hofer's Land Podcast (link the podcast)
- Right: image (`/hunt/images/cabin.jpg` placeholder — the cabin/lodge rainbow photo)

#### Section 3: "The Property" — Stat callouts in 2x2 grid
- `725 Acres` — Owned & managed timber
- `35+ Stands` — Mix of hang-on, ladder, and Redneck/Banks blinds
- `Zone 4` — Adams & Montgomery County, Iowa
- `Since 2020` — Active habitat management

Below the grid, a pull quote in gold italic:
> *"As archery hunters ourselves, we know every trail, every crossing, every stand. We hunt this property because we believe in it."*
> — Chad & Lee Williams

#### Section 4: "The Cabin" — Full-width image with overlay text
- Background: `/hunt/images/cabin-wide.jpg` (same cabin photo, wide crop)
- Overlay text:
  - Label: `"Accommodations"`
  - H2: `"A Lodge Worth Coming Back To"`
  - Body: 4+ bedrooms, loft, full basement, full kitchen, high speed internet, YouTubeTV, fireplace, firepit, grill and more. Sleeps your entire party comfortably.

#### Section 5: "Trail Camera Gallery"
- Section heading: `"The Bucks We're Managing"`
- Masonry photo grid (3 columns desktop, 2 mobile) using all trail cam photos from the FAQ PDF
- Placeholder paths: `/hunt/images/gallery/` — Chad will upload photos
- Caption below grid: `"150"+ bucks harvested every season since 2021. 2025 management buck: 197 lbs field dressed."`

#### Section 6: "Hunt Details" — Icon + text list
Four cards in a 2x2 grid, each with a simple SVG icon:
1. **Archery Only** — Compound or saddle/hang-and-hunt. No gun hunts.
2. **6 Nights / 5.5 Days** — Arrive Sunday after 2pm. Depart Saturday by noon.
3. **No Wound Policy** — Your hunt isn't over until we tag your deer.
4. **Flexible Buck Selection** — We protect up-and-coming bucks but have no point minimums. Shoot one you'd mount.

#### Section 7: "Iowa Tag Info"
- Clean card: "You need at least 4 preference points to draw a non-resident Zone 4 Iowa archery tag. Tags are applied for through the Iowa DNR."
- Link: Iowa DNR deer tag application page

#### Section 8: "Pricing"
Display as a clean comparison card:

| | Self-Catered | All-Inclusive |
|---|---|---|
| Hunt + Lodging | $3,000/person | +$1,000 for 1 hunter. $250 for each additioanl hunter |
| Food & Cooking | You bring your own | Fully provided |
| Doe (optional) | +$300 | +$300 |
| Deposit to Reserve | $500/person | $500/person |

Note: "Iowa deer tag and license not included. Purchased separately through Iowa DNR."

#### Section 9: "Booking & Availability"
- Current status: **2026 is fully booked. Now taking 2027 reservations.**
- Process steps (numbered, gold):
  1. Place $500/person deposit
  2. We confirm your week
  3. Full balance invoice sent June 1, due July 1
  4. Arrive and hunt
- CTA button: `"Reserve Your 2027 Hunt →"` → `/hunt/reserve`

#### Section 10: Footer (hunt-specific)
- Dark background
- Williams Creek Whitetails wordmark
- Phone: 712-254-3999
- Email: cchadww@gmail.com
- `"© 2026 Williams Creek Farms, LLC — Private. Not for distribution."`
- NO links to main hedge website

---

### Page 2: `/hunt/reserve` — Reserve Your Hunt

**Purpose**: Collect hunter info and process $500/person Stripe deposit.

#### Layout
- Dark theme, same nav
- Hero: smaller banner with title `"Reserve Your Hunt"` over a dark timber background image
- Form below hero, max-width 700px centered

#### Form Fields

**Step 1: Group Size**
- Label: `"How many hunters in your party?"`
- Segmented button selector: `1` `2` `3` `4`
- Selecting a number dynamically shows N sets of hunter fields

**Per-Hunter Fields** (shown once per hunter count selected):
- For Hunter 1, label: `"Your Information"`. For Hunters 2-4, label: `"Hunter 2 / 3 / 4 Information"`
- First Name (required)
- Last Name (required)
- Email Address (required)
- Cell Phone (required)
- Home State (required) — dropdown of all US states

**Step 2: Hunt Year**
- Label: `"Choose Your Hunt Year"`
- Dropdown: current year through current year + 5 (e.g. 2026, 2027, 2028, 2029, 2030, 2031, 2032)
- Note below: `"2026 is fully booked. 2027 is next available."` (static note, update manually)

**Step 3: Preferred Week**
- Label: `"Choose Your Preferred Week"`
- Dynamic options based on year selected — rendered from a static config object in the page:
  ```
  const huntWeeks = {
    2027: [
      { id: 'w1', label: 'Week 1 — Oct 25–Nov 1 (Last week of October)', available: false },
      { id: 'w2', label: 'Week 2 — Nov 1–8 (First week of November — Prime Rut)', available: true },
      { id: 'w3', label: 'Week 3 — Nov 8–15 (Second week of November)', available: false },
    ],
    2028: [
      { id: 'w1', label: 'Week 1 — (Last week of October from Sunday - Saturday)', available: true },
      { id: 'w2', label: 'Week 2 — Nov 1–8 (First week of November from Sunday - Saturday — Prime Rut)', available: true },
      { id: 'w3', label: 'Week 3 — Nov 8–15 (Second week of November from Sunday - Saturday)', available: true },
    ],
    // repeat pattern for each year through 2032
  }
  ```
- Available weeks show as selectable cards. Unavailable weeks show as grayed out with "Booked" badge.
- Note: `"The first week of November is historically our best rut hunting."`

**Step 4: Meal Package**
- Label: `"Meal Package (Optional)"`
- Checkbox: `"Add All-Inclusive Food & Cooking Package — +$1,000 for 1 hunter. $250 for each additioanl hunter"`
- Helper text: `"We handle all meals and cooking for your entire stay. You just hunt."`

**Step 5: Order Summary** (dynamic, updates as form changes)
- Displayed as a card above the submit button:
  ```
  Hunt: [N] hunters × $3,000 = $X,XXX
  Meals (if selected): $1,000
  ─────────────────────────────
  Total Hunt Cost: $X,XXX
  
  Due Today (Deposit): [N] hunters × $500 = $X,XXX
  Balance Due July 1: $X,XXX
  ```

**Additional Notes field**
- Textarea: `"Any questions or special requests?"`

**Submit Button**
- Label: `"Reserve My Spot — Pay $[deposit amount] Deposit"`
- On click:
  1. Validate all required fields
  2. POST to `/api/hunt-reserve`
  3. API saves reservation to HUNT_KV
  4. API creates Stripe Checkout Session for deposit amount
  5. Redirect to Stripe Checkout
  6. On Stripe success, redirect to `/hunt/reserve/confirmed`
  7. On Stripe success webhook, send Resend confirmation email to all hunters

**Deposit Terms** (below button, small text):
- "The $500/person deposit is non-refundable but transferable to any future hunt year."
- "Full balance is due July 1 of your hunt year and is fully refundable if you need to cancel."

#### Confirmation Page: `/hunt/reserve/confirmed`
- Dark theme
- Large gold checkmark icon
- Heading: `"You're In. Welcome to Williams Creek Whitetails."`
- Body: `"Your deposit has been received. Chad will be in touch within 24 hours to confirm your week and answer any questions. Text or call anytime: 712-254-3999"`
- What happens next (numbered list):
  1. Chad confirms your week reservation
  2. Full balance invoice sent June 1
  3. Full balance due July 1
  4. Arrive Sunday after 2pm — the hunt begins

---

### Page 3: `/hunt/final-payment` — Make Final Payment

**Purpose**: Allow returning clients to pay their remaining balance.

#### Layout
- Simple, clean form. Dark theme.
- Heading: `"Make Your Final Hunt Payment"`
- Subhead: `"Full balances are due July 1 of your hunt year."`

#### Form Fields
- First Name (required)
- Last Name (required)
- Email Address (required)
- Hunt Year (dropdown: current year + 2 years)
- Number of Hunters (1-4)
- Meal Package Included? (Yes/No radio — affects total)
- Payment Amount (auto-calculated and shown, but also manually editable if needed)
  - Default calculation: (hunters × $3,000) + ($1,000 if meals) - (hunters × $500 already paid)

#### Submit Button
- `"Pay Balance via Stripe"`
- Creates a Stripe Checkout Session for the balance amount
- On success: redirect to `/hunt/final-payment/confirmed`
- Confirmation page: simple thank-you with contact info

---

## Data Storage (Cloudflare KV)

### New KV namespace: HUNT_KV

Bind in `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "HUNT_KV"
id = "YOUR_HUNT_KV_NAMESPACE_ID"
```

### Reservation Data Structure
```json
{
  "id": "uuid",
  "createdAt": "ISO8601",
  "status": "deposit_paid | confirmed | balance_paid | fulfilled | cancelled",
  "huntYear": 2027,
  "preferredWeek": "w2",
  "mealPackage": true,
  "hunters": [
    {
      "firstName": "string",
      "lastName": "string",
      "email": "string",
      "phone": "string",
      "state": "string"
    }
  ],
  "hunterCount": 2,
  "huntCostPerPerson": 3000,
  "mealPackageCost": 1000,
  "totalHuntCost": 7000,
  "depositPerPerson": 500,
  "totalDeposit": 1000,
  "balanceDue": 6000,
  "stripeDepositSessionId": "string",
  "stripeBalanceSessionId": "string | null",
  "notes": "string | null"
}
```

---

## API Endpoints

### `POST /api/hunt-reserve`
- Validates request body
- Saves reservation to HUNT_KV
- Creates Stripe Checkout Session:
  - Line items: `[N] Hunt Deposits — Williams Creek Whitetails 2027`
  - Amount: hunters × $500
  - Success URL: `/hunt/reserve/confirmed?session_id={CHECKOUT_SESSION_ID}`
  - Cancel URL: `/hunt/reserve`
- Returns `{ reservationId, stripeUrl }`

### `POST /api/hunt-balance`
- Creates Stripe Checkout Session for final balance
- Returns Stripe redirect URL

### `POST /api/webhooks/stripe-hunt`
- Handles `checkout.session.completed`
- On deposit paid: update reservation status to `deposit_paid`, send Resend confirmation emails
- On balance paid: update status to `balance_paid`, send Resend confirmation emails
- Confirmation email to all hunters includes:
  - Hunt year and week
  - What to bring checklist (bow, arrows, license, etc.)
  - Cabin address: 1100 Apple Ave, Cumberland, Iowa
  - Chad's cell: 712-254-3999
  - Iowa DNR tag application reminder

---

## Email Confirmations (Resend)

### Deposit Confirmation Email
- To: all hunters in the group
- Subject: `"Your Williams Creek Whitetails Hunt is Reserved — 2027"`
- Design: dark themed HTML email, Williams Creek Whitetails wordmark
- Content:
  - Confirmation of deposit
  - Hunt year + week
  - Party summary
  - Meal package (if selected)
  - Total cost + deposit paid + balance due July 1
  - What's next (3 steps)
  - Chad's contact info
  - Iowa DNR tag link

### Balance Confirmation Email
- Subject: `"Balance Received — Williams Creek Whitetails 2027"`
- Content: full payment confirmation, hunt details, cabin address, arrival instructions

---

## Environment Variables

Add to `.env` and Cloudflare Dashboard:
```
HUNT_PASSWORD=HuntIowa2026
STRIPE_SECRET_KEY=sk_live_...          (can share with hedge site)
STRIPE_WEBHOOK_SECRET_HUNT=whsec_...   (separate webhook secret for hunt)
RESEND_API_KEY=re_...                  (can share with hedge site)
HUNT_NOTIFY_EMAIL=cchadww@gmail.com    (notify Chad on new reservation)
```

---

## File Structure

Create the following new files (do NOT modify existing hedge pages):

```
src/
  pages/
    hunt/
      index.astro                    ← Main about/landing page
      login.astro                    ← Password gate
      reserve/
        index.astro                  ← Reservation form
        confirmed.astro              ← Post-deposit confirmation
      final-payment/
        index.astro                  ← Balance payment form
        confirmed.astro              ← Post-payment confirmation
  api/
    hunt-reserve.ts                  ← POST: save reservation + create Stripe session
    hunt-balance.ts                  ← POST: create balance payment Stripe session
    webhooks/
      stripe-hunt.ts                 ← Stripe webhook handler for hunt
  lib/
    hunt-auth.ts                     ← Hunt session cookie helpers (separate from hedge auth)
    hunt-reservations.ts             ← HUNT_KV read/write helpers
  layouts/
    HuntLayout.astro                 ← Wraps all hunt pages: hunt nav, hunt theme, noindex meta
  components/hunt/
    HuntNav.astro                    ← Dark nav with WCW wordmark
    HuntHero.astro                   ← Reusable hero section component
    HuntFooter.astro                 ← Hunt-specific footer
    HuntGallery.astro                ← Masonry photo grid
    ReserveForm.astro                ← Multi-step reservation form
  middleware.ts                      ← UPDATE existing: add /hunt/* protection
```

---

## Image Placeholder Paths

Chad will supply final photos. Create with placeholder images at these paths:
```
public/hunt/images/
  hero.jpg                ← Full-bleed hero (dramatic timber/dawn hunting scene)
  cabin.jpg               ← Cabin/lodge photo
  cabin-wide.jpg          ← Wide crop of cabin
  gallery/
    buck-01.jpg through buck-12.jpg   ← Trail cam and harvest photos
  drone/
    aerial-01.mp4         ← Drone footage (referenced but not autoplay)
```

Use a dark brown gradient as placeholder background where images are missing, with centered white text reading `"[Photo: hero.jpg]"` etc. so Chad knows what to replace.

---

## Video Integration

- Drone videos go in `public/hunt/videos/`
- On the `/hunt` page, include a video section between Gallery and Hunt Details:
  - Section heading: `"See the Property"`
  - `<video>` element: controls, poster image, muted by default, NOT autoplay
  - Fallback text if video not supported
  - Styled to match dark theme with gold border accent

---

## Middleware Updates

Update `src/middleware.ts` to handle hunt auth separately from hedge admin auth:

```typescript
// Protect /hunt/* page routes only (not /api/* — APIs use Stripe signatures / separate auth).
if (pathname.startsWith('/hunt') && !pathname.startsWith('/hunt/login')) {
  // Validate hunt_session cookie
  // If invalid: redirect to /hunt/login
}
```

---

## Build Notes for Cursor

- The `/hunt` section must be completely visually isolated from the hedge site — no shared nav, no shared footer, no shared CSS classes that would bleed over
- Scope all hunt CSS to `.hunt-theme` class on the `<body>` or a wrapping `<div>` in `HuntLayout.astro`
- Tailwind: extend the theme in `tailwind.config.mjs` with hunt color tokens using CSS variables
- Google Fonts: add Playfair Display + Lora to `HuntLayout.astro` `<head>` only — not the main layout
- All `/hunt/*` pages must use `HuntLayout.astro`, not the main site layout
- Stripe: reuse existing Stripe secret key env var; create a new webhook endpoint and secret specifically for hunt payments to keep them separate from any future hedge payments
- Do NOT rebuild or modify any existing hedge pages
- Do NOT add hunt nav links to the main hedge website navigation
