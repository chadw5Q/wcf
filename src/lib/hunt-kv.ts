/** Resolve `HUNT_KV` from Astro `locals` (Cloudflare Worker bindings). */
export function getHuntKvFromLocals(
  locals:
    | {
        runtime?: { env?: { HUNT_KV?: KVNamespace } };
      }
    | undefined
): KVNamespace | undefined {
  return locals?.runtime?.env?.HUNT_KV;
}
