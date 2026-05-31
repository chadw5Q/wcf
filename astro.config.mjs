// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { includePageInSitemap } from './sitemap-page-filter.mjs';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: 'https://williamscreekfarms.com',
  adapter: cloudflare({
    // Avoid requiring Cloudflare Images; use Astro’s default image handling.
    imageService: 'passthrough',
  }),
  integrations: [
    sitemap({
      filter: (page) => includePageInSitemap(page),
    })
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});