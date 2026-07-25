import { Resend } from 'resend';
import { getServerEnv } from './server-env';
import type { HuntHunter, HuntReservation } from './hunt-reservations';
import { huntPortalAbsoluteUrl } from './hunt-portal-token';
import { getWeekLabel } from './hunt-weeks';

export async function sendHuntPortalLinkEmail(opts: {
  reservation: HuntReservation;
  hunter: HuntHunter;
  hunterIndex: number;
  portalUrl: string;
}): Promise<boolean> {
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey?.trim()) {
    console.warn('[hunt-portal] RESEND_API_KEY missing; skipping portal email');
    return false;
  }
  const fromAddress =
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Williams Creek Whitetails <onboarding@resend.dev>'
      : 'Williams Creek Whitetails <cchadww@gmail.com>');
  const resend = new Resend(apiKey);
  const name = `${opts.hunter.firstName} ${opts.hunter.lastName}`.trim();
  const weekLabel =
    getWeekLabel(opts.reservation.huntYear, opts.reservation.preferredWeek) ??
    opts.reservation.preferredWeek;
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.hunter.email,
    subject: `Your Williams Creek Whitetails guest portal — ${opts.reservation.huntYear}`,
    text: [
      `Hi ${opts.hunter.firstName},`,
      '',
      `Your guest portal is ready for your ${opts.reservation.huntYear} hunt (${weekLabel}).`,
      '',
      'Use this private link to:',
      '• Sign the liability release',
      '• Then pay your deposit and remaining balance (due July 1) via Venmo or bank/card',
      '• Read Know Before You Go',
      '',
      opts.portalUrl,
      '',
      'Questions? Call or text Chad at 712-254-3999.',
      '',
      '— Williams Creek Whitetails',
    ].join('\n'),
  });
  if (error) {
    console.error('[hunt-portal] Resend error', opts.hunter.email, error);
    return false;
  }
  console.log('[hunt-portal] Portal link sent to', name, opts.hunter.email);
  return true;
}

export function siteBaseUrl(): string {
  return (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(/\/+$/, '');
}

export { huntPortalAbsoluteUrl };
