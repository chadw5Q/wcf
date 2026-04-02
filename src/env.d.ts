/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_GA_MEASUREMENT_ID?: string;
  readonly RESEND_API_KEY?: string;
  readonly ORDER_NOTIFICATION_EMAIL?: string;
  readonly RESEND_FROM?: string;
  readonly SITE_URL?: string;
  readonly STRIPE_SECRET_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
