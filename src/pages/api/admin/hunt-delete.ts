import type { APIRoute } from 'astro';
import { getHuntKvFromLocals } from '../../../lib/hunt-kv';
import {
  deleteReservation,
  getReservation,
  putReservation,
  removeHunterFromReservation,
} from '../../../lib/hunt-reservations';

export const prerender = false;

/**
 * Admin: delete a whole reservation, or remove one hunter from a party.
 * Body: { reservationId, hunterIndex?: number }
 * - Omit hunterIndex (or send null) → delete the reservation.
 * - hunterIndex set → remove that hunter; if they were the last, deletes the reservation.
 */
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
  if (!reservationId) {
    return new Response(JSON.stringify({ error: 'reservationId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hasHunterIndex =
    typeof body.hunterIndex === 'number' && Number.isInteger(body.hunterIndex);

  if (!hasHunterIndex) {
    const removed = await deleteReservation(kv, reservationId);
    if (!removed) {
      return new Response(JSON.stringify({ error: 'Reservation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, deleted: 'reservation' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hunterIndex = body.hunterIndex as number;
  const reservation = await getReservation(kv, reservationId);
  if (!reservation) {
    return new Response(JSON.stringify({ error: 'Reservation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (hunterIndex < 0 || hunterIndex >= reservation.hunters.length) {
    return new Response(JSON.stringify({ error: 'Invalid hunterIndex' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const next = removeHunterFromReservation(reservation, hunterIndex);
  if (!next) {
    await deleteReservation(kv, reservationId);
    return new Response(JSON.stringify({ ok: true, deleted: 'reservation' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await putReservation(kv, next);
  return new Response(JSON.stringify({ ok: true, deleted: 'hunter', hunterCount: next.hunterCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
