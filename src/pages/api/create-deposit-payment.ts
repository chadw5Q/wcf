import type { APIRoute } from 'astro';
import { checkoutChargeUsd } from '../../lib/hunt-fees';
import { createCheckoutSession, stripeErrorMessage } from '../../lib/stripe';
import { getServerEnv } from '../../lib/server-env';

// Stripe minimum charge for USD card payments (https://stripe.com/docs/currencies#minimum-and-maximum-charge-amounts)
const MIN_DEPOSIT_CENTS = 50;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!getServerEnv('STRIPE_SECRET_KEY')) {
      return new Response(
        JSON.stringify({
          error: 'Payment is not configured',
          details:
            'STRIPE_SECRET_KEY is missing. Add it with: npx wrangler secret put STRIPE_SECRET_KEY (or in the Cloudflare dashboard under Worker variables).',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { depositAmount, orderTotal, customerInfo, orderItems, quantities, orderId } = body;
    // Venmo deposits never reach this endpoint; anything else that isn't ACH pays by card.
    const payRail: 'ach' | 'card' = body.payRail === 'ach' ? 'ach' : 'card';
    const orderIdMeta =
      orderId !== undefined && orderId !== null && String(orderId).trim() !== ''
        ? String(orderId).trim()
        : '';

    if (!depositAmount || !orderTotal || !customerInfo) {
      return new Response(JSON.stringify({ error: 'Missing required payment data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const depositCents = Math.round(Number(depositAmount) * 100);
    if (!Number.isFinite(depositCents) || depositCents < MIN_DEPOSIT_CENTS) {
      return new Response(
        JSON.stringify({
          error: 'Deposit too small',
          details:
            'The card payment minimum is $0.50. Your 10% deposit is below that with the current cart. Add more items, pay the deposit by Venmo, or submit without a deposit and pay at pickup.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Bake the processor fee into the charge so the farm still nets the full deposit.
    const chargeUsd = checkoutChargeUsd(Number(depositAmount), payRail);
    const feeLabel = payRail === 'ach' ? '+0.8% bank fee' : '+3% card fee';
    const depositItem = {
      id: 'deposit',
      name: `10% Deposit (${feeLabel}) - Hedge Posts Order (${customerInfo.firstName} ${customerInfo.lastName})`,
      price: chargeUsd,
      quantity: 1,
    };

    const metadata: Record<string, string> = {
      type: 'deposit',
      customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`,
      customer_email: customerInfo.email || '',
      customer_phone: customerInfo.phone || '',
      order_total: orderTotal.toString(),
      deposit_amount: depositAmount.toString(),
      charge_usd: chargeUsd.toFixed(2),
      pay_rail: payRail,
      quantities: JSON.stringify(quantities),
      order_items: JSON.stringify(orderItems),
      notes: customerInfo.notes || '',
    };
    if (orderIdMeta) {
      metadata.order_id = orderIdMeta;
      metadata.orderId = orderIdMeta;
    }

    const session = await createCheckoutSession([depositItem], {
      customerEmail: customerInfo.email || undefined,
      metadata,
      paymentMethodTypes: payRail === 'ach' ? ['us_bank_account'] : ['card'],
    });

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        payRail,
        chargeUsd,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error creating deposit payment session:', error);
    const details = stripeErrorMessage(error);
    const status =
      details.includes('STRIPE_SECRET_KEY') || details.includes('not configured') ? 503 : 500;
    return new Response(
      JSON.stringify({
        error: 'Failed to create deposit payment session',
        details,
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
