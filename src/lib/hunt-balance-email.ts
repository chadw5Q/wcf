import { Resend } from 'resend';
import { IOWA_DNR_DEER_URL } from './hunt-landing-content';
import { getWeekLabel } from './hunt-weeks';
import type { HuntReservation } from './hunt-reservations';
import { getServerEnv } from './server-env';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHuntBalanceEmailHtml(r: HuntReservation): string {
  const weekLabel = getWeekLabel(r.huntYear, r.preferredWeek) ?? r.preferredWeek;
  const party = r.hunters
    .map((h) => `${escapeHtml(h.firstName)} ${escapeHtml(h.lastName)} (${escapeHtml(h.email)})`)
    .join('<br/>');
  const meal = r.mealPackage ? 'Yes — all-inclusive meals' : 'No — self-catered';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" />
<style>
  body { margin:0; background:#1a1410; color:#f0e6d3; font-family: Georgia, 'Lora', serif; line-height:1.6; }
  .wrap { max-width:560px; margin:0 auto; padding:24px; }
  h1 { font-size:22px; color:#c9a84c; margin:0 0 12px; }
  .gold { color:#c9a84c; }
  a { color:#e8c97a; }
  .box { background:#2a1f16; border:1px solid #4a3a28; border-radius:8px; padding:16px; margin:16px 0; }
</style>
</head>
<body>
  <div class="wrap">
    <p class="gold" style="font-size:18px;font-weight:600;">Williams Creek Whitetails</p>
    <h1>Balance received — you&apos;re paid in full</h1>
    <p>Thank you. We&apos;ve recorded your final hunt payment.</p>
    <div class="box">
      <p><strong class="gold">Hunt year:</strong> ${escapeHtml(String(r.huntYear))}</p>
      <p><strong class="gold">Preferred week:</strong> ${escapeHtml(weekLabel)}</p>
      <p><strong class="gold">Party:</strong><br/>${party}</p>
      <p><strong class="gold">Meal package:</strong> ${meal}</p>
      <p><strong class="gold">Total hunt cost:</strong> $${r.totalHuntCost.toLocaleString('en-US')}</p>
      <p><strong class="gold">Deposit paid:</strong> $${r.totalDeposit.toLocaleString('en-US')}</p>
      <p><strong class="gold">Balance paid:</strong> $${r.balanceDue.toLocaleString('en-US')}</p>
    </div>
    <p><strong class="gold">What to bring:</strong> bow, arrows, Iowa deer license and tag (apply through Iowa DNR), clothing for late October / November.</p>
    <p><strong class="gold">Cabin:</strong> 1100 Apple Ave, Cumberland, Iowa</p>
    <p><strong class="gold">Arrival:</strong> Sunday after 2pm of your hunt week. Depart Saturday by noon.</p>
    <p><strong class="gold">Chad&apos;s cell:</strong> <a href="tel:+17122543999">712-254-3999</a></p>
    <p><a href="${escapeHtml(IOWA_DNR_DEER_URL)}">Iowa DNR deer tag information →</a></p>
    <p style="margin-top:24px;font-size:12px;color:#9a8a78;">Williams Creek Whitetails — Private hunt</p>
  </div>
</body>
</html>`;
}

export function huntBalanceEmailSubject(r: HuntReservation): string {
  return `Balance Received — Williams Creek Whitetails ${r.huntYear}`;
}

export async function sendHuntBalanceConfirmationEmails(r: HuntReservation): Promise<void> {
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey?.trim()) {
    console.warn('[hunt-email] RESEND_API_KEY missing; skipping balance confirmation emails');
    return;
  }
  const fromAddress =
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Williams Creek Whitetails <onboarding@resend.dev>'
      : 'Williams Creek Whitetails <cchadww@gmail.com>');
  const html = buildHuntBalanceEmailHtml(r);
  const subject = huntBalanceEmailSubject(r);
  const resend = new Resend(apiKey);

  for (const h of r.hunters) {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: h.email,
      subject,
      html,
    });
    if (error) {
      console.error('[hunt-email] Balance Resend error for', h.email, error);
    }
  }
}
