import type { APIRoute } from 'astro';
import { getHuntKvFromLocals } from '../../../lib/hunt-kv';
import {
  appendHuntEvent,
  getReservation,
  HUNT_PAYMENT_METHODS,
  markHunterBalancePaid,
  markHunterDepositPaid,
  putReservation,
  type HuntPaymentMethod,
} from '../../../lib/hunt-reservations';

export const prerender = false;

/** Admin: mark Venmo (or other) deposit/balance received for one hunter. */
export const POST: APIRoute = async ({ request, locals }) => {
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
  const reservationId = typeof body.reservationId === 'string' ? body.reservationId.trim() : '';
  const hunterIndex =
    typeof body.hunterIndex === 'number' && Number.isInteger(body.hunterIndex) ? body.hunterIndex : -1;
  const kind = body.kind === 'deposit' || body.kind === 'balance' ? body.kind : null;
  const method =
    typeof body.method === 'string' && (HUNT_PAYMENT_METHODS as readonly string[]).includes(body.method)
      ? (body.method as HuntPaymentMethod)
      : null;
  const ref = typeof body.ref === 'string' ? body.ref.trim() || null : null;
  // Optional received date (YYYY-MM-DD) — stored as noon Central so the date is stable in reports.
  let paidAt: string | null = null;
  if (typeof body.paidAt === 'string' && body.paidAt.trim()) {
    const m = body.paidAt.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return new Response(JSON.stringify({ error: 'paidAt must be YYYY-MM-DD' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const d = new Date(`${m[0]}T12:00:00-06:00`);
    if (Number.isNaN(d.getTime())) {
      return new Response(JSON.stringify({ error: 'paidAt is not a valid date' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    paidAt = d.toISOString();
  }
  const action =
    body.action === 'tag_received' ||
    body.action === 'note' ||
    body.action === 'fulfill' ||
    body.action === 'cancel'
      ? body.action
      : null;
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  const reservation = reservationId ? await getReservation(kv, reservationId) : null;
  if (!reservation) {
    return new Response(JSON.stringify({ error: 'Reservation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'fulfill') {
    if (reservation.status === 'cancelled') {
      return new Response(JSON.stringify({ error: 'Cancelled parties cannot be marked fulfilled' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const next = appendHuntEvent(
      { ...reservation, status: 'fulfilled' },
      'fulfilled',
      'Party marked fulfilled',
      null
    );
    await putReservation(kv, next);
    return new Response(JSON.stringify({ ok: true, status: 'fulfilled' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'cancel') {
    if (reservation.status === 'fulfilled') {
      return new Response(JSON.stringify({ error: 'Fulfilled parties cannot be cancelled' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const next = appendHuntEvent(
      { ...reservation, status: 'cancelled' },
      'cancelled',
      'Party cancelled',
      null
    );
    await putReservation(kv, next);
    return new Response(JSON.stringify({ ok: true, status: 'cancelled' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'tag_received') {
    const next = appendHuntEvent(
      { ...reservation, tagReceivedAt: new Date().toISOString(), status: reservation.status === 'draft' ? reservation.status : 'tag_received' },
      'tag_received',
      'Tags marked received',
      null
    );
    // Only advance to tag_received if deposits are in
    const status =
      next.hunterPayments.every((p) => p.depositPaid) && next.status !== 'cancelled' && next.status !== 'fulfilled' && next.status !== 'balance_paid'
        ? 'tag_received'
        : next.status;
    await putReservation(kv, { ...next, status });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'note') {
    if (!note) {
      return new Response(JSON.stringify({ error: 'note is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const next = appendHuntEvent(reservation, 'note', note, hunterIndex >= 0 ? hunterIndex : null);
    await putReservation(kv, next);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!kind || !method || hunterIndex < 0 || hunterIndex >= reservation.hunters.length) {
    return new Response(
      JSON.stringify({ error: 'kind, method, and hunterIndex are required for payment marks' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const next =
    kind === 'deposit'
      ? markHunterDepositPaid(reservation, hunterIndex, method, ref, paidAt)
      : markHunterBalancePaid(reservation, hunterIndex, method, ref, paidAt);
  await putReservation(kv, next);

  return new Response(JSON.stringify({ ok: true, status: next.status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
