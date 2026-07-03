# Southwest Iowa Hedge - Hedge Post Website

A modern, responsive website for Southwest Iowa Hedge built with Astro, featuring ecommerce functionality with Stripe integration and a content management system.

## Features

- **Responsive Design**: Mobile-first design with Tailwind CSS
- **Ecommerce**: Stripe integration for secure payments
- **CMS**: Content management system for products and pages
- **SEO Optimized**: Built-in sitemap and meta tags
- **Performance**: Fast loading with Astro's static site generation
- **Accessibility**: WCAG compliant design

## Pages

- **Home**: Landing page with hero section and featured products
- **Hedge Posts**: Product catalog with filtering and shopping cart
- **Contact**: Contact form and business information
- **Success**: Order confirmation page

## Tech Stack

- **Framework**: Astro 5.x
- **Styling**: Tailwind CSS
- **Ecommerce**: Stripe
- **Content**: Astro Content Collections
- **Language**: TypeScript
- **Deployment**: Ready for Vercel, Netlify, or any static hosting

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Stripe account (for payments)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hedge_website_astro
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
   STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
   SITE_URL=http://localhost:4321
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:4321`

## SEO

The site sets unique **meta descriptions**, **canonical URLs**, **Open Graph / Twitter** tags (with images), and **JSON-LD** (`LocalBusiness` on every page; **Product** schema on the homepage for each post type). `/success` uses `noindex` after checkout.

**Google Business Profile** is not part of this repo—create or claim your listing at [Google Business Profile](https://business.google.com) for “near me” and map visibility.

**Google Analytics 4:** set `PUBLIC_GA_MEASUREMENT_ID=G-…` in `.env` (local) or Cloudflare Worker **Variables** (plain text, not secret). Order inquiries redirect to **`/thank-you?kind=inquiry`** (events: `order_inquiry_thank_you`, `generate_lead`). Stripe deposits land on **`/success`** (events: `deposit_payment_complete` or `checkout_success`). In GA4, mark those events or page paths as conversions.

## Configuration

### Stripe Setup

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get your API keys from the Stripe Dashboard
3. Update the environment variables with your keys
4. For production, use live keys instead of test keys

### Content Management

The website uses Astro's Content Collections for managing:

- **Products**: Located in `src/content/products/`
- **Blog Posts**: Located in `src/content/blog/`
- **Pages**: Located in `src/content/pages/`

### Customization

#### Colors and Branding
Update the color scheme in `src/styles/global.css`:
```css
:root {
  --color-primary: 34 139 34;    /* Green */
  --color-secondary: 139 69 19;  /* Brown */
  --color-accent: 255 215 0;     /* Gold */
}
```

#### Site Configuration
Update site settings in `astro.config.mjs`:
```javascript
export default defineConfig({
  site: 'https://williamscreekfarms.com',
  // ... other config
});
```

## Deployment

### Cloudflare Workers (this repo)

Deploy with `npm run deploy` (build + `wrangler deploy`). **API routes do not read your local `.env`** — set production configuration in Wrangler.

**Required secret for order emails** (order form → `/api/send-order-email`):

```bash
npx wrangler secret put RESEND_API_KEY
```

Paste your Resend API key when prompted. Also verify your sending domain at [resend.com/domains](https://resend.com/domains), then optionally set:

```bash
npx wrangler secret put RESEND_FROM
# e.g. Southwest Iowa Hedge <orders@williamscreekfarms.com>
npx wrangler secret put ORDER_NOTIFICATION_EMAIL
# inbox for order notifications (optional; code has a default)
```

**Required for “10% deposit” + Stripe Checkout** (without this, deposit payments return an error):

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

Use your **live** secret key (`sk_live_…`) for production; test keys only work in dev. Order inquiries without a deposit do not need Stripe.

`SITE_URL` for Stripe success/cancel redirects is in `wrangler.jsonc` → `vars` (currently `https://williamscreekfarms.com`).

