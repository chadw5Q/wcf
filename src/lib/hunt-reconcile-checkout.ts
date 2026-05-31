import { handleHuntCheckoutSessionCompleted } from './hunt-stripe-webhook';
import { getCheckoutSession } from './stripe';

/**
 * After Stripe redirects back with `session_id`, confirm payment in KV and send hunt emails.
 * Idempotent with the webhook handler (safe if both run).
 */
export async function reconcileHuntCheckoutFromSessionId(
  sessionId: string | null | undefined,
  kv: KVNamespace | undefined
): Promise<void> {
  const id = sessionId?.trim();
  if (!id || !kv) return;

  try {
    const session = await getCheckoutSession(id);
    const result = await handleHuntCheckoutSessionCompleted(session, kv);
    console.log('[hunt-reconcile] session', id.slice(0, 24), result);
  } catch (err) {
    console.error('[hunt-reconcile] failed for session', id.slice(0, 24), err);
  }
}
