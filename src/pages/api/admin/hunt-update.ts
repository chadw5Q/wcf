import type { APIRoute } from 'astro';
import { getHuntKvFromLocals } from '../../../lib/hunt-kv';
import {
  addHunterToReservation,
  getReservation,
  putReservation,
  updateHunterDetails,
  updatePartyDetails,
  type HuntHunter,
} from '../../../lib/hunt-reservations';
import { getHuntWeeksForYear, yearsWithWeekConfig } from '../../../lib/hunt-weeks';

export const prerender = false;

/**
 * Admin: edit party details, edit a hunter, or add a hunter.
 * Body:
 *  { reservationId, action: 'party', huntYear?, preferredWeek?, mealPackage?, notes? }
 *  { reservationId, action: 'hunter', hunterIndex, firstName?, lastName?, email?, phone?, state? }
 *  { reservationId, action: 'add_hunter', firstName, lastName, email, phone, state }
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
  const action =
    body.action === 'party' || body.action === 'hunter' || body.action === 'add_hunter'
      ? body.action
      : null;

  if (!reservationId || !action) {
    return new Response(JSON.stringify({ error: 'reservationId and action are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reservation = await getReservation(kv, reservationId);
  if (!reservation) {
    return new Response(JSON.stringify({ error: 'Reservation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (action === 'party') {
      const huntYear =
        typeof body.huntYear === 'number' && Number.isInteger(body.huntYear)
          ? body.huntYear
          : typeof body.huntYear === 'string' && /^\d{4}$/.test(body.huntYear.trim())
            ? Number(body.huntYear.trim())
            : undefined;
      const preferredWeek =
        typeof body.preferredWeek === 'string' ? body.preferredWeek.trim() : undefined;
      const mealPackage = typeof body.mealPackage === 'boolean' ? body.mealPackage : undefined;
      const notes =
        body.notes === null
          ? null
          : typeof body.notes === 'string'
            ? body.notes
            : undefined;

      const year = huntYear ?? reservation.huntYear;
      const week = preferredWeek ?? reservation.preferredWeek;
      const configuredYears = new Set(yearsWithWeekConfig());
      configuredYears.add(reservation.huntYear);
      if (!configuredYears.has(year)) {
        return new Response(JSON.stringify({ error: `No week config for ${year}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const weeks = getHuntWeeksForYear(year) ?? [];
      if (!weeks.some((w) => w.id === week)) {
        return new Response(JSON.stringify({ error: `Week ${week} is not valid for ${year}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const next = updatePartyDetails(reservation, { huntYear, preferredWeek, mealPackage, notes });
      await putReservation(kv, next);
      return new Response(JSON.stringify({ ok: true, status: next.status, totalHuntCost: next.totalHuntCost }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'hunter') {
      const hunterIndex =
        typeof body.hunterIndex === 'number' && Number.isInteger(body.hunterIndex)
          ? body.hunterIndex
          : -1;
      const next = updateHunterDetails(reservation, hunterIndex, {
        firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
        lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        state: typeof body.state === 'string' ? body.state : undefined,
      });
      await putReservation(kv, next);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // add_hunter
    const hunter: HuntHunter = {
      firstName: typeof body.firstName === 'string' ? body.firstName : '',
      lastName: typeof body.lastName === 'string' ? body.lastName : '',
      email: typeof body.email === 'string' ? body.email : '',
      phone: typeof body.phone === 'string' ? body.phone : '',
      state: typeof body.state === 'string' ? body.state : '',
    };
    const next = addHunterToReservation(reservation, hunter);
    await putReservation(kv, next);
    return new Response(
      JSON.stringify({ ok: true, hunterCount: next.hunterCount, totalHuntCost: next.totalHuntCost }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
