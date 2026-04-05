import type { APIRoute } from 'astro';
import { getOrdersKvFromLocals } from '../../../lib/orders-kv';
import { getProductsConfig } from '../../../lib/products-config';
import {
  DEFAULT_PRODUCT_IMAGE_PATHS,
  getProductImagesBucketFromLocals,
  isValidUploadedProductImageBasename,
  looksLikeImageUrlOrPath,
  productImageUrlFromBasename,
  PRODUCT_IMAGE_R2_PREFIX,
} from '../../../lib/product-media';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const kv = getOrdersKvFromLocals(locals);
  const config = await getProductsConfig(kv);
  const bucket = getProductImagesBucketFromLocals(locals);

  const fromConfig = new Set<string>();
  for (const row of config.orderSkus) {
    const img = row.image?.trim();
    if (img && looksLikeImageUrlOrPath(img)) fromConfig.add(img);
  }

  const fromR2: string[] = [];
  if (bucket) {
    let cursor: string | undefined;
    let guard = 0;
    do {
      const listed = await bucket.list({ prefix: PRODUCT_IMAGE_R2_PREFIX, limit: 500, cursor });
      for (const o of listed.objects) {
        if (isValidUploadedProductImageBasename(o.key)) {
          fromR2.push(productImageUrlFromBasename(o.key));
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
      guard += 1;
    } while (cursor && guard < 50);
  }

  const paths = [...new Set([...DEFAULT_PRODUCT_IMAGE_PATHS, ...fromConfig, ...fromR2])].sort((a, b) =>
    a.localeCompare(b)
  );

  return new Response(
    JSON.stringify({
      paths,
      uploadAvailable: Boolean(bucket),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
};
