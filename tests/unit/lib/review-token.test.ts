import { describe, it, expect } from 'vitest';
import {
  createReviewToken,
  reviewAbsoluteUrl,
  reviewPath,
  verifyReviewToken,
} from '../../../src/lib/review-token';

describe('review tokens', () => {
  it('round-trips orderId', async () => {
    const secret = 'test-review-secret';
    const token = await createReviewToken('order-1', secret);
    const payload = await verifyReviewToken(token, secret);
    expect(payload).toEqual({ orderId: 'order-1', exp: expect.any(Number) });
  });

  it('rejects a tampered token', async () => {
    const secret = 'test-review-secret';
    const token = await createReviewToken('order-1', secret);
    expect(await verifyReviewToken(token + 'x', secret)).toBeNull();
  });

  it('rejects a valid token verified with a different secret', async () => {
    const token = await createReviewToken('order-1', 'secret-a');
    expect(await verifyReviewToken(token, 'secret-b')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const secret = 'test-review-secret';
    const past = new Date('2020-01-01T00:00:00Z');
    const token = await createReviewToken('order-1', secret, past);
    expect(await verifyReviewToken(token, secret, new Date())).toBeNull();
  });

  it('accepts a percent-encoded token from a URL path segment', async () => {
    const secret = 'test-review-secret';
    const token = await createReviewToken('order-1', secret);
    const payload = await verifyReviewToken(encodeURIComponent(token), secret);
    expect(payload?.orderId).toBe('order-1');
  });

  it('builds review paths with optional rating', () => {
    const token = '123:abc:deadbeef';
    expect(reviewPath(token)).toBe(`/review/${encodeURIComponent(token)}`);
    expect(reviewPath(token, 5)).toBe(`/review/${encodeURIComponent(token)}?r=5`);
    expect(reviewAbsoluteUrl('https://example.com/', token, 4)).toBe(
      `https://example.com/review/${encodeURIComponent(token)}?r=4`
    );
  });
});
