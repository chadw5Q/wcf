/** Resolve REVIEWS_KV from Astro `locals`. */
export function getReviewsKvFromLocals(
  locals:
    | {
        runtime?: { env?: { REVIEWS_KV?: KVNamespace } };
      }
    | undefined
): KVNamespace | undefined {
  return locals?.runtime?.env?.REVIEWS_KV;
}
