/** R2 object key prefix for images uploaded via admin. */
export const PRODUCT_IMAGE_R2_PREFIX = 'pt-';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** Common static paths (add files under public/). */
export const DEFAULT_PRODUCT_IMAGE_PATHS: string[] = [
  '/images/hedge-posts.jpg',
  '/images/hedge-bowstave007.jpg',
];

export function extFromMime(mime: string): string | undefined {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXT_BY_MIME[m];
}

export function isAllowedProductImageMime(mime: string): boolean {
  return extFromMime(mime) !== undefined;
}

export function makeProductImageR2Basename(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  if (!/^(jpg|jpeg|png|webp|gif|svg)$/.test(clean)) {
    throw new Error('Invalid image extension');
  }
  const uuid = crypto.randomUUID();
  return `${PRODUCT_IMAGE_R2_PREFIX}${uuid}.${clean === 'jpeg' ? 'jpg' : clean}`;
}

const UPLOADED_BASENAME_RE = /^pt-[a-f0-9-]+\.(jpg|png|webp|gif|svg)$/i;

export function isValidUploadedProductImageBasename(name: string): boolean {
  return UPLOADED_BASENAME_RE.test(name);
}

export function productImageUrlFromBasename(basename: string): string {
  return `/api/media/product/${basename}`;
}

export function looksLikeImageUrlOrPath(image: string): boolean {
  const t = image.trim();
  if (!t) return false;
  if (t.startsWith('http://') || t.startsWith('https://')) return true;
  if (t.startsWith('/api/media/product/')) return true;
  if (t.startsWith('/')) return true;
  return false;
}

export function getProductImagesBucketFromLocals(
  locals:
    | {
        runtime?: { env?: { PRODUCT_IMAGES?: R2Bucket } };
      }
    | undefined
): R2Bucket | undefined {
  return locals?.runtime?.env?.PRODUCT_IMAGES;
}
