import Stripe from 'stripe';
import { getServerEnv } from './server-env';

const API_VERSION = '2024-12-18.acacia' as const;

let cached: Stripe | null = null;

/** Throws if STRIPE_SECRET_KEY is missing (configure .env locally or Wrangler secret in production). */
export function getStripe(): Stripe {
  const key = getServerEnv('STRIPE_SECRET_KEY');
  if (!key?.trim()) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!cached) {
    cached = new Stripe(key, { apiVersion: API_VERSION });
  }
  return cached;
}

export type CreateCheckoutSessionOptions = {
  /** Pre-fills email on Checkout; only valid on create, not on session.update. */
  customerEmail?: string;
  /** Merged with default `items` metadata (JSON of line items). */
  metadata?: Record<string, string>;
  /** Override success redirect (must include `{CHECKOUT_SESSION_ID}` for Checkout). */
  successUrl?: string;
  /** Override cancel redirect. */
  cancelUrl?: string;
  /**
   * Exclude payment method types so ACH-only / card-only sessions can use different totals.
   * Prefer Dashboard configs long-term; this avoids hard-coding an allow-list.
   */
  excludedPaymentMethodTypes?: string[];
};

export async function createCheckoutSession(
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>,
  options?: CreateCheckoutSessionOptions
) {
  const stripe = getStripe();
  const metadata: Record<string, string> = {
    items: JSON.stringify(items),
    ...(options?.metadata ?? {}),
  };

  const base = getServerEnv('SITE_URL') || 'http://localhost:4321';
  const successUrl =
    options?.successUrl ?? `${base}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = options?.cancelUrl ?? `${base}/order-now`;

  const session = await stripe.checkout.sessions.create({
    line_items: items.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    })),
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    ...(options?.customerEmail?.trim()
      ? { customer_email: options.customerEmail.trim() }
      : {}),
    ...(options?.excludedPaymentMethodTypes?.length
      ? { excluded_payment_method_types: options.excludedPaymentMethodTypes as Stripe.Checkout.SessionCreateParams.ExcludedPaymentMethodType[] }
      : {}),
  });

  return session;
}

export async function getCheckoutSession(sessionId: string) {
  const stripe = getStripe();
  return stripe.checkout.sessions.retrieve(sessionId);
}

export async function createPaymentIntent(amount: number, metadata: Record<string, string> = {}) {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    metadata,
  });
}

function stripeErrorMessage(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export { stripeErrorMessage };
