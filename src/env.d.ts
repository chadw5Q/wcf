/// <reference path="../.astro/types.d.ts" />
/// <reference types="@cloudflare/workers-types" />

interface ImportMetaEnv {
  readonly PUBLIC_GA_MEASUREMENT_ID?: string;
  readonly RESEND_API_KEY?: string;
  readonly ORDER_NOTIFICATION_EMAIL?: string;
  readonly RESEND_FROM?: string;
  readonly SITE_URL?: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly ADMIN_PASSWORD?: string;
  readonly ADMIN_SESSION_SECRET?: string;
  /** HMAC secret for Cal.com webhooks → /api/webhooks/cal-booking (same as Cal webhook “Secret”). */
  readonly CAL_WEBHOOK_SECRET?: string;
  /** ntfy topic name only (e.g. hedge-order); or use NTFY_TOPIC_URL for a full URL. */
  readonly NTFY_TOPIC?: string;
  readonly NTFY_TOPIC_URL?: string;
  /** Private topic: Bearer token (alias: NTFY_TOKEN, same as cal-ntfy-worker). */
  readonly NTFY_ACCESS_TOKEN?: string;
  readonly NTFY_TOKEN?: string;
  readonly NTFY_DISABLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    runtime?: {
      env: {
        ORDERS_KV?: KVNamespace;
        PRODUCT_IMAGES?: R2Bucket;
        ASSETS?: Fetcher;
      } & Record<string, unknown>;
      cf?: IncomingRequestCfProperties;
      caches?: CacheStorage;
      ctx?: {
        waitUntil: (promise: Promise<unknown>) => void;
        passThroughOnException: () => void;
        props: Record<string, unknown>;
      };
    };
  }
}