You can also add secrets in the [Cloudflare dashboard](https://dash.cloudflare.com) → Workers & Pages → your worker → Settings → Variables and secrets.

### Hunt reservations KV (`HUNT_KV`)

Williams Creek Whitetails (`/hunt`) stores reservation JSON in a **separate** KV namespace from `ORDERS_KV`.

1. Create a namespace (pick your own title; the binding name in code is always `HUNT_KV`):

   ```bash
   npx wrangler kv namespace create WCW_HUNT_RESERVATIONS
   ```

2. Copy the **id** from the command output (or from **Workers & Pages** → **KV**) into `wrangler.jsonc` → `kv_namespaces` for the `HUNT_KV` entry. Replace the placeholder `id` if the repo still ships a dummy value.

3. Redeploy (`npm run deploy`). Local `astro dev` does not attach Worker bindings unless you use `wrangler dev` / preview wiring—see the [Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) docs.

Admin **Integrations** (`/admin/integrations`) shows whether `HUNT_KV` is bound in the deployed Worker.

**Hunt deposit flow (Stripe + Resend):** `/hunt/reserve` posts to `POST /api/hunt-reserve`, which creates a Checkout Session and redirects the hunter to Stripe. Configure a **second** webhook endpoint in Stripe for hunt deposits only: subscriber URL `https://<your-site>/api/webhooks/stripe-hunt`, event `checkout.session.completed`, and store the signing secret as **`STRIPE_WEBHOOK_SECRET_HUNT`** (`npx wrangler secret put STRIPE_WEBHOOK_SECRET_HUNT`). Optional **`HUNT_NOTIFY_EMAIL`** receives an internal heads-up when a deposit clears (uses the same Resend credentials as orders).

**Hunt balance (Phase 6):** `/hunt/final-payment` posts to `POST /api/hunt-balance`. The same Stripe webhook (`/api/webhooks/stripe-hunt`) handles **both** deposit and balance sessions; distinguish them in the Stripe Dashboard via Checkout Session metadata (`hunt_checkout_kind`: `deposit` vs `balance`).

**Hunt manual QA (Stripe test mode):** Log in at `/hunt/login` → reserve flow (`/hunt/reserve`) → complete Checkout → confirm `/api/webhooks/stripe-hunt` receives `checkout.session.completed` (deposit) → Resend deposit mail → final payment (`/hunt/final-payment`) → balance webhook → balance mail. Confirm `public/robots.txt` disallows `/hunt`, sitemap excludes `/hunt`, and view-source on `/hunt` shows `noindex,nofollow`.

**Optional Playwright (`npm run test:e2e`):** `tests/e2e/hunt-flow.spec.ts` always checks that `POST /api/hunt-reserve` and `POST /api/hunt-balance` are **not** hunt-session gated. To also run the login → reserve UI step, export **`HUNT_E2E_PASSWORD`** to match **`HUNT_PASSWORD`** (or the dev default if unset locally).

### Vercel (Recommended)

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

### Netlify

1. Build the project:
   ```bash
   npm run build
   ```

2. Deploy the `dist` folder to Netlify

### Other Platforms

The site can be deployed to any static hosting platform:
- GitHub Pages
- AWS S3 + CloudFront
- Firebase Hosting
- etc.

## Project Structure

```
hedge_website_astro/
├── public/                 # Static assets
├── src/
│   ├── components/         # Reusable components
│   ├── content/           # CMS content
│   ├── layouts/           # Page layouts
│   ├── lib/              # Utility functions
│   ├── pages/            # Route pages
│   ├── styles/           # Global styles
│   └── types/            # TypeScript types
├── astro.config.mjs      # Astro configuration
├── package.json          # Dependencies
└── README.md            # This file
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run astro` - Run Astro CLI commands

### Adding New Pages

1. Create a new `.astro` file in `src/pages/`
2. Import the Layout component
3. Add your content

Example:
```astro
---
import Layout from '../layouts/Layout.astro';
---

<Layout title="Page Title">
  <!-- Your content here -->
</Layout>
```

### Adding New Products

1. Add product data to `src/content/products/hedge-plants.json`
2. Follow the schema defined in `src/content/config.ts`
3. The products will automatically appear on the hedge posts page

### Styling

The project uses Tailwind CSS. Custom styles can be added to:
- `src/styles/global.css` for global styles
- Component-specific styles in individual `.astro` files

## Ecommerce Features

### Shopping Cart
- Client-side cart management
- Product filtering by category
- Quantity controls
- Real-time total calculation

### Stripe Integration
- Secure payment processing
- Checkout session creation
- Order confirmation
- Success/failure handling

### Product Management
- Product catalog with images
- Detailed product information
- Stock status tracking
- Category filtering

## SEO Features

- Automatic sitemap generation
- Meta tags for social sharing
- Open Graph tags
- Canonical URLs
- Structured data (ready for implementation)

## Performance

- Static site generation
- Optimized images
- Minimal JavaScript
- Fast loading times
- Mobile-optimized

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support or questions:
- Email: cchadww@gmail.com
- Phone: 712-254-3999

## Future Enhancements

- [ ] Blog functionality
- [ ] User accounts
- [ ] Order tracking
- [ ] Email notifications
- [ ] Advanced product filtering
- [ ] Wishlist functionality
- [ ] Reviews and ratings
- [ ] Related products
- [ ] Search functionality
- [ ] Analytics integration
