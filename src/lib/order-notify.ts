/**
 * "New order" admin email, customer pickup email, and ntfy push for hedge orders.
 *
 * Inquiry and Venmo orders notify as soon as they are submitted (no processor to wait on).
 * Card and ACH deposits notify only after Stripe reports the checkout (see order-checkout.ts),
 * so abandoned or declined checkouts never look like real orders.
 */
import { Resend } from 'resend';
import { pickupScheduleUrl } from './cal-pickup';
import {
  HEDGE_VENMO_HANDLE,
  hedgeDepositChargeUsd,
  hedgePayRailLabel,
  hedgeVenmoNote,
} from './hedge-deposit';
import type { DepositPayRail } from './order-types';
import {
  buildStoredOrder,
  summarizeItemsForNtfy,
  type BuildOrderInput,
  type OrderSkuMap,
} from './orders';
import { ORDER_CHECKOUT_KEYS, getProductsConfig, orderSkusToMap } from './products-config';
import { getServerEnv } from './server-env';
import { publishNtfyNotification } from './ntfy';

/**
 * - inquiry: no deposit
 * - venmo: deposit promised by Venmo (unverified)
 * - paid: Stripe confirmed the card or ACH deposit
 * - ach_processing: ACH authorized at Checkout, bank has not cleared it yet
 */
export type OrderNotifyStage = 'inquiry' | 'venmo' | 'paid' | 'ach_processing';

export interface OrderNotifyCustomer {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  message?: unknown;
}

export interface OrderNotifyInput {
  customerInfo: OrderNotifyCustomer;
  quantities: Record<string, unknown>;
  stage: OrderNotifyStage;
  /** 10% deposit before any processor fee. Ignored for inquiries. */
  depositAmount?: number;
  /** Card or ACH for Stripe stages; ignored otherwise. */
  payRail?: DepositPayRail | null;
  orderId?: string;
  /** Total the browser computed, only used to flag a mismatch in the admin email. */
  clientOrderTotal?: unknown;
  /** What Stripe actually collected (fee included), when known. */
  chargedUsd?: number;
}

export type OrderNotifyResult =
  | { ok: true; emailId?: string; customerEmailId?: string }
  | { ok: false; status: number; error: string; details?: string };

export interface OrderNotifyContext {
  kv?: KVNamespace;
  workerEnv?: Record<string, unknown>;
}

