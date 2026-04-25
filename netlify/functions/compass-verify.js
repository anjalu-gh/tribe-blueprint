// netlify/functions/compass-verify.js
// Verifies a completed Stripe Checkout session for Tribes Compass
// and issues a one-time access code.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let session_id;
  try {
    ({ session_id } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'Invalid request body' }) };
  }

  if (!session_id) {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'session_id required' }) };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'Payment not completed' }) };
    }

    const email     = session.customer_email || session.customer_details?.email || '';
    const direction = session.metadata?.direction || '';
    const capital   = session.metadata?.capital   || 'career-only';

    // Idempotency — return existing code if already issued for this session
    const { data: existing } = await supabase
      .from('access_codes')
      .select('code')
      .eq('stripe_session_id', session_id)
      .single();

    if (existing) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: true, email, access_code: existing.code, direction, capital }),
      };
    }

    // Generate new access code prefixed so it's identifiable
    const accessCode = 'COMPASS-' + crypto.randomBytes(24).toString('hex');

    const { error: insertError } = await supabase.from('access_codes').insert({
      code:              accessCode,
      email,
      source:            'stripe',
      stripe_session_id: session_id,
    });

    if (insertError) throw new Error(insertError.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: true, email, access_code: accessCode, direction, capital }),
    };
  } catch (err) {
    console.error('compass-verify error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ valid: false, error: err.message }) };
  }
};
