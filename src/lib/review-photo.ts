/** R2 helpers for customer review photos. */

export const REVIEW_PHOTO_R2_PREFIX = 'reviews/';
export const MAX_REVIEW_PHOTO_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png']);

export function isAllowedReviewPhotoMime(mime: string): boolean {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED.has(m);
}

export function extFromReviewPhotoMime(mime: string): 'jpg' | 'png' | null {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  return null;
}

/**
 * Server-generated immutable key. Client-supplied filenames must never influence this.
 */
export function makeReviewPhotoR2Key(reviewId: string, ext: 'jpg' | 'png'): string {
  if (!/^rev_[a-zA-Z0-9-]+$/.test(reviewId)) {
    throw new Error('Invalid review id for photo key');
  }
  return `${REVIEW_PHOTO_R2_PREFIX}${reviewId}/${crypto.randomUUID()}.${ext}`;
}

const KEY_RE = /^reviews\/rev_[a-zA-Z0-9-]+\/[a-f0-9-]+\.(jpg|png)$/i;

export function isValidReviewPhotoKey(key: string): boolean {
  if (!KEY_RE.test(key)) return false;
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) return false;
  return true;
}

export function reviewPhotoPublicUrl(key: string): string {
  return `/api/media/review/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function getReviewPhotosBucketFromLocals(
  locals:
    | {
        runtime?: { env?: { REVIEW_PHOTOS?: R2Bucket } };
      }
    | undefined
): R2Bucket | undefined {
  return locals?.runtime?.env?.REVIEW_PHOTOS;
}