function computeOrderTotals(quantities: Record<string, unknown>, skuMap: OrderSkuMap) {
  const q = {
    premiumLine: Number(quantities.premiumLine) || 0,
    premiumCorner: Number(quantities.premiumCorner) || 0,
    regularLine: Number(quantities.regularLine) || 0,
    regularCorner: Number(quantities.regularCorner) || 0,
    discountBin: Number(quantities.discountBin) || 0,
    bowStave: Number(quantities.bowStave) || 0,
  };

  let subtotal = 0;
  for (const k of ORDER_CHECKOUT_KEYS) {
    subtotal += q[k] * skuMap[k].unitPrice;
  }

  const postCount =
    q.premiumLine + q.premiumCorner + q.regularLine + q.regularCorner + q.discountBin;
  const hasVolumeDiscount = postCount >= 100;
  const discountAmount = hasVolumeDiscount ? subtotal * 0.1 : 0;
  const finalTotal = subtotal - discountAmount;

  return { q, subtotal, hasVolumeDiscount, discountAmount, finalTotal };
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCustomerThankYouHtml(firstName: string, scheduleUrl: string): string {
  const nameEsc = escapeHtmlText(firstName.trim() || 'there');
  const urlEsc = escapeHtmlText(scheduleUrl);
  const intro = `<p>Hi ${nameEsc},</p>
    <p>Thank you for your order--it was received. Please choose your <strong>pickup</strong> day and time at this link:</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .content { padding: 20px; max-width: 560px; }
    a { color: #15803d; }
  </style>
</head>
<body>
  <div class="content">
    ${intro}
    <p><a href="${urlEsc}">${urlEsc}</a></p>
    <p>Need a different day? Text Chad at <a href="tel:+17122543999">712-254-3999</a>.</p>
    <p style="margin-top:24px;color:#666;font-size:0.9em;">— Southwest Iowa Hedge</p>
  </div>
</body>
</html>`;
}

function headerTitle(stage: OrderNotifyStage): string {
  switch (stage) {
    case 'venmo':
      return 'Deposit coming by Venmo';
    case 'paid':
      return 'Deposit paid';
    case 'ach_processing':
      return 'Bank deposit submitted, not cleared yet';
    default:
      return 'New order inquiry';
  }
}

function adminSubject(stage: OrderNotifyStage, name: string): string {
  switch (stage) {
    case 'paid':
      return `Deposit paid: new Hedge Post order — ${name}`;
    case 'ach_processing':
      return `Bank deposit pending: new Hedge Post order — ${name}`;
    case 'venmo':
      return `New Hedge Post deposit — ${name}`;
    default:
      return `New Hedge Post order inquiry — ${name}`;
  }
}

function ntfyTitleFor(stage: OrderNotifyStage, name: string): string {
  switch (stage) {
    case 'paid':
      return `New order, deposit paid: ${name}`;
    case 'ach_processing':
      return `New order, bank deposit pending: ${name}`;
    case 'venmo':
      return `New order, Venmo deposit (unverified): ${name}`;
    default:
      return `New order: ${name}`;
  }
}

export async function sendOrderNotifications(
  input: OrderNotifyInput,
  ctx: OrderNotifyContext = {}
): Promise<OrderNotifyResult> {
  const productsConfig = await getProductsConfig(ctx.kv);
  const skuMap = orderSkusToMap(productsConfig.orderSkus);

  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: 'Email is not configured',
      details:
        'RESEND_API_KEY is missing. For local dev: copy .env.example to .env and add your key. For production: set a Wrangler secret.',
    };
  }

  const notifyTo = getServerEnv('ORDER_NOTIFICATION_EMAIL') || 'cchadww@gmail.com';
  // Local dev: Resend only allows unverified domains via onboarding@resend.dev (see Resend test-email docs).
  // Production: verify your domain at resend.com/domains or set RESEND_FROM to a verified sender.
  const fromAddress =
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Southwest Iowa Hedge <onboarding@resend.dev>'
      : 'Southwest Iowa Hedge <orders@williamscreekfarms.com>');

  const { customerInfo, quantities, stage } = input;
  const isDeposit = stage !== 'inquiry';
  const payRail: DepositPayRail =
    stage === 'venmo' ? 'venmo' : input.payRail === 'ach' ? 'ach' : 'card';
  const depositUsd = isDeposit ? Number(input.depositAmount) || 0 : 0;
  const chargeUsd = isDeposit
    ? input.chargedUsd != null && Number.isFinite(input.chargedUsd)
      ? input.chargedUsd
      : hedgeDepositChargeUsd(depositUsd, payRail)
    : 0;
  const orderIdStr = input.orderId?.trim() || '';

  const firstName = String(customerInfo?.firstName ?? '');
  const lastName = String(customerInfo?.lastName ?? '');
  const email = String(customerInfo?.email ?? '');
  const phone = String(customerInfo?.phone ?? '');

  if (!firstName || !lastName || !email) {
    return { ok: false, status: 400, error: 'Missing customer name or email' };
  }

  if (!quantities || typeof quantities !== 'object') {
    return { ok: false, status: 400, error: 'Missing order quantities' };
  }

  const { q, subtotal, hasVolumeDiscount, discountAmount, finalTotal } = computeOrderTotals(
    quantities,
    skuMap
  );

  if (subtotal <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'Order must include at least one item with quantity greater than zero.',
    };
  }

  const customerNotes = String(customerInfo.notes || customerInfo.message || '').trim();

  const formatOrderItems = () => {
    const items: string[] = [];
    for (const k of ORDER_CHECKOUT_KEYS) {
      const n = q[k];
      if (n <= 0) continue;
      const sku = skuMap[k];
      const line = n * sku.unitPrice;
      items.push(`• ${sku.label}: ${n} @ $${sku.unitPrice} each = $${line.toFixed(2)}`);
    }
    return items.join('\n');
  };

  const fullName = `${firstName} ${lastName}`;
  const emailSubject = adminSubject(stage, fullName);

  const siteBase = (getServerEnv('SITE_URL') || 'https://williamscreekfarms.com').replace(
    /\/+$/,
    ''
  );
  const adminOrderUrl = orderIdStr
    ? `${siteBase}/admin/orders/${encodeURIComponent(orderIdStr)}`
    : '';

  const orderIdHtml = orderIdStr
    ? `<div class="order-details" style="background-color:#e8eaf6;padding:12px 15px;border-radius:5px;margin:15px 0;">
      <p style="margin:0;"><strong>Order ID (saved):</strong> <code>${escapeHtmlText(orderIdStr)}</code></p>
      <p style="margin:12px 0 0 0;"><a href="${escapeHtmlText(adminOrderUrl)}">Open this order in admin (print / update)</a></p>
      <p style="margin:8px 0 0 0;font-size:0.85em;color:#555;">You may need to sign in to the admin site first.</p>
    </div>`
    : '';

  const clientTotal = Number(input.clientOrderTotal);
  const paymentLine =
    stage === 'venmo'
      ? `<p><em>Customer was sent to Venmo to pay $${depositUsd.toFixed(2)} to ${HEDGE_VENMO_HANDLE}${
          orderIdStr ? ` with the note "${escapeHtmlText(hedgeVenmoNote(orderIdStr))}"` : ''
        }. Watch Venmo for it; nothing confirms it automatically.</em></p>`
      : stage === 'paid'
        ? `<p><strong>Paid through Stripe:</strong> $${chargeUsd.toFixed(2)} (fee included)</p>
      <p><em>Stripe confirmed this payment.</em></p>`
        : `<p><strong>Authorized through Stripe:</strong> $${chargeUsd.toFixed(2)} (fee included)</p>
      <p><em>Bank transfers take a few business days to clear. This is not paid yet; you'll get another push when it clears or fails.</em></p>`;

  const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #16a34a; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .order-details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .customer-info { background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .payment-info { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #ffeaa7; }
    .total { font-weight: bold; font-size: 1.2em; color: #16a34a; }
    .notes { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #6c757d; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${headerTitle(stage)}</h1>
    <p>Southwest Iowa Hedge — order notification</p>
  </div>

  <div class="content">
    ${orderIdHtml}
    <div class="customer-info">
      <h2>Customer</h2>
      <p><strong>Name:</strong> ${escapeHtmlText(fullName)}</p>
      <p><strong>Email:</strong> ${escapeHtmlText(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtmlText(phone || '—')}</p>
    </div>

    <div class="order-details">
      <h2>Order details</h2>
      <pre style="font-family: Arial, sans-serif; white-space: pre-line;">${formatOrderItems()}</pre>
      ${hasVolumeDiscount ? `<p><strong>Volume discount (10% on posts):</strong> −$${discountAmount.toFixed(2)}</p>` : ''}
      <p class="total">Order total: $${finalTotal.toFixed(2)}</p>
      ${
        input.clientOrderTotal != null &&
        Number.isFinite(clientTotal) &&
        Math.abs(clientTotal - finalTotal) > 0.02
          ? `<p style="font-size:0.9em;color:#666;">(Client submitted total: $${clientTotal.toFixed(2)} — using recalculated total above.)</p>`
          : ''
      }
    </div>

    ${
      isDeposit
        ? `
    <div class="payment-info">
      <h2>Payment</h2>
      <p><strong>10% deposit amount:</strong> $${depositUsd.toFixed(2)}</p>
      <p><strong>Estimated remaining at pickup:</strong> $${(finalTotal - depositUsd).toFixed(2)}</p>
      <p><strong>Payment method:</strong> ${hedgePayRailLabel(payRail)}</p>
      ${paymentLine}
    </div>
    `
        : `
    <div class="payment-info">
      <h2>Status</h2>
      <p><strong>Inquiry only</strong> — no deposit selected.</p>
    </div>
    `
    }

    ${
      customerNotes
        ? `
    <div class="notes">
      <h2>Additional details</h2>
      <p>${customerNotes.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>
    `
        : ''
    }

    <div style="margin-top: 30px; padding: 15px; background-color: #e3f2fd; border-radius: 5px;">
      <h3>Next steps</h3>
      <ol>
        <li>Contact the customer within 24 hours</li>
        <li>Confirm quantities and schedule pickup</li>
        ${
          stage === 'venmo'
            ? '<li>Order secured once the Venmo deposit shows up</li>'
            : stage === 'paid'
              ? '<li>Deposit is paid, so the order is secured</li>'
              : stage === 'ach_processing'
                ? '<li>Order secured once the bank transfer clears</li>'
                : '<li>Discuss deposit if they want to secure a spot</li>'
        }
      </ol>
    </div>
  </div>
</body>
</html>
    `;

  const resend = new Resend(apiKey);
  const emailData = await resend.emails.send({
    from: fromAddress,
    to: [notifyTo],
    replyTo: email,
    subject: emailSubject,
    html: emailContent,
  });

  if (emailData.error) {
    console.error('Resend API error:', emailData.error);
    return {
      ok: false,
      status: 502,
      error: 'Failed to send email',
      details: emailData.error.message || String(emailData.error),
    };
  }

  const customerThankYou = await resend.emails.send({
    from: fromAddress,
    to: [email],
    replyTo: notifyTo,
    subject: isDeposit
      ? 'Next step: Schedule your pickup — Southwest Iowa Hedge'
      : 'Thank you for your order — Southwest Iowa Hedge',
    html: buildCustomerThankYouHtml(firstName, pickupScheduleUrl(orderIdStr || undefined)),
  });

  if (customerThankYou.error) {
    console.error('Resend customer confirmation error:', customerThankYou.error);
    return {
      ok: false,
      status: 502,
      error: 'Failed to send confirmation email',
      details: customerThankYou.error.message || String(customerThankYou.error),
    };
  }

  console.log('Order emails sent:', emailData.data?.id, 'customer:', customerThankYou.data?.id);

  const customerName = fullName.trim() || 'Customer';
  let itemsLine = '';
  if (orderIdStr) {
    const buildInput: BuildOrderInput = {
      firstName,
      lastName,
      email,
      phone,
      notes: customerNotes || null,
      depositSelected: isDeposit,
      quantities,
    };
    try {
      const o = buildStoredOrder(buildInput, orderIdStr, new Date().toISOString(), skuMap);
      itemsLine = summarizeItemsForNtfy(o.items);
    } catch {
      itemsLine = '';
    }
  }

  const depositLine = !isDeposit
    ? 'Deposit: not selected at checkout'
    : stage === 'paid'
      ? `Deposit (10%): $${depositUsd.toFixed(2)} PAID via ${hedgePayRailLabel(payRail)}`
      : stage === 'ach_processing'
        ? `Deposit (10%): $${depositUsd.toFixed(2)} by ACH, NOT cleared yet`
        : `Deposit (10%): $${depositUsd.toFixed(2)} via ${hedgePayRailLabel(payRail)}, not verified`;

  const ntfyMessage = [
    orderIdStr ? `Order ID: ${orderIdStr}` : '',
    itemsLine ? `Items: ${itemsLine}` : '',
    `Order total: $${finalTotal.toFixed(2)}`,
    depositLine,
    `Email: ${email}`,
    `Phone: ${phone || '—'}`,
    adminOrderUrl ? `Admin: ${adminOrderUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await publishNtfyNotification({
    title: ntfyTitleFor(stage, customerName),
    message: ntfyMessage,
    workerEnv: ctx.workerEnv,
  });

  return {
    ok: true,
    emailId: emailData.data?.id,
    customerEmailId: customerThankYou.data?.id,
  };
}
