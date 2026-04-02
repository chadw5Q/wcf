// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

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
      filter: (page) =>
        !page.includes('/admin/') &&
        !page.includes('/api/') &&
        !page.includes('/thank-you') &&
        !page.includes('/success')
    })
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});