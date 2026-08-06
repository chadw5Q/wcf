export type ReviewHomepageSource = 'marketplace' | 'firstparty' | 'firstparty_with_link';

/** Homepage content switch driven by published first-party review count. */
export function selectReviewHomepageSource(publishedCount: number): ReviewHomepageSource {
  if (publishedCount >= 15) return 'firstparty_with_link';
  if (publishedCount >= 6) return 'firstparty';
  return 'marketplace';
}
