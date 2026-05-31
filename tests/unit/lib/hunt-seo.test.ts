import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { includePageInSitemap } from '../../../sitemap-page-filter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

describe('hunt SEO — robots.txt', () => {
  it('disallows /hunt and /hunt/ per PRD', () => {
    const robots = readFileSync(join(repoRoot, 'public', 'robots.txt'), 'utf8');
    expect(robots).toContain('Disallow: /hunt/');
    expect(robots).toContain('Disallow: /hunt');
  });
});

describe('hunt SEO — HuntLayout meta robots', () => {
  it('includes noindex,nofollow for private subsite pages', () => {
    const layout = readFileSync(join(repoRoot, 'src', 'layouts', 'HuntLayout.astro'), 'utf8');
    expect(layout).toContain('name="robots"');
    expect(layout).toContain('noindex');
    expect(layout).toContain('nofollow');
  });
});

describe('hunt SEO — sitemap filter', () => {
  it('excludes hunt URLs while keeping prior exclusions', () => {
    expect(includePageInSitemap('https://williamscreekfarms.com/')).toBe(true);
    expect(includePageInSitemap('https://williamscreekfarms.com/contact')).toBe(true);

    expect(includePageInSitemap('https://williamscreekfarms.com/hunt')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/hunt/')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/hunt/reserve')).toBe(false);

    expect(includePageInSitemap('https://williamscreekfarms.com/admin')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/api/foo')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/thank-you')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/success')).toBe(false);

    expect(includePageInSitemap('https://williamscreekfarms.com/parenting')).toBe(false);
    expect(includePageInSitemap('https://williamscreekfarms.com/parenting/')).toBe(false);
  });
});
