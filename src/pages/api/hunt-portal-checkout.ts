import type { APIRoute } from 'astro';
import { checkoutChargeUsd, type HuntStripeRail } from '../../lib/hunt-fees';
import { hunterBalanceShareUsd, hunterDepositShareUsd } from '../../lib/hunt-hunter-shares';
import { getHuntKvFromLocals } from '../../lib/hunt-kv';
import { verifyHuntPortalToken } from '../../lib/hunt-portal-token';
import { ensureHunterPayments, getReservation } from '../../lib/hunt-reservations';
import { createCheckoutSession, stripeErrorMessage } from '../../lib/stripe';

export const prerender = false;

type Kind = 'deposit' | 'balance';

/**
 * Guest starts Stripe Checkout from their portal token.
 * Body: { token, kind: 'deposit'|'balance', rail: 'ach'|'card' }
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const kv = getHuntKvFromLocals(locals);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'HUNT_KV is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
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
  if (typeof raw !== 'object' || raw === null) {
    return new Response(JSON.stringify({ error: 'Body must be an object' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = raw as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  const kind = body.kind === 'deposit' || body.kind === 'balance' ? (body.kind as Kind) : null;
  const rail: HuntStripeRail | null =
    body.rail === 'ach' || body.rail === 'card' ? body.rail : null;

  if (!token || !kind || !rail) {
    return new Response(JSON.stringify({ error: 'token, kind, and rail are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = await verifyHuntPortalToken(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Invalid or expired portal link' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reservation = await getReservation(kv, payload.reservationId);
  if (!reservation) {
    return new Response(JSON.stringify({ error: 'Reservation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hunter = reservation.hunters[payload.hunterIndex];
  const pay = ensureHunterPayments(reservation)[payload.hunterIndex];
  if (!hunter || !pay) {
    return new Response(JSON.stringify({ error: 'Hunter not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (kind === 'deposit' && pay.depositPaid) {
    return new Response(JSON.stringify({ error: 'Deposit already paid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (kind === 'balance') {
    if (!pay.depositPaid) {
      return new Response(JSON.stringify({ error: 'Deposit must be paid before balance' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pay.balancePaid) {
      return new Response(JSON.stringify({ error: 'Balance already paid' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const listUsd = kind === 'deposit' ? hunterDepositShareUsd() : hunterBalanceShareUsd(reservation, payload.hunterIndex);
  const chargeUsd = checkoutChargeUsd(listUsd, rail);
  const origin = url.origin;
  const paymentPath = `${origin}/hunt/portal/${encodeURIComponent(token)}/payment`;
  const cancelUrl = paymentPath;
  const successUrl = `${paymentPath}?paid=1&session_id={CHECKOUT_SESSION_ID}`;

  // ACH session excludes cards; card session excludes US bank so totals match the rail.
  // ACH must also be turned on under Dashboard → Settings → Payment methods (test/live).
  const excluded =
    rail === 'ach'
      ? ['card', 'cashapp', 'amazon_pay', 'klarna', 'affirm', 'afterpay_clearpay']
      : ['us_bank_account'];

  try {
    const session = await createCheckoutSession(
      [
        {
          id: kind === 'deposit' ? 'hunt-hunter-deposit' : 'hunt-hunter-balance',
          name:
            kind === 'deposit'
              ? `Hunt deposit — ${hunter.firstName} ${hunter.lastName}`
              : `Hunt balance (due July 1) — ${hunter.firstName} ${hunter.lastName}`,
          price: chargeUsd,
          quantity: 1,
        },
      ],
      {
        customerEmail: hunter.email,
        successUrl,
        cancelUrl,
        excludedPaymentMethodTypes: excluded,
        metadata: {
          hunt_checkout_kind: kind === 'deposit' ? 'hunter_deposit' : 'hunter_balance',
          reservation_id: reservation.id,
          hunter_index: String(payload.hunterIndex),
          hunt_rail: rail,
          hunt_year: String(reservation.huntYear),
          list_amount_usd: String(listUsd),
        },
      }
    );

    if (!session.url) {
      return new Response(JSON.stringify({ error: 'Stripe did not return a Checkout URL' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ stripeUrl: session.url, chargeUsd, listUsd }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[hunt-portal-checkout]', e);
    const details = stripeErrorMessage(e);
    const noMethods = /no valid payment method/i.test(details);
    const error = noMethods
      ? rail === 'ach'
        ? 'Bank ACH is not enabled in Stripe. In test mode open dashboard.stripe.com/test/settings/payment_methods and turn on ACH Direct Debit (US bank account), then retry.'
        : 'No card payment methods are available on this Stripe account. Enable Cards under Settings → Payment methods, then retry.'
      : 'Checkout failed';
    return new Response(JSON.stringify({ error, details }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
