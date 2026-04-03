import { getEnv } from 'astro/env/runtime';

/**
 * Read server-side secrets for API routes.
 *
 * 1. `import.meta.env` — Vite / Astro dev loads `.env`.
 * 2. Astro `getEnv` — on Cloudflare this reads Wrangler **vars** and **secrets** (worker bindings). Without this step, dashboard-only secrets are invisible in production.
 * 3. `process.env` — Node, CI, some runtimes.
 */
export function getServerEnv(key: string): string | undefined {
  try {
    const fromMeta = (import.meta.env as Record<string, string | undefined>)[key];
    if (typeof fromMeta === 'string' && fromMeta.trim() !== '') {
      return fromMeta.trim();
    }
  } catch {
    // import.meta.env unavailable in some contexts
  }

  try {
    const fromRuntime = getEnv(key);
    if (typeof fromRuntime === 'string' && fromRuntime.trim() !== '') {
      return fromRuntime.trim();
    }
  } catch {
    // getEnv unset in some test / non-Astro contexts
  }

  const fromProcess = typeof process !== 'undefined' ? process.env[key] : undefined;
  if (typeof fromProcess === 'string' && fromProcess.trim() !== '') {
    return fromProcess.trim();
  }
  return undefined;
}
