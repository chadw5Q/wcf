import type { APIRoute } from 'astro';
import type { OrderStatus } from '../../../lib/order-types';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import {
  adminRebuildMatchesExisting,
  applyOrderMetaPatch,
  getOrder,
  parseAdminRebuildPayload,
  rebuildStoredOrder,
} from '../../../lib/orders';
import { getProductsConfig, orderSkusToMap } from '../../../lib/products-config';

export const prerender = false;

function isOrderStatus(s: string): s is OrderStatus {
  return s === 'pending' || s === 'scheduled' || s === 'fulfilled';
}

export const POST: APIRoute = async ({ request, locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  if (!kv) {
    return new Response(
      JSON.stringify({
        error: 'Order storage is not configured',
        details: 'ORDERS_KV binding is missing.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.depositSelected !== undefined) {
    return new Response(
      JSON.stringify({ error: 'deposit.selected cannot be changed after the order is placed.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const id = String(body.id ?? '').trim();
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing order id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const productsConfig = await getProductsConfig(kv);
  const skuMap = orderSkusToMap(productsConfig.orderSkus);

  const order = await getOrder(kv, id);
  if (!order) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let working = order;

  const rebuildRaw = body.rebuild;
  const hasRebuild =
    rebuildRaw !== undefined &&
    rebuildRaw !== null &&
    typeof rebuildRaw === 'object' &&
    !Array.isArray(rebuildRaw);

  let rebuildMutated = false;
  if (hasRebuild) {
    const rr = rebuildRaw as Record<string, unknown>;
    if (rr.depositSelected !== undefined) {
      return new Response(
        JSON.stringify({ error: 'deposit.selected cannot be changed in rebuild payload.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    let parsed;
    try {
      parsed = parseAdminRebuildPayload(rr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!adminRebuildMatchesExisting(working, parsed)) {
      working = rebuildStoredOrder(working, parsed, skuMap);
      rebuildMutated = true;
    }
  }

  const wantsMeta = 'status' in body || 'deliverySlot' in body;
  let metaChanged = false;

  if (wantsMeta) {
    const patch: { status?: OrderStatus; deliverySlot?: string | null } = {};
    if ('status' in body && body.status !== undefined && body.status !== null) {
      const s = String(body.status);
      if (!isOrderStatus(s)) {
        return new Response(JSON.stringify({ error: 'Invalid status' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      patch.status = s;
    }
    if ('deliverySlot' in body) {
      if (body.deliverySlot === null) {
        patch.deliverySlot = null;
      } else {
        patch.deliverySlot = String(body.deliverySlot);
      }
    }
    try {
      metaChanged = applyOrderMetaPatch(working, patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!hasRebuild && !wantsMeta) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!rebuildMutated && !metaChanged) {
    return new Response(JSON.stringify({ success: true, order: working, unchanged: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await kv.put(working.id, JSON.stringify(working));
  return new Response(JSON.stringify({ success: true, order: working }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
