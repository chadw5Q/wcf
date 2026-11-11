import type { APIRoute } from 'astro';
import {
  ContactError,
  isInteractionChannel,
  logInteraction,
  parseInterests,
  type InteractionChannel,
} from '../../../lib/contacts';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return json({ error: 'Order storage is not configured', details: 'ORDERS_KV binding is missing.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const channel = String(body.channel ?? '');
  if (!isInteractionChannel(channel)) {
    return json({ error: 'Choose how this interaction happened.' }, 400);
  }

  try {
    const { contact, interaction } = await logInteraction(kv, {
      contactId: body.contactId == null ? null : String(body.contactId),
      firstName: String(body.firstName ?? ''),
      lastName: String(body.lastName ?? ''),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      channel: channel as InteractionChannel,
      summary: String(body.summary ?? ''),
      followUpOn: body.followUpOn == null ? null : String(body.followUpOn),
      interests: parseInterests(body.interests),
      location: body.location == null ? '' : String(body.location),
    });
    return json({ success: true, contactId: contact.id, interactionId: interaction.id }, 200);
  } catch (e) {
    const status = e instanceof ContactError ? e.status : 400;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, status);
  }
};
