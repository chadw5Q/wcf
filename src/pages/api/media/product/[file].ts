import type { APIRoute } from 'astro';
import { getProductImagesBucketFromLocals, isValidUploadedProductImageBasename } from '../../../../lib/product-media';

export const prerender = false;

function contentTypeForFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export const GET: APIRoute = async ({ params, locals }) => {
  const file = params.file;
  if (!file || !isValidUploadedProductImageBasename(file)) {
    return new Response('Not found', { status: 404 });
  }

  const bucket = getProductImagesBucketFromLocals(locals);
  if (!bucket) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await bucket.get(file);
  if (!obj?.body) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? contentTypeForFilename(file));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(obj.body, { headers });
};
