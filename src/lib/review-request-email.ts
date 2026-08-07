import { Resend } from 'resend';
import { getOrderNotifyEmail, getResendFromAddress } from './order-receipt-email';
import type { StoredOrder } from './order-types';
import { createReviewToken, reviewAbsoluteUrl } from './review-token';
import { getServerEnv } from './server-env';

export function siteBaseForReviews(): string {
  return (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
}

export function buildReviewAskSubject(order: StoredOrder): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'there';
  return `How are the posts working for you, ${first}?`;
}

export function buildReviewAskText(order: StoredOrder, starUrls: string[]): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'there';
  const lines = [
    `Hi ${first},`,
    '',
    'Thanks again for making the drive out for your posts. Quick favor: how are the posts working for you?',
    '',
  ];
  for (let i = 0; i < 5; i++) {
    const url = starUrls[i];
    if (url) lines.push(`★ ${i + 1} star${i === 0 ? '' : 's'}: ${url}`);
  }
  lines.push(
    '',
    "One tap is plenty. If you have a minute to say more, there's a box on the next page, and you can add a picture of the fence if you've set them.",
    '',
    'Thanks,',
    'Chad',
    'Williams Creek Farms'
  );
  return lines.join('\n');
}

export function buildReviewNudgeSubject(order: StoredOrder): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'there';
  return `Quick reminder, ${first} — how are the posts working?`;
}

export function buildReviewNudgeText(order: StoredOrder, starUrls: string[]): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'there';
  const lines = [
    `Hi ${first},`,
    '',
    'Just a short follow-up — if you have a second, how are the posts working for you?',
    '',
  ];
  for (let i = 0; i < 5; i++) {
    const url = starUrls[i];
    if (url) lines.push(`★ ${i + 1} star${i === 0 ? '' : 's'}: ${url}`);
  }
  lines.push('', 'Thanks,', 'Chad', 'Williams Creek Farms');
  return lines.join('\n');
}

export async function sendReviewRequestEmail(opts: {
  order: StoredOrder;
  kind: 'ask' | 'nudge';
  secret?: string;
}): Promise<boolean> {
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey?.trim()) {
    console.warn('[review-email] RESEND_API_KEY missing; skipping');
    return false;
  }
  const email = opts.order.customer.email?.trim();
  if (!email) {
    console.warn('[review-email] order missing email', opts.order.id);
    return false;
  }

  const token = await createReviewToken(opts.order.id, opts.secret);
  const base = siteBaseForReviews();
  const starUrls = [1, 2, 3, 4, 5].map((r) => reviewAbsoluteUrl(base, token, r));

  const subject =
    opts.kind === 'nudge' ? buildReviewNudgeSubject(opts.order) : buildReviewAskSubject(opts.order);
  const text =
    opts.kind === 'nudge'
      ? buildReviewNudgeText(opts.order, starUrls)
      : buildReviewAskText(opts.order, starUrls);

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to: email,
    subject,
    text,
  });
  if (error) {
    console.error('[review-email] Resend error', email, error);
    return false;
  }
  console.log('[review-email] sent', opts.kind, opts.order.id, email);
  return true;
}

export async function sendPendingReviewsDigestEmail(opts: {
  pendingCount: number;
  adminUrl: string;
}): Promise<boolean> {
  if (opts.pendingCount <= 0) return false;
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey?.trim()) {
    console.warn('[review-email] RESEND_API_KEY missing; skipping digest');
    return false;
  }
  const to = getOrderNotifyEmail();
  const resend = new Resend(apiKey);
  const n = opts.pendingCount;
  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: `${n} review${n === 1 ? '' : 's'} waiting for approval`,
    text: [
      `${n} review${n === 1 ? ' is' : 's are'} waiting for approval (sitting in new for over 24 hours).`,
      '',
      opts.adminUrl,
      '',
      '— Williams Creek Farms review cron',
    ].join('\n'),
  });
  if (error) {
    console.error('[review-email] digest Resend error', to, error);
    return false;
  }
  return true;
}
