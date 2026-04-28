// netlify/functions/verify-coupon.js
// Validates a coupon code against the Supabase coupons table and issues an access code.

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

  let email, coupon;
  try {
    ({ email, coupon } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'Invalid request body' }) };
  }

  if (!email || !coupon) {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: 'email and coupon required' }) };
  }

  const couponUpper = coupon.trim().toUpperCase();

  try {
    // Look up the coupon
    const { data: couponData, error: couponErr } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', couponUpper)
      .eq('active', true)
      .single();

    if (couponErr || !couponData) {
      return { statusCode: 200, body: JSON.stringify({ valid: false }) };
    }

    // Check expiry
    if (couponData.expires_at && new Date(couponData.expires_at) < new Date()) {
      return { statusCode: 200, body: JSON.stringify({ valid: false }) };
    }

    // Check usage limit
    if (couponData.uses_count >= couponData.max_uses) {
      return { statusCode: 200, body: JSON.stringify({ valid: false }) };
    }

    // Enforce email binding: if the coupon was issued to a specific email
    // (e.g. a follow-up coupon sent after a paid Compass), the submitted
    // email MUST match. Generic coupons (bound_email = null) are unaffected.
    if (couponData.bound_email) {
      const submittedLc = String(email || '').trim().toLowerCase();
      const boundLc     = String(couponData.bound_email).trim().toLowerCase();
      if (submittedLc !== boundLc) {
        return { statusCode: 200, body: JSON.stringify({ valid: false }) };
      }
    }

    // Increment usage count atomically
    const { error: updateErr } = await supabase
      .from('coupons')
      .update({ uses_count: couponData.uses_count + 1 })
      .eq('id', couponData.id)
      .eq('uses_count', couponData.uses_count); // optimistic lock

    if (updateErr) {
      // Race condition — coupon just hit its limit
      return { statusCode: 200, body: JSON.stringify({ valid: false }) };
    }

    // Issue access code
    const accessCode = crypto.randomBytes(32).toString('hex');

    const { error: insertErr } = await supabase.from('access_codes').insert({
      code: accessCode,
      email,
      source: 'coupon',
      coupon_id: couponData.id,
    });

    if (insertErr) throw new Error(insertErr.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: true, access_code: accessCode }),
    };
  } catch (err) {
    console.error('verify-coupon error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ valid: false, error: err.message }),
    };
  }
};
