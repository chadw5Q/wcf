import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { getServerEnv } from '../../lib/server-env';
import { publishNtfyNotification } from '../../lib/ntfy';

const PRICES = {
  premiumLine: 25,
  premiumCorner: 40,
  premiumExtraLong: 60,
  regularLine: 10,
  regularCorner: 20,
  bowStave: 125,
} as const;

function computeOrderTotals(quantities: Record<string, unknown>) {
  const q = {
    premiumLine: Number(quantities.premiumLine) || 0,
    premiumCorner: Number(quantities.premiumCorner) || 0,
    premiumExtraLong: Number(quantities.premiumExtraLong) || 0,
    regularLine: Number(quantities.regularLine) || 0,
    regularCorner: Number(quantities.regularCorner) || 0,
    bowStave: Number(quantities.bowStave) || 0,
  };

  let subtotal = 0;
  subtotal += q.premiumLine * PRICES.premiumLine;
  subtotal += q.premiumCorner * PRICES.premiumCorner;
  subtotal += q.premiumExtraLong * PRICES.premiumExtraLong;
  subtotal += q.regularLine * PRICES.regularLine;
  subtotal += q.regularCorner * PRICES.regularCorner;
  subtotal += q.bowStave * PRICES.bowStave;

  const postCount =
    q.premiumLine + q.premiumCorner + q.premiumExtraLong + q.regularLine + q.regularCorner;
  const hasVolumeDiscount = postCount >= 100;
  const discountAmount = hasVolumeDiscount ? subtotal * 0.1 : 0;
  const finalTotal = subtotal - discountAmount;

  return { q, subtotal, hasVolumeDiscount, discountAmount, finalTotal };
}

