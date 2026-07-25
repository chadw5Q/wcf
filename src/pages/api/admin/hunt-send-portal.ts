import type { APIRoute } from 'astro';
import { getHuntKvFromLocals } from '../../../lib/hunt-kv';
import { sendHuntPortalLinkEmail, siteBaseUrl } from '../../../lib/hunt-portal-email';
import { createHuntPortalToken, huntPortalAbsoluteUrl } from '../../../lib/hunt-portal-token';
import {
  appendHuntEvent,
  ensureHunterPayments,
  getReservation,
  putReservation,
} from '../../../lib/hunt-reservations';

export const prerender = false;

/** Admin: mint + email portal link(s). Body: { reservationId, hunterIndex?: number } */
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

  const reservation = await getReservation(kv, reservationId);
  if (!reservation) {
    return new Response(JSON.stringify({ error: 'Reservation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const indices: number[] =
    typeof body.hunterIndex === 'number' && Number.isInteger(body.hunterIndex)
      ? [body.hunterIndex]
      : reservation.hunters.map((_, i) => i);

  const results: Array<{ hunterIndex: number; emailed: boolean; portalUrl: string }> = [];
  let next = reservation;
  const now = new Date().toISOString();
  const base = siteBaseUrl();

  for (const hunterIndex of indices) {
    const hunter = next.hunters[hunterIndex];
    if (!hunter) continue;
    const token = await createHuntPortalToken(next.id, hunterIndex);
    const portalUrl = huntPortalAbsoluteUrl(base, token);
    const emailed = await sendHuntPortalLinkEmail({
      reservation: next,
      hunter,
      hunterIndex,
      portalUrl,
    });
    const hunterPayments = ensureHunterPayments(next);
    hunterPayments[hunterIndex] = {
      ...hunterPayments[hunterIndex]!,
      portalSentAt: now,
    };
    next = appendHuntEvent(
      { ...next, hunterPayments },
      'portal_sent',
      emailed ? `Portal link emailed to ${hunter.email}` : `Portal link minted (email failed) for ${hunter.email}`,
      hunterIndex
    );
    results.push({ hunterIndex, emailed, portalUrl });
  }

  await putReservation(kv, next);

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
