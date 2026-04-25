// netlify/functions/compass-checkout.js
// Creates a Stripe Checkout session for the Tribes Compass product.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const appUrl     = process.env.APP_URL || 'https://www.pathworksblueprint.com';
  const priceCents = parseInt(process.env.COMPASS_PRICE_CENTS || '3900', 10);
  const priceId    = process.env.COMPASS_PRICE_ID; // e.g. price_xxx for the real Stripe product

  // Prefer a real Stripe Price (tied to the Pathworks Compass product in your
  // Stripe catalog). Fall back to inline price_data if COMPASS_PRICE_ID isn't set.
  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Pathworks Compass',
            description: 'AI-resistant career, business, and company direction matched to your Blueprint',
          },
          unit_amount: priceCents,
        },
        quantity: 1,
      };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [lineItem],
      mode: 'payment',
      success_url: `${appUrl}/?compass_session={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/#compass`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
