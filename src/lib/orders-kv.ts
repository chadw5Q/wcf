/** Resolve ORDERS_KV from Astro `locals` (Cloudflare Worker bindings). */
export function getOrdersKvFromLocals(
  locals:
    | {
        runtime?: { env?: { ORDERS_KV?: KVNamespace } };
      }
    | undefined
): KVNamespace | undefined {
  return locals?.runtime?.env?.ORDERS_KV;
}
