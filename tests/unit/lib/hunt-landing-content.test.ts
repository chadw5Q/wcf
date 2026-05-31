import { describe, it, expect } from 'vitest';
import {
  HUNT_PODCAST_URL,
  IOWA_DNR_DEER_URL,
  bookingSteps,
  galleryImagePaths,
  huntDetailCards,
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

  it('exposes twelve gallery paths under /hunt/images/gallery/', () => {
    const paths = galleryImagePaths();
    expect(paths).toHaveLength(12);
    for (const p of paths) {
      expect(p.startsWith('/hunt/images/gallery/buck-')).toBe(true);
      expect(p.endsWith('.jpg')).toBe(true);
    }
  });

  it('has four booking steps and four pricing rows', () => {
    expect(bookingSteps).toHaveLength(4);
    expect(pricingRows).toHaveLength(4);
  });

  it('uses valid https URLs for podcast and Iowa DNR', () => {
    assertHttpsUrl(HUNT_PODCAST_URL);
    assertHttpsUrl(IOWA_DNR_DEER_URL);
  });
});
