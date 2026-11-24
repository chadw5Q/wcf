import type { StoredOrder } from './order-types';
import { formatUsd } from './format-order';
import { escapeHtmlText } from './order-receipt-email';
import { pickupScheduleUrl } from './cal-pickup';
import { amountStillOwed, depositCredited, orderCategory } from './deposits';

export function buildOrderReadySubject(order: StoredOrder): string {
  const what = orderCategory(order) === 'staves' ? 'bow stave order' : 'hedge order';
  return `Your ${what} is ready for pickup — Southwest Iowa Hedge`;
}

/** "Your order is ready" email: items, deposit credited, amount due at pickup, scheduling link. */
export function buildOrderReadyHtml(order: StoredOrder): string {
  const first = order.customer.firstName?.trim() || order.customer.name.trim().split(/\s+/)[0] || 'there';
  const itemsHtml = order.items
    .filter((i) => i.quantity > 0)
    .map(
      (i) =>
        `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtmlText(i.product)}</td>
          <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">${i.quantity}</td>
        </tr>`
    )
    .join('');

  const credited = depositCredited(order);
  const owed = amountStillOwed(order);
  const scheduleUrl = pickupScheduleUrl(order.id);

  const depositLine =
    credited > 0
      ? `<p style="margin:4px 0;">Deposit received: −${escapeHtmlText(formatUsd(credited))}</p>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;">
  <div style="background-color:#16a34a;color:#ffffff;padding:20px;text-align:center;">
    <h1 style="margin:0;">Your order is ready</h1>
  </div>
  <div style="padding:20px;max-width:640px;">
    <p>Hi ${escapeHtmlText(first)},</p>
    <p>Good news: your order is cut and ready for pickup. Pick a time that works for you and we'll have it waiting.</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtmlText(scheduleUrl)}" style="background-color:#15803d;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Schedule your pickup</a>
    </p>
    <div style="background-color:#f9f9f9;padding:15px;border-radius:5px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;border-bottom:2px solid #ddd;font-size:0.85em;color:#555;">Item</th>
            <th style="text-align:right;border-bottom:2px solid #ddd;font-size:0.85em;color:#555;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 4px;">Order total: ${escapeHtmlText(formatUsd(order.discountedSubtotal))}</p>
      ${depositLine}
      <p style="margin:4px 0;font-weight:bold;font-size:1.15em;color:#16a34a;">Due at pickup: ${escapeHtmlText(formatUsd(owed))}</p>
    </div>
    <p>Questions? Just reply to this email or call 712-254-3999.</p>
    <p style="margin-top:24px;color:#666;font-size:0.9em;">— <a href="https://williamscreekfarms.com/" style="color:#15803d;">Southwest Iowa Hedge</a> · Williams Creek Farms</p>
  </div>
</body>
</html>`;
}
