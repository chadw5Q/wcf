import type { APIRoute } from 'astro';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { getProductsConfig, parseProductsConfigJson, putProductsConfig } from '../../../lib/products-config';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  const config = await getProductsConfig(kv);
  return new Response(JSON.stringify(config), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'ORDERS_KV is not bound on this worker.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawStr = typeof body === 'string' ? body : JSON.stringify(body);

  let parsed;
  try {
    parsed = parseProductsConfigJson(rawStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'Invalid products config', details: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await putProductsConfig(kv, parsed);
  return new Response(JSON.stringify({ success: true, config: parsed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
