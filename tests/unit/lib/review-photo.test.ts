import { describe, it, expect } from 'vitest';
import {
  isAllowedReviewPhotoMime,
  isValidReviewPhotoKey,
  makeReviewPhotoR2Key,
  MAX_REVIEW_PHOTO_BYTES,
} from '../../../src/lib/review-photo';
import { approvePhoto, rejectPhoto, type StoredReview } from '../../../src/lib/reviews';

function pendingPhotoReview(): StoredReview {
  return {
    id: 'rev_photo-1',
    orderId: 'ord-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    rating: 5,
    comment: null,
    displayName: 'Pat',
    location: null,
    productSkus: ['premiumLine'],
    photoKey: 'reviews/rev_photo-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
    photoState: 'pending',
    state: 'new',
    featured: false,
  };
}

describe('review photo keys', () => {
  it('derives key from review id and ignores client filenames', () => {
    const key = makeReviewPhotoR2Key('rev_abc-123', 'jpg');
    expect(key.startsWith('reviews/rev_abc-123/')).toBe(true);
    expect(key.endsWith('.jpg')).toBe(true);
    expect(isValidReviewPhotoKey(key)).toBe(true);
  });

  it('rejects path traversal and bad keys', () => {
    expect(isValidReviewPhotoKey('reviews/../secret.jpg')).toBe(false);
    expect(isValidReviewPhotoKey('/reviews/rev_x/y.jpg')).toBe(false);
    expect(isValidReviewPhotoKey('reviews/rev_x/y.webp')).toBe(false);
  });

  it('allows jpeg and png only', () => {
    expect(isAllowedReviewPhotoMime('image/jpeg')).toBe(true);
    expect(isAllowedReviewPhotoMime('image/png')).toBe(true);
    expect(isAllowedReviewPhotoMime('image/heic')).toBe(false);
    expect(isAllowedReviewPhotoMime('image/webp')).toBe(false);
  });

  it('rejects invalid review ids for key generation', () => {
    expect(() => makeReviewPhotoR2Key('../evil', 'jpg')).toThrow();
  });

  it('documents the 8 MB server-side cap', () => {
    expect(MAX_REVIEW_PHOTO_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('review photoState transitions', () => {
  it('pending → approved', () => {
    const next = approvePhoto(pendingPhotoReview());
    expect(next.photoState).toBe('approved');
    expect(next.photoKey).toBeTruthy();
  });

  it('pending → rejected clears the key', () => {
    const next = rejectPhoto(pendingPhotoReview());
    expect(next.photoState).toBe('rejected');
    expect(next.photoKey).toBeNull();
  });

  it('does not transition out of rejected', () => {
    const rejected = rejectPhoto(pendingPhotoReview());
    expect(approvePhoto(rejected).photoState).toBe('rejected');
    expect(rejectPhoto(rejected).photoState).toBe('rejected');
  });
});
