import type { APIRoute } from 'astro';
import { computeHuntOrderSummary, HUNT_LODGING_PER_PERSON } from '../../lib/hunt-pricing';
import { getHuntKvFromLocals } from '../../lib/hunt-kv';
import { parseHuntReserveRequestBody } from '../../lib/hunt-reserve-body';
import { createDraftReservation, putReservation } from '../../lib/hunt-reservations';
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

  const parsed = parseHuntReserveRequestBody(raw);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: parsed.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { hunters, huntYear, preferredWeek, mealPackage, notes } = parsed.value;
  const summary = computeHuntOrderSummary(hunters.length, mealPackage);

  const reservation = createDraftReservation({
    huntYear,
    preferredWeek,
    mealPackage,
    hunters,
    huntCostPerPerson: HUNT_LODGING_PER_PERSON,
    mealPackageCost: summary.mealLine,
    totalHuntCost: summary.totalHuntCost,
    depositPerPerson: summary.depositPerPerson,
    totalDeposit: summary.totalDeposit,
    balanceDue: summary.balanceDueJuly1,
    notes,
  });

  await putReservation(kv, reservation);

  const origin = siteOrigin(request);
  const n = hunters.length;
  const lineName = `${n} Hunt Deposits — Williams Creek Whitetails ${huntYear}`;

  try {
    const session = await createCheckoutSession(
      [
        {
          id: 'hunt-deposit',
          name: lineName,
          price: 500,
          quantity: n,
        },
      ],
      {
        customerEmail: hunters[0]?.email,
        metadata: {
          hunt_checkout_kind: 'deposit',
          reservation_id: reservation.id,
          hunt_year: String(huntYear),
          preferred_week: preferredWeek,
        },
        successUrl: `${origin}/hunt/reserve/confirmed?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/hunt/reserve`,
      }
    );

    const withSession = { ...reservation, stripeDepositSessionId: session.id };
    await putReservation(kv, withSession);

    return new Response(JSON.stringify({ reservationId: withSession.id, stripeUrl: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[hunt-reserve] Stripe error', e);
    return new Response(
      JSON.stringify({
        error: 'Failed to start checkout',
        details: stripeErrorMessage(e),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
