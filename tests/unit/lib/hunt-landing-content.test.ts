import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HUNT_PODCAST_URL,
  IOWA_DNR_DEER_URL,
  bookingSteps,
  buckSeasons,
  habitatPhotos,
  featuredHarvestPhotos,
  harvestPhotos,
  huntDetailCards,
  lodgePhotos,
  pricingRows,
  propertyStats,
} from '../../../src/lib/hunt-landing-content';

function assertHttpsUrl(url: string) {
  expect(url.startsWith('https://')).toBe(true);
  try {
    const u = new URL(url);
    expect(u.protocol).toBe('https:');
  } catch {
    expect.fail('invalid URL');
  }
}

describe('hunt-landing-content', () => {
  it('has four property stats and four hunt detail cards', () => {
    expect(propertyStats).toHaveLength(4);
    expect(huntDetailCards).toHaveLength(4);
    for (const s of propertyStats) {
      expect(s.value.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
    for (const c of huntDetailCards) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(0);
    }
  });

  it('lists buck seasons newest first with trail camera photos', () => {
    const years = buckSeasons.map((s) => s.year);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    for (const season of buckSeasons) {
      expect(season.photos.length).toBeGreaterThan(0);
      for (const p of season.photos) {
        expect(p.src).toMatch(new RegExp(`^/hunt/images/seasons/${season.year}-\\d+\\.webp$`));
      }
    }
  });

  it('every hunt photo exists on disk with dimensions and alt text', () => {
    const all = [...buckSeasons.flatMap((s) => s.photos), ...featuredHarvestPhotos, ...harvestPhotos, ...habitatPhotos, ...lodgePhotos];
    for (const p of all) {
      expect(existsSync(join(process.cwd(), 'public', p.src))).toBe(true);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.alt.length).toBeGreaterThan(0);
    }
  });

  it('has five booking steps and three pricing rows', () => {
    expect(bookingSteps).toHaveLength(5);
    expect(pricingRows).toHaveLength(3);
  });

  it('uses valid https URLs for podcast and Iowa DNR', () => {
    assertHttpsUrl(HUNT_PODCAST_URL);
    assertHttpsUrl(IOWA_DNR_DEER_URL);
  });
});
