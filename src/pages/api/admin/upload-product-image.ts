import type { APIRoute } from 'astro';
import {
  extFromMime,
  getProductImagesBucketFromLocals,
  isAllowedProductImageMime,
  makeProductImageR2Basename,
  productImageUrlFromBasename,
} from '../../../lib/product-media';

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  const bucket = getProductImagesBucketFromLocals(locals);
  if (!bucket) {
    return new Response(
      JSON.stringify({
        error:
          'PRODUCT_IMAGES R2 bucket is not bound. Add r2_buckets in wrangler.jsonc, create the bucket, and redeploy (or type a path under /images/...).',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Expected multipart form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = form.get('file');
  if (!(file instanceof File) || !file.size) {
    return new Response(JSON.stringify({ error: 'Missing file field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'File too large (max 5 MB)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mime = file.type || 'application/octet-stream';
  if (!isAllowedProductImageMime(mime)) {
    return new Response(JSON.stringify({ error: 'Unsupported image type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ext = extFromMime(mime);
  if (!ext) {
    return new Response(JSON.stringify({ error: 'Unsupported image type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let key: string;
  try {
    key = makeProductImageR2Basename(ext);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid image type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await file.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: { contentType: mime.split(';')[0]?.trim() || mime },
  });

  const url = productImageUrlFromBasename(key);
  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
