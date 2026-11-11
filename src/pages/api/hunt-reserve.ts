import type { APIRoute } from 'astro';
import { checkoutChargeUsd } from '../../lib/hunt-fees';
import { huntVenmoPayUrl, parseHuntPayRail, type HuntPayRail } from '../../lib/hunt-payment-info';
import { computeHuntOrderSummary } from '../../lib/hunt-pricing';
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

function parsePayRail(raw: unknown): HuntPayRail {
  if (typeof raw !== 'object' || raw === null) return 'card';
  return parseHuntPayRail((raw as Record<string, unknown>).payRail);
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payRail = parsePayRail(raw);
  if ((payRail === 'card' || payRail === 'ach') && !getServerEnv('STRIPE_SECRET_KEY')?.trim()) {
    return new Response(
      JSON.stringify({
        error: 'Stripe is not configured',
        details: 'Set STRIPE_SECRET_KEY (Wrangler secret or .env).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parsed = parseHuntReserveRequestBody(raw);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: parsed.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { hunters, huntYear, preferredWeek, notes } = parsed.value;
  const summary = computeHuntOrderSummary(hunters.length, true, 'group_flat');

  const reservation = createDraftReservation({
    huntYear,
    preferredWeek,
    pricingModel: summary.pricingModel,
    mealPackage: summary.mealPackage,
    hunters,
    huntCostPerPerson: summary.huntLodging / hunters.length,
    mealPackageCost: summary.mealLine,
    totalHuntCost: summary.totalHuntCost,
    depositPerPerson: summary.depositPerPerson,
    totalDeposit: summary.totalDeposit,
    balanceDue: summary.balanceDueJuly1,
    notes,
  });

  await putReservation(kv, reservation);

  const origin = siteOrigin(request);
  const listDeposit = summary.totalDeposit;
  const lead = hunters[0]!;
  const venmoNote = `WCW deposit — ${lead.lastName} — ${huntYear} — ${reservation.id.slice(0, 8)}`;

  if (payRail === 'venmo' || payRail === 'check') {
    const confirmUrl = `${origin}/hunt/reserve/confirmed?reservation_id=${encodeURIComponent(reservation.id)}&pay=${payRail}`;
    return new Response(
      JSON.stringify({
        reservationId: reservation.id,
        payRail,
        listDepositUsd: listDeposit,
        ...(payRail === 'venmo' ? { venmoUrl: huntVenmoPayUrl(listDeposit, venmoNote) } : {}),
        confirmUrl,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const charge = checkoutChargeUsd(listDeposit, payRail);
  const lineName =
    payRail === 'card'
      ? `Group Hunt Deposit (+3% card) — WCW ${huntYear}`
      : `Group Hunt Deposit (+ACH fee) — WCW ${huntYear}`;

  const excluded =
    payRail === 'ach'
      ? ['card', 'cashapp', 'amazon_pay', 'klarna', 'affirm', 'afterpay_clearpay']
      : ['us_bank_account'];

  try {
    const session = await createCheckoutSession(
      [
        {
          id: 'hunt-deposit',
          name: lineName,
          price: charge,
          quantity: 1,
        },
      ],
      {
        customerEmail: lead.email,
        excludedPaymentMethodTypes: excluded,
        metadata: {
          hunt_checkout_kind: 'deposit',
          reservation_id: reservation.id,
          hunt_year: String(huntYear),
          preferred_week: preferredWeek,
          hunt_rail: payRail,
          list_amount_usd: String(listDeposit),
        },
        successUrl: `${origin}/hunt/reserve/confirmed?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/hunt/reserve`,
      }
    );

    const withSession = { ...reservation, stripeDepositSessionId: session.id };
    await putReservation(kv, withSession);

    return new Response(
      JSON.stringify({
        reservationId: withSession.id,
        payRail,
        listDepositUsd: listDeposit,
        chargeUsd: charge,
        stripeUrl: session.url,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
