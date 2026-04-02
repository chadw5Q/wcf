import type { APIRoute } from 'astro';
import { createCheckoutSession } from '../../lib/stripe';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { 
      depositAmount, 
      orderTotal, 
      customerInfo, 
      orderItems,
      quantities 
    } = body;

    if (!depositAmount || !orderTotal || !customerInfo) {
      return new Response(JSON.stringify({ error: 'Missing required payment data' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // Create a single line item for the deposit
    const depositItem = {
      id: 'deposit',
      name: `10% Deposit - Hedge Posts Order (${customerInfo.firstName} ${customerInfo.lastName})`,
      price: Number(depositAmount),
      quantity: 1,
    };

    // Prepare metadata with order details
    const metadata = {
      type: 'deposit',
      customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`,
      customer_email: customerInfo.email || '',
      customer_phone: customerInfo.phone || '',
      order_total: orderTotal.toString(),
      deposit_amount: depositAmount.toString(),
      quantities: JSON.stringify(quantities),
      order_items: JSON.stringify(orderItems),
      notes: customerInfo.notes || '',
    };

    // Create Stripe checkout session
    const session = await createCheckoutSession([depositItem]);

    // Update session with metadata
    const stripe = (await import('../../lib/stripe')).default;
    await stripe.checkout.sessions.update(session.id, {
      metadata,
      customer_email: customerInfo.email || undefined,
    });

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error creating deposit payment session:', error);
    return new Response(JSON.stringify({ error: 'Failed to create deposit payment session' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};