import { describeNtfyEndpoint } from './ntfy';
import { getHuntKvFromLocals } from './hunt-kv';
import { getOrdersKvFromLocals } from './orders-kv';
import { getProductImagesBucketFromLocals } from './product-media';
import { getServerEnv } from './server-env';

function pickString(
  workerEnv: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const w = workerEnv?.[key];
  if (typeof w === 'string' && w.trim() !== '') return w.trim();
  return getServerEnv(key);
}

export type IntegrationDiagnostics = {
  ordersKvBound: boolean;
  huntKvBound: boolean;
  productImagesBound: boolean;
  calWebhookSecretSet: boolean;
  resendApiKeySet: boolean;
  stripeSecretKeySet: boolean;
  ntfyTopicOrUrlVarSet: boolean;
  ntfy: ReturnType<typeof describeNtfyEndpoint>;
};

/**
 * Non-secret snapshot of integration configuration (Worker bindings + presence of env keys).
 * Use from admin UI to verify production setup matches Cal.com / ntfy / Stripe / Resend.
 */
export function getIntegrationDiagnostics(locals: {
  runtime?: { env?: Record<string, unknown> };
}): IntegrationDiagnostics {
  const workerEnv = locals?.runtime?.env;
  return {
    ordersKvBound: Boolean(getOrdersKvFromLocals(locals)),
    huntKvBound: Boolean(getHuntKvFromLocals(locals)),
    productImagesBound: Boolean(getProductImagesBucketFromLocals(locals)),
    calWebhookSecretSet: Boolean(pickString(workerEnv, 'CAL_WEBHOOK_SECRET')),
    resendApiKeySet: Boolean(pickString(workerEnv, 'RESEND_API_KEY')),
    stripeSecretKeySet: Boolean(pickString(workerEnv, 'STRIPE_SECRET_KEY')),
    ntfyTopicOrUrlVarSet: Boolean(
      pickString(workerEnv, 'NTFY_TOPIC_URL') || pickString(workerEnv, 'NTFY_TOPIC')
    ),
    ntfy: describeNtfyEndpoint(workerEnv),
  };
}
