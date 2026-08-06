import type { APIRoute } from 'astro';
import {
  getReviewPhotosBucketFromLocals,
  isValidReviewPhotoKey,
} from '../../../../lib/review-photo';

export const prerender = false;

function contentTypeForKey(key: string): string {
  return key.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

function resolveKey(params: { key?: string | string[] }): string {
  const raw = params.key;
  if (Array.isArray(raw)) return raw.join('/');
  if (typeof raw !== 'string' || !raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const GET: APIRoute = async ({ params, locals }) => {
  const resolved = resolveKey(params);
  if (!resolved || !isValidReviewPhotoKey(resolved)) {
    return new Response('Not found', { status: 404 });
  }

  const bucket = getReviewPhotosBucketFromLocals(locals);
  if (!bucket) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await bucket.get(resolved);
  if (!obj?.body) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? contentTypeForKey(resolved));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
};
