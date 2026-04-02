// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://williamscreekfarms.com',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.includes('/api/')
    })
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});