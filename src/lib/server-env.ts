/**
 * Read server-side secrets for API routes. Tries `import.meta.env` first (Vite / Astro dev loads `.env`),
 * then `process.env` (Cloudflare Worker runtime, CI, etc.).
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
  const fromProcess = typeof process !== 'undefined' ? process.env[key] : undefined;
  if (typeof fromProcess === 'string' && fromProcess.trim() !== '') {
    return fromProcess.trim();
  }
  return undefined;
}
