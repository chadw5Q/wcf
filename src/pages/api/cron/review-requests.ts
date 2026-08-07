import type { APIRoute } from 'astro';
import { publishNtfyNotification } from '../../../lib/ntfy';
import { getAllOrders, getOrder, saveOrder } from '../../../lib/orders';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import {
  isStalePendingReview,
  selectReviewSendJobs,
  type ReviewSendJob,
} from '../../../lib/review-queue';
import {
  sendPendingReviewsDigestEmail,
  sendReviewRequestEmail,
  siteBaseForReviews,
} from '../../../lib/review-request-email';
import { getAllReviews } from '../../../lib/reviews';
import { getReviewsKvFromLocals } from '../../../lib/reviews-kv';
import { getServerEnv } from '../../../lib/server-env';

export const prerender = false;

function timingSafeEqualStr(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}

function cronSecretOk(header: string | null): boolean {
  const expected = getServerEnv('CRON_SHARED_SECRET')?.trim();
  if (!expected) return false;
  return timingSafeEqualStr(header?.trim() || '', expected);
}

export type ProcessReviewCronResult = {
  asksSent: number;
  nudgesSent: number;
  failed: number;
  remainingEligible: number;
  digestSent: boolean;
  pendingStale: number;
};

/**
 * Core cron logic — exported for unit tests. Pass `now` and optional email/ntfy hooks.
 */
export async function processReviewRequestCron(opts: {
  ordersKv: KVNamespace;
  reviewsKv?: KVNamespace;
  now?: Date;
  sendEmail?: typeof sendReviewRequestEmail;
  sendDigest?: typeof sendPendingReviewsDigestEmail;
  notify?: typeof publishNtfyNotification;
  workerEnv?: Record<string, unknown>;
}): Promise<ProcessReviewCronResult> {
  const now = opts.now ?? new Date();
  const sendEmail = opts.sendEmail ?? sendReviewRequestEmail;
  const sendDigest = opts.sendDigest ?? sendPendingReviewsDigestEmail;
  const notify = opts.notify ?? publishNtfyNotification;

  const orders = await getAllOrders(opts.ordersKv);
  const { jobs, remainingEligible } = selectReviewSendJobs(orders, now);

  let asksSent = 0;
  let nudgesSent = 0;
  let failed = 0;

  for (const job of jobs) {
    const ok = await runOneSend(opts.ordersKv, job, now, sendEmail);
    if (!ok) {
      failed += 1;
      continue;
    }
    if (job.kind === 'ask') asksSent += 1;
    else nudgesSent += 1;
  }

  let pendingStale = 0;
  let digestSent = false;
  if (opts.reviewsKv) {
    const reviews = await getAllReviews(opts.reviewsKv);
    pendingStale = reviews.filter(
      (r) => r.state === 'new' && isStalePendingReview(r.createdAt, now)
    ).length;
    if (pendingStale > 0) {
      digestSent = await sendDigest({
        pendingCount: pendingStale,
        adminUrl: `${siteBaseForReviews()}/admin/reviews`,
      });
    }
  }

  const parts = [
    `${asksSent} review request${asksSent === 1 ? '' : 's'} sent`,
    `${nudgesSent} nudge${nudgesSent === 1 ? '' : 's'}`,
  ];
  if (remainingEligible > 0) parts.push(`${remainingEligible} remaining (capped)`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (pendingStale > 0) parts.push(`${pendingStale} pending approval`);

  await notify({
    title: 'Review cron',
    message: parts.join(', '),
    click: `${siteBaseForReviews()}/admin/reviews`,
    tags: 'email',
    workerEnv: opts.workerEnv,
  });

  return { asksSent, nudgesSent, failed, remainingEligible, digestSent, pendingStale };
}

async function runOneSend(
  ordersKv: KVNamespace,
  job: ReviewSendJob,
  now: Date,
  sendEmail: typeof sendReviewRequestEmail
): Promise<boolean> {
  const order = await getOrder(ordersKv, job.orderId);
  if (!order?.reviewRequest) return false;

  const nowIso = now.toISOString();
  const stampKey = job.kind === 'ask' ? 'sentAt' : 'nudgedAt';

  // Stamp before Resend so a crash mid-send does not double-email; clear on failure to retry.
  order.reviewRequest = {
    ...order.reviewRequest,
    [stampKey]: nowIso,
  };
  order.updatedAt = nowIso;
  await saveOrder(ordersKv, order);

  const ok = await sendEmail({ order, kind: job.kind });
  if (!ok) {
    const fresh = await getOrder(ordersKv, job.orderId);
    if (fresh?.reviewRequest) {
      const next = { ...fresh.reviewRequest };
      delete next[stampKey];
      fresh.reviewRequest = next;
      fresh.updatedAt = new Date().toISOString();
      await saveOrder(ordersKv, fresh);
    }
    return false;
  }
  return true;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!cronSecretOk(request.headers.get('X-Cron-Secret'))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ordersKv = getOrdersKvFromLocals(locals);
  if (!ordersKv) {
    return new Response(JSON.stringify({ error: 'ORDERS_KV is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reviewsKv = getReviewsKvFromLocals(locals);
  const result = await processReviewRequestCron({
    ordersKv,
    reviewsKv,
    workerEnv: locals.runtime?.env as Record<string, unknown> | undefined,
  });

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
