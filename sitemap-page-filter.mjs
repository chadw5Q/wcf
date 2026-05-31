/**
 * Single source of truth for @astrojs/sitemap `filter` — keep in sync with tests.
 * @param {string} page URL path from the integration (typically includes site origin or path)
 * @returns {boolean} true if the page should appear in the sitemap
 */
export function includePageInSitemap(page) {
  const p = page.toLowerCase();
  return (
    !p.includes('/admin') &&
    !p.includes('/api/') &&
    !p.includes('/thank-you') &&
    !p.includes('/success') &&
    !p.includes('/hunt') &&
    !p.includes('/parenting')
  );
}
