import type { APIRoute } from 'astro';
import { createCheckoutSession, stripeErrorMessage } from '../../lib/stripe';
import { getServerEnv } from '../../lib/server-env';
import { publishNtfyNotification } from '../../lib/ntfy';

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!getServerEnv('STRIPE_SECRET_KEY')) {
      return new Response(
        JSON.stringify({
          error: 'Payment is not configured',
          details:
            'STRIPE_SECRET_KEY is missing. Set it with wrangler secret put or in the Cloudflare dashboard.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid items data' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Validate items structure
    const validatedItems = items.map((item: any) => ({
      id: String(item.id),
      name: String(item.name),
      price: Number(item.price),
      quantity: Number(item.quantity),
    }));

    const session = await createCheckoutSession(validatedItems);

    const lines = validatedItems
      .map((i) => `• ${i.name} × ${i.quantity} @ $${i.price}`)
      .join('\n');
    await publishNtfyNotification({
      title: 'Hedge posts: cart checkout started',
      message: `Stripe session: ${session.id}\n${lines}`,
    });

    return new Response(JSON.stringify({ sessionId: session.id, url: session.url }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error in checkout session creation:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to create checkout session',
        details: stripeErrorMessage(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}; 