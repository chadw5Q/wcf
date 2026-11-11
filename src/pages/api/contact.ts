import type { APIRoute } from 'astro';
import { contactMessageSummary, interestForProjectType } from '../../lib/contact-form';
import { logInteraction } from '../../lib/contacts';
import { getOrdersKvFromLocals } from '../../lib/orders-kv';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ error: 'Invalid JSON' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const firstName = text(body.firstName).trim();
  const lastName = text(body.lastName).trim();
  const email = text(body.email).trim();
  const phone = text(body.phone).trim();
  const projectType = text(body.projectType).trim();
  const message = text(body.message).trim();

  if (!firstName || !lastName) {
    return json({ error: 'First and last name are required.' }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Email is required.' }, 400);
  }
  if (!message) {
    return json({ error: 'Message is required.' }, 400);
  }

  const interest = interestForProjectType(projectType);
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    console.error('Failed to log contact form message: ORDERS_KV is missing');
    return json({ success: true });
  }

  try {
    await logInteraction(kv, {
      firstName,
      lastName,
      email,
      phone,
      channel: 'web',
      summary: contactMessageSummary(projectType, message),
      ...(interest ? { interests: [interest] } : {}),
    });
  } catch (err) {
    console.error('Failed to log contact form message', err);
  }

  return json({ success: true });
};
