import type { OrderReviewRequest, StoredOrder } from './order-types';

/** Orders fulfilled before this instant are never auto-queued (backfill guard). */
export const REVIEW_FEATURE_START = '2026-08-06T00:00:00.000Z';

export const REVIEW_ASK_DELAY_DAYS = 14;
export const REVIEW_NUDGE_DELAY_DAYS = 7;
export const REVIEW_SEND_BATCH_CAP = 25;
export const REVIEW_PENDING_DIGEST_HOURS = 24;

export type ReviewSendKind = 'ask' | 'nudge';

export type ReviewSendJob = {
  orderId: string;
  kind: ReviewSendKind;
};

export type SelectReviewSendJobsResult = {
  jobs: ReviewSendJob[];
  /** How many eligible jobs were left after applying the batch cap. */
  remainingEligible: number;
  totalEligible: number;
};

function addUtcDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function reviewQueuedForFromFulfilledAt(fulfilledAt: Date): string {
  return addUtcDays(fulfilledAt, REVIEW_ASK_DELAY_DAYS).toISOString();
}

/**
 * When an order becomes fulfilled on/after REVIEW_FEATURE_START, attach a review ask
 * due in 14 days. No-op if already queued or before the feature start.
 * Returns true when `reviewRequest` was written.
 */
export function attachReviewRequestOnFulfilled(
  order: StoredOrder,
  now: Date = new Date()
): boolean {
  if (order.status !== 'fulfilled') return false;
  if (order.reviewRequest?.queuedFor) return false;
  if (now.getTime() < new Date(REVIEW_FEATURE_START).getTime()) return false;

  const next: OrderReviewRequest = {
    queuedFor: reviewQueuedForFromFulfilledAt(now),
  };
  order.reviewRequest = next;
  return true;
}

export function isEligibleForReviewAsk(order: StoredOrder, now: Date): boolean {
  const rr = order.reviewRequest;
  if (!rr?.queuedFor) return false;
  if (rr.sentAt || rr.respondedAt || rr.suppressedAt) return false;
  return new Date(rr.queuedFor).getTime() <= now.getTime();
}

export function isEligibleForReviewNudge(order: StoredOrder, now: Date): boolean {
  const rr = order.reviewRequest;
  if (!rr?.sentAt) return false;
  if (rr.nudgedAt || rr.respondedAt || rr.suppressedAt) return false;
  const due = addUtcDays(new Date(rr.sentAt), REVIEW_NUDGE_DELAY_DAYS);
  return due.getTime() <= now.getTime();
}

/**
 * Select Ask 1 and nudge sends for this cron run. Inject `now` for deterministic tests.
 * Asks (oldest due first) then nudges (oldest sent first), capped at `cap`.
 */
export function selectReviewSendJobs(
  orders: StoredOrder[],
  now: Date,
  cap: number = REVIEW_SEND_BATCH_CAP
): SelectReviewSendJobsResult {
  const asks = orders
    .filter((o) => isEligibleForReviewAsk(o, now))
    .sort((a, b) =>
      (a.reviewRequest!.queuedFor!).localeCompare(b.reviewRequest!.queuedFor!)
    )
    .map((o) => ({ orderId: o.id, kind: 'ask' as const }));

  const nudges = orders
    .filter((o) => isEligibleForReviewNudge(o, now))
    .sort((a, b) => (a.reviewRequest!.sentAt!).localeCompare(b.reviewRequest!.sentAt!))
    .map((o) => ({ orderId: o.id, kind: 'nudge' as const }));

  const all = [...asks, ...nudges];
  const jobs = all.slice(0, Math.max(0, cap));
  return {
    jobs,
    remainingEligible: Math.max(0, all.length - jobs.length),
    totalEligible: all.length,
  };
}

/** True when a review has been sitting in `new` longer than the digest threshold. */
export function isStalePendingReview(
  createdAt: string,
  now: Date,
  hours: number = REVIEW_PENDING_DIGEST_HOURS
): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created >= hours * 60 * 60 * 1000;
}
