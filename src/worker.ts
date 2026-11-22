import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { ingestInboundEmail } from './lib/inbound-email';

type WorkerEnv = Parameters<typeof handle>[3];

/** Same fetch as the adapter's default entrypoint, plus an email() handler for crm@. */
export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
        return handle(manifest, app, request as Parameters<typeof handle>[2], env, ctx);
      },
      async email(message: ForwardableEmailMessage, env: WorkerEnv, _ctx: ExecutionContext) {
        try {
          const outcome = await ingestInboundEmail({ raw: message.raw, from: message.from }, env);
          if (outcome.status === 'rejected') message.setReject('Not accepted');
          console.log('[inbound-email]', outcome.status);
        } catch (e) {
          console.error('[inbound-email] failed', e);
        }
      },
    },
  };
}
