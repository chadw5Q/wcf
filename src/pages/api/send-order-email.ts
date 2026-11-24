import type { APIRoute } from 'astro';
import { parseDepositPayRail } from '../../lib/order-types';
import { getOrdersKvFromLocals } from '../../lib/orders-kv';
import { sendOrderNotifications, type OrderNotifyStage } from '../../lib/order-notify';
import { getServerEnv } from '../../lib/server-env';

/**
 * Sends the "new order" email, customer pickup email, and ntfy push for orders that don't
 * go through Stripe: inquiries (no deposit) and Venmo deposits.
 *
 * Card and ACH deposits are skipped here on purpose. Their alerts are sent once Stripe
 * reports the checkout (webhook or success page), so an abandoned or declined checkout
 * never looks like a real order.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!getServerEnv('RESEND_API_KEY')) {
    return new Response(
      JSON.stringify({
        error: 'Email is not configured',
        details:
          'RESEND_API_KEY is missing. For local dev: copy .env.example to .env and add your key. For production: set a Wrangler secret.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { customerInfo, quantities, orderTotal, isDeposit, depositAmount, orderId } = body;
    const payRail = parseDepositPayRail(body.payRail) ?? 'card';

    if (isDeposit && payRail !== 'venmo') {
      return new Response(
        JSON.stringify({ success: true, skipped: 'awaiting_stripe_payment' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stage: OrderNotifyStage = isDeposit ? 'venmo' : 'inquiry';
    const result = await sendOrderNotifications(
      {
        customerInfo: customerInfo ?? {},
        quantities,
        stage,
        depositAmount: Number(depositAmount) || 0,
        payRail,
        orderId:
          orderId !== undefined && orderId !== null ? String(orderId).trim() : undefined,
        clientOrderTotal: orderTotal,
      },
      {
        kv: getOrdersKvFromLocals(locals),
        workerEnv: locals?.runtime?.env as Record<string, unknown> | undefined,
      }
    );

    if (!result.ok) {
      return new Response(
        JSON.stringify({
          error: result.error,
          ...(result.details ? { details: result.details } : {}),
        }),
        { status: result.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailId: result.emailId,
        customerEmailId: result.customerEmailId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error sending order email:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to send email notification',
        details: message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
