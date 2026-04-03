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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    runtime?: {
      env: {
        ORDERS_KV?: KVNamespace;
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
