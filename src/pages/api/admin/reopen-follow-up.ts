import type { APIRoute } from 'astro';
import { ContactError, reopenFollowUp } from '../../../lib/contacts';
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

  try {
    const contact = await reopenFollowUp(
      kv,
      String(body.contactId ?? ''),
      String(body.interactionId ?? '')
    );
    return json({ success: true, contactId: contact.id }, 200);
  } catch (e) {
    const status = e instanceof ContactError ? e.status : 400;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, status);
  }
};