const PICKUP_SCHEDULE_URL = 'https://cal.com/chad-williams-donsre/hedge-pickup';

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCustomerThankYouHtml(firstName: string, isDeposit: boolean): string {
  const nameEsc = escapeHtmlText(firstName.trim() || 'there');
  const intro = isDeposit
    ? `<p>Hi ${nameEsc},</p>
      <p>Once your <strong>deposit payment</strong> succeeds, your order is confirmed! Please choose your delivery day and time at this link:</p>`
    : `<p>Hi ${nameEsc},</p>
      <p><strong>Your order is confirmed!</strong> Please choose your delivery day and time at this link:</p>`;

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
    <p><a href="${PICKUP_SCHEDULE_URL}">${PICKUP_SCHEDULE_URL}</a></p>
    <p>Need a different day? Text Chad at <a href="tel:+17122543999">712-254-3999</a>.</p>
    <p style="margin-top:24px;color:#666;font-size:0.9em;">— Southwest Iowa Hedge</p>
  </div>
</body>
</html>`;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Email is not configured',
        details:
          'RESEND_API_KEY is missing. For local dev: copy .env.example to .env and add your key. For production: set a Wrangler secret.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const notifyTo = getServerEnv('ORDER_NOTIFICATION_EMAIL') || 'cchadww@gmail.com';
  // Local dev: Resend only allows unverified domains via onboarding@resend.dev (see Resend test-email docs).
  // Production: verify your domain at resend.com/domains or set RESEND_FROM to a verified sender.
  const fromAddress =
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Southwest Iowa Hedge <onboarding@resend.dev>'
      : 'Southwest Iowa Hedge <orders@williamscreekfarms.com>');

  try {
    const body = await request.json();
    const { customerInfo, quantities, orderTotal, isDeposit, depositAmount } = body;

    if (!customerInfo?.firstName || !customerInfo?.lastName || !customerInfo?.email) {
      return new Response(JSON.stringify({ error: 'Missing customer name or email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!quantities || typeof quantities !== 'object') {
      return new Response(JSON.stringify({ error: 'Missing order quantities' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (Number(quantities.premiumExtraLong) > 0) {
      return new Response(
        JSON.stringify({ error: 'Premium Extra Long Posts are currently sold out.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { q, subtotal, hasVolumeDiscount, discountAmount, finalTotal } =
      computeOrderTotals(quantities);

    if (subtotal <= 0) {
      return new Response(
        JSON.stringify({ error: 'Order must include at least one item with quantity greater than zero.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const customerNotes =
      (customerInfo.notes || customerInfo.message || '').toString().trim();

    // Format order items for email
    const formatOrderItems = () => {
      const items: string[] = [];
      if (q.premiumLine > 0) {
        items.push(
          `• Premium Line Posts: ${q.premiumLine} @ $25 each = $${(q.premiumLine * 25).toFixed(2)}`
        );
      }
      if (q.premiumCorner > 0) {
        items.push(
          `• Premium Corner Posts: ${q.premiumCorner} @ $40 each = $${(q.premiumCorner * 40).toFixed(2)}`
        );
      }
      if (q.premiumExtraLong > 0) {
        items.push(
          `• Premium Extra Long Posts: ${q.premiumExtraLong} @ $60 each = $${(q.premiumExtraLong * 60).toFixed(2)}`
        );
      }
      if (q.regularLine > 0) {
        items.push(
          `• Regular Line Posts: ${q.regularLine} @ $10 each = $${(q.regularLine * 10).toFixed(2)}`
        );
      }
      if (q.regularCorner > 0) {
        items.push(
          `• Regular Corner Posts: ${q.regularCorner} @ $${PRICES.regularCorner} each = $${(q.regularCorner * PRICES.regularCorner).toFixed(2)}`
        );
      }
      if (q.bowStave > 0) {
        items.push(
          `• Bow Stave Logs: ${q.bowStave} @ $125 each = $${(q.bowStave * 125).toFixed(2)}`
        );
      }
      return items.join('\n');
    };

    const emailSubject = isDeposit
      ? `New Hedge Post deposit — ${customerInfo.firstName} ${customerInfo.lastName}`
      : `New Hedge Post order inquiry — ${customerInfo.firstName} ${customerInfo.lastName}`;

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
    <h1>${isDeposit ? 'Deposit payment started' : 'New order inquiry'}</h1>
    <p>Southwest Iowa Hedge — order notification</p>
  </div>

  <div class="content">
    <div class="customer-info">
      <h2>Customer</h2>
      <p><strong>Name:</strong> ${customerInfo.firstName} ${customerInfo.lastName}</p>
      <p><strong>Email:</strong> ${customerInfo.email}</p>
      <p><strong>Phone:</strong> ${customerInfo.phone || '—'}</p>
    </div>

    <div class="order-details">
      <h2>Order details</h2>
      <pre style="font-family: Arial, sans-serif; white-space: pre-line;">${formatOrderItems()}</pre>
      ${hasVolumeDiscount ? `<p><strong>Volume discount (10% on posts):</strong> −$${discountAmount.toFixed(2)}</p>` : ''}
      <p class="total">Order total: $${finalTotal.toFixed(2)}</p>
      ${
        typeof orderTotal === 'number' && Math.abs(orderTotal - finalTotal) > 0.02
          ? `<p style="font-size:0.9em;color:#666;">(Client submitted total: $${Number(orderTotal).toFixed(2)} — using recalculated total above.)</p>`
          : ''
      }
    </div>

    ${
      isDeposit
        ? `
    <div class="payment-info">
      <h2>Payment</h2>
      <p><strong>10% deposit amount:</strong> $${Number(depositAmount).toFixed(2)}</p>
      <p><strong>Estimated remaining at pickup:</strong> $${(finalTotal - Number(depositAmount)).toFixed(2)}</p>
      <p><em>Customer is proceeding to Stripe checkout for the deposit.</em></p>
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
        ${isDeposit ? '<li>Order secured with deposit once Stripe payment completes</li>' : '<li>Discuss deposit if they want to secure a spot</li>'}
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
      replyTo: customerInfo.email,
      subject: emailSubject,
      html: emailContent,
    });

    if (emailData.error) {
      console.error('Resend API error:', emailData.error);
      return new Response(
        JSON.stringify({
          error: 'Failed to send email',
          details: emailData.error.message || String(emailData.error),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const customerThankYou = await resend.emails.send({
      from: fromAddress,
      to: [customerInfo.email],
      replyTo: notifyTo,
      subject: isDeposit
        ? 'Next step: Schedule your pickup — Southwest Iowa Hedge'
        : 'Your order is confirmed — Southwest Iowa Hedge',
      html: buildCustomerThankYouHtml(String(customerInfo.firstName || ''), isDeposit),
    });

    if (customerThankYou.error) {
      console.error('Resend customer confirmation error:', customerThankYou.error);
      return new Response(
        JSON.stringify({
          error: 'Failed to send confirmation email',
          details: customerThankYou.error.message || String(customerThankYou.error),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(
      'Order emails sent:',
      emailData.data?.id,
      'customer:',
      customerThankYou.data?.id
    );

    const customerName =
      `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim() || 'Customer';
    const ntfyTitle = isDeposit ? `Deposit order: ${customerName}` : `New hedge order: ${customerName}`;
    const ntfyMessage = [
      isDeposit ? 'Type: Deposit (customer opened Stripe checkout)' : 'Type: Inquiry (no deposit)',
      `Order total: $${finalTotal.toFixed(2)}`,
      ...(isDeposit ? [`Deposit (10%): $${Number(depositAmount).toFixed(2)}`] : []),
      `Email: ${customerInfo.email}`,
      `Phone: ${customerInfo.phone || '—'}`,
    ].join('\n');
    await publishNtfyNotification({ title: ntfyTitle, message: ntfyMessage });

    return new Response(
      JSON.stringify({
        success: true,
        emailId: emailData.data?.id,
        customerEmailId: customerThankYou.data?.id,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error sending order email:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to send email notification',
        details: message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
