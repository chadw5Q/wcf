import type { StoredOrder } from './order-types';
import { formatCentralDateTime, formatUsd } from './format-order';
import { getServerEnv } from './server-env';

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getOrderNotifyEmail(): string {
  return getServerEnv('ORDER_NOTIFICATION_EMAIL') || 'cchadww@gmail.com';
}

export function getResendFromAddress(): string {
  return (
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Southwest Iowa Hedge <onboarding@resend.dev>'
      : 'Southwest Iowa Hedge <orders@williamscreekfarms.com>')
  );
}

export function buildOrderReceiptSubject(order: StoredOrder): string {
  return `Order receipt — ${order.customer.name} — Southwest Iowa Hedge`;
}

/** HTML receipt for a stored order (customer + admin copy). */
export function buildOrderReceiptHtml(order: StoredOrder): string {
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtmlText(i.product)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${i.quantity}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${escapeHtmlText(formatUsd(i.unitPrice))}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${escapeHtmlText(formatUsd(i.lineTotal))}</td>
        </tr>`
    )
    .join('');

  const notesBlock = order.notes?.trim()
    ? `<div class="notes">
        <h2>Notes</h2>
        <p style="white-space:pre-wrap;">${escapeHtmlText(order.notes.trim())}</p>
      </div>`
    : '';

  const slotBlock = order.deliverySlot?.trim()
    ? `<p><strong>Delivery / pickup:</strong> ${escapeHtmlText(order.deliverySlot.trim())}</p>`
    : '';

  const discountBlock = order.volumeDiscount.applied
    ? `<p><strong>Volume discount (10%):</strong> −${escapeHtmlText(formatUsd(order.volumeDiscount.amount))}</p>`
    : '';

  const depositBlock = order.deposit.selected
    ? `<p><strong>Deposit selected at checkout:</strong> ${escapeHtmlText(formatUsd(order.depositAmount))}</p>
       <p><strong>Balance due (estimated):</strong> ${escapeHtmlText(formatUsd(order.balanceDue))}</p>`
    : `<p><strong>Deposit:</strong> Not selected at checkout</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #16a34a; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; max-width: 640px; }
    .customer-info { background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .order-details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .notes { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #6c757d; margin: 15px 0; }
    .total { font-weight: bold; font-size: 1.2em; color: #16a34a; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 0; border-bottom: 2px solid #ddd; font-size: 0.85em; color: #555; }
    th.num, td.num { text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Order receipt</h1>
    <p>Southwest Iowa Hedge</p>
  </div>
  <div class="content">
    <p><strong>Order ID:</strong> <code>${escapeHtmlText(order.id)}</code></p>
    <p><strong>Placed:</strong> ${escapeHtmlText(formatCentralDateTime(order.createdAt))} (Central)</p>
    <p><strong>Status:</strong> ${escapeHtmlText(order.status)}</p>
    ${slotBlock}

    <div class="customer-info">
      <h2>Customer</h2>
      <p><strong>Name:</strong> ${escapeHtmlText(order.customer.name)}</p>
      <p><strong>Email:</strong> ${escapeHtmlText(order.customer.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtmlText(order.customer.phone || '—')}</p>
    </div>

    <div class="order-details">
      <h2>Line items</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Line</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      <p style="margin-top:16px;"><strong>Subtotal:</strong> ${escapeHtmlText(formatUsd(order.subtotal))}</p>
      ${discountBlock}
      <p class="total">Order total: ${escapeHtmlText(formatUsd(order.discountedSubtotal))}</p>
      ${depositBlock}
    </div>

    ${notesBlock}

    <p style="margin-top:24px;color:#666;font-size:0.9em;">— Southwest Iowa Hedge · 712-254-3999</p>
  </div>
</body>
</html>`;
}
