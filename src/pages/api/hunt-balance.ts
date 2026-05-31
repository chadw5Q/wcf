import type { APIRoute } from 'astro';
import { parseHuntBalanceRequestBody } from '../../lib/hunt-balance-body';
import { findReservationForFinalPayment, putReservation } from '../../lib/hunt-reservations';
import { getHuntKvFromLocals } from '../../lib/hunt-kv';
import { getServerEnv } from '../../lib/server-env';
import { createCheckoutSession, stripeErrorMessage } from '../../lib/stripe';

export const prerender = false;

function siteOrigin(request: Request): string {
  const env = getServerEnv('SITE_URL')?.trim();
  if (env) return env.replace(/\/+$/, '');
  const origin = request.headers.get('origin');
  if (origin?.trim()) return origin.replace(/\/+$/, '');
  return 'http://localhost:4321';
}

function usdCents(n: number): number {
  return Math.round(n * 100);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getHuntKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({
        error: 'HUNT_KV is not bound',
        details: 'Add the HUNT_KV namespace to wrangler.jsonc and redeploy (see README).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!getServerEnv('STRIPE_SECRET_KEY')?.trim()) {
    return new Response(
      JSON.stringify({
        error: 'Stripe is not configured',
        details: 'Set STRIPE_SECRET_KEY (Wrangler secret or .env).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = parseHuntBalanceRequestBody(raw);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: parsed.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = parsed.value;
  const reservation = await findReservationForFinalPayment(kv, {
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
    huntYear: body.huntYear,
    hunterCount: body.hunterCount,
    mealPackage: body.mealPackage,
  });

  if (!reservation) {
    return new Response(
      JSON.stringify({
        error: 'No matching reservation found',
        details:
          'We could not find an open balance for this hunt with the details provided. Double-check name, email, year, party size, and meal selection, or call Chad at 712-254-3999.',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (usdCents(body.paymentAmount) !== usdCents(reservation.balanceDue)) {
    return new Response(
      JSON.stringify({
        error: 'Payment amount does not match balance due',
        balanceDue: reservation.balanceDue,
        details: `Your balance due is $${reservation.balanceDue.toLocaleString('en-US')}. Update the payment amount to match your invoice.`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const origin = siteOrigin(request);
  const lineName = `Hunt balance — Williams Creek Whitetails ${body.huntYear}`;

  try {
    const session = await createCheckoutSession(
      [
        {
          id: 'hunt-balance',
          name: lineName,
          price: reservation.balanceDue,
          quantity: 1,
        },
      ],
      {
        customerEmail: body.email,
        metadata: {
          hunt_checkout_kind: 'balance',
          reservation_id: reservation.id,
          hunt_year: String(body.huntYear),
        },
        successUrl: `${origin}/hunt/final-payment/confirmed?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/hunt/final-payment`,
      }
    );

    const withSession = { ...reservation, stripeBalanceSessionId: session.id };
    await putReservation(kv, withSession);

    return new Response(JSON.stringify({ stripeUrl: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[hunt-balance] Stripe error', e);
    return new Response(
      JSON.stringify({
        error: 'Failed to start checkout',
        details: stripeErrorMessage(e),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
