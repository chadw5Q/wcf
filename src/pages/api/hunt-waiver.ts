import type { APIRoute } from 'astro';
import { getHuntKvFromLocals } from '../../lib/hunt-kv';
import {
  appendHuntEvent,
  ensureHunterPayments,
  getReservation,
  putReservation,
} from '../../lib/hunt-reservations';
import {
  createHuntWaiverRecord,
  HUNT_WAIVER_KV_PREFIX,
  parseHuntWaiverBody,
  sendHuntWaiverNotifyEmail,
} from '../../lib/hunt-waiver';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = parseHuntWaiverBody(raw);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: parsed.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const record = createHuntWaiverRecord(parsed.value);

  let stored = false;
  const kv = getHuntKvFromLocals(locals);
  if (kv) {
    try {
      await kv.put(`${HUNT_WAIVER_KV_PREFIX}${record.id}`, JSON.stringify(record));
      stored = true;

      if (record.reservationId && record.hunterIndex != null) {
        const res = await getReservation(kv, record.reservationId);
        if (res && record.hunterIndex >= 0 && record.hunterIndex < res.hunters.length) {
          const hunterPayments = ensureHunterPayments(res);
          hunterPayments[record.hunterIndex] = {
            ...hunterPayments[record.hunterIndex]!,
            waiverId: record.id,
          };
          let next = appendHuntEvent(
            { ...res, hunterPayments },
            'waiver_signed',
            `Waiver signed by ${record.fullName}`,
            record.hunterIndex
          );
          await putReservation(kv, next);
        }
      }
    } catch (e) {
      console.error('[hunt-waiver] KV put failed', e);
    }
  }

  let emailed = false;
  try {
    emailed = await sendHuntWaiverNotifyEmail(record);
  } catch (e) {
    console.error('[hunt-waiver] notify email failed', e);
  }

  if (!stored && !emailed) {
    return new Response(
      JSON.stringify({
        error: 'Unable to record the waiver right now',
        details: 'Neither HUNT_KV nor Resend email is available. Please call Chad at 712-254-3999.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ id: record.id, buckChoice: record.buckChoice, stored, emailed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
