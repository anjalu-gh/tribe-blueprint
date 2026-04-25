// netlify/functions/compass-checkout.js
// Creates a Stripe Checkout session for the Tribes Compass product.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, direction, capital;
  try {
    ({ email, direction, capital } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }
  if (!direction) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Direction is required' }) };
  }

  // After payment, return the user to the Compass domain so the right
  // navbar/branding shows on the success page. Falls back to the Blueprint
  // domain if COMPASS_APP_URL isn't set, which preserves the old behavior.
  const compassAppUrl = process.env.COMPASS_APP_URL || 'https://www.pathworkscompass.com';
  const priceCents    = parseInt(process.env.COMPASS_PRICE_CENTS || '3900', 10);
  const priceId       = process.env.COMPASS_PRICE_ID; // e.g. price_xxx for the real Stripe product

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

  // Stripe metadata fields are capped at 500 chars each — clip direction
  // defensively so a long paste can't break checkout creation.
  const directionForMeta = String(direction).slice(0, 480);
  const capitalForMeta   = String(capital || 'career-only').slice(0, 60);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [lineItem],
      mode: 'payment',
      // Stash direction + capital on the session so compass-verify can pull
      // them back after payment — no need to re-prompt the user.
      metadata: {
        direction: directionForMeta,
        capital:   capitalForMeta,
      },
      success_url: `${compassAppUrl}/?compass_session={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${compassAppUrl}/#compass`,
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
