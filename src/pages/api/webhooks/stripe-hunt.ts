import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { getHuntKvFromLocals } from '../../../lib/hunt-kv';
import { handleHuntCheckoutSessionCompleted } from '../../../lib/hunt-stripe-webhook';
import { getServerEnv } from '../../../lib/server-env';
import { getStripe } from '../../../lib/stripe';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const webhookSecret = getServerEnv('STRIPE_WEBHOOK_SECRET_HUNT')?.trim();
  if (!webhookSecret) {
    return new Response(
      JSON.stringify({
        error: 'Webhook not configured',
        details: 'Set STRIPE_WEBHOOK_SECRET_HUNT to the signing secret for this endpoint in Stripe.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return new Response(JSON.stringify({ error: 'Missing Stripe-Signature header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-hunt] Invalid signature', err);
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kv = getHuntKvFromLocals(locals);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'HUNT_KV is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const result = await handleHuntCheckoutSessionCompleted(session, kv);
  console.log('[stripe-hunt] checkout.session.completed', session.id, result);

  return new Response(
    JSON.stringify({
      received: true,
      hunt: result,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
