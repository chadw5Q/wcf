import { describe, it, expect } from 'vitest';
import { selectReviewHomepageSource } from '../../../src/lib/review-source-selector';

describe('selectReviewHomepageSource', () => {
  it('stays on marketplace until six published reviews', () => {
    expect(selectReviewHomepageSource(0)).toBe('marketplace');
    expect(selectReviewHomepageSource(5)).toBe('marketplace');
  });

  it('switches to first-party at six, with link at fifteen', () => {
    expect(selectReviewHomepageSource(6)).toBe('firstparty');
    expect(selectReviewHomepageSource(14)).toBe('firstparty');
    expect(selectReviewHomepageSource(15)).toBe('firstparty_with_link');
  });
});
