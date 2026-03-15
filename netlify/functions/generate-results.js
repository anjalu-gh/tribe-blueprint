// netlify/functions/generate-results.js
// Verifies the access code, calls Claude API to generate personalized results,
// saves the assessment + results to Supabase, pushes a Contact to Zoho CRM,
// and returns the JSON.

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Human-readable labels for the 25 questions
const QUESTION_LABELS = {
  q1:  { left: 'Working independently',                  right: 'Collaborating with a team' },
  q2:  { left: 'Routine and structure',                   right: 'Variety and spontaneity' },
  q3:  { left: 'Following clear instructions',            right: 'Setting own direction' },
  q4:  { left: 'Working behind the scenes',               right: 'Being the face of something' },
  q5:  { left: 'Hands-on / physical work',                right: 'Desk / digital work' },
  q6:  { left: 'Analytical and logical thinking',         right: 'Creative and artistic expression' },
  q7:  { left: 'Motivated by stability',                  right: 'Motivated by growth and change' },
  q8:  { left: 'Helping individuals one-on-one',          right: 'Impacting large groups' },
  q9:  { left: 'Working with data and systems',           right: 'Working with people and relationships' },
  q10: { left: 'Energized by competition',                right: 'Energized by cooperation' },
  q11: { left: 'Deep, specialized expertise',             right: 'Broad, generalist knowledge' },
  q12: { left: 'Attention to detail',                     right: 'Big-picture thinking' },
  q13: { left: 'Creating new things',                     right: 'Managing and organizing' },
  q14: { left: 'Communicating through writing',           right: 'Speaking / presenting' },
  q15: { left: 'Execution and doing',                     right: 'Strategy and planning' },
  q16: { left: 'Guaranteed, steady income',               right: 'Variable income with higher potential' },
  q17: { left: 'Established organisations',               right: 'Startups or building own thing' },
  q18: { left: 'Careful decisions after research',        right: 'Quick decisions on instinct' },
  q19: { left: 'Low-risk, stable situations',             right: 'High-risk, high-reward situations' },
  q20: { left: 'Gradual, incremental change',             right: 'Bold leaps and big pivots' },
  q21: { left: 'Financial security is top priority',      right: 'Personal fulfillment / purpose is top priority' },
  q22: { left: 'Work-life balance non-negotiable',        right: 'Will sacrifice balance for success' },
  q23: { left: 'Local / community-level impact',          right: 'Global / large-scale impact' },
  q24: { left: 'Prefers being an employee',               right: 'Prefers being own boss' },
  q25: { left: 'Driven by day-to-day enjoyment',          right: 'Driven by legacy and reputation' },
};

function buildScoreSummary(answers) {
  return Object.entries(answers)
    .map(([id, score]) => {
      const q = QUESTION_LABELS[id];
      if (!q) return null;
      const s = parseInt(score, 10);
      const tendency =
        s <= 2 ? `strongly leans toward "${q.left}"` :
        s <= 4 ? `leans toward "${q.left}"` :
        s === 5 ? `is balanced between "${q.left}" and "${q.right}"` :
        s <= 7 ? `leans toward "${q.right}"` :
                 `strongly leans toward "${q.right}"`;
      return `- ${tendency} (score ${s}/10)`;
    })
    .filter(Boolean)
    .join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, access_code, answers;
  try {
    ({ email, access_code, answers } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // ── Verify access code ──────────────────────────
  console.log('Step 1: Verifying access code...');
  const { data: accessData, error: accessErr } = await supabase
    .from('access_codes')
    .select('*')
    .eq('code', access_code)
    .single();

  if (accessErr || !accessData) {
    console.log('Access code invalid:', accessErr?.message);
    return { statusCode: 403, body: JSON.stringify({ error: 'Invalid or expired access code' }) };
  }
  console.log('Step 1 done: access code valid');

  const resolvedEmail = email || accessData.email || '';

  // ── Build Claude prompt ─────────────────────────
  const scoreSummary = buildScoreSummary(answers || {});

  const prompt = `You are a deeply insightful career counselor and business strategist working with Changing Tribes — a platform that helps people transition to new chapters of their professional lives.

A person has completed a 25-question personality and skills assessment. Here are their results (each score is 1–10):

${scoreSummary}

Based on these scores, generate a rich, personalized career and business analysis. Be specific and actionable — avoid generic advice. Speak warmly and directly to the person as "you".

Return ONLY valid JSON — no markdown fences, no explanation, just the JSON object — with this exact structure:

{
  "tribe_name": "The [Archetype Name]",
  "tribe_description": "2–3 sentences describing this person's unique archetype and what makes them stand out professionally.",
  "past_analysis": "2–3 sentences about the kinds of roles and environments they have likely thrived or struggled in, based on their scores.",
  "career_paths": [
    { "title": "Specific Career Title", "description": "2–3 sentences on why this path fits their exact profile and how they would excel." },
    { "title": "Specific Career Title", "description": "2–3 sentences." },
    { "title": "Specific Career Title", "description": "2–3 sentences." }
  ],
  "business_ideas": [
    { "name": "Specific Business Type or Name", "description": "2–3 sentences on why this idea suits them and what makes it realistic to start." },
    { "name": "Specific Business Type or Name", "description": "2–3 sentences." },
    { "name": "Specific Business Type or Name", "description": "2–3 sentences." }
  ],
  "roadmap": [
    { "title": "Action Step Title", "action": "A specific, concrete action they can take in the next 30 days." },
    { "title": "Action Step Title", "action": "Specific action." },
    { "title": "Action Step Title", "action": "Specific action." },
    { "title": "Action Step Title", "action": "Specific action." },
    { "title": "Action Step Title", "action": "Specific action." }
  ]
}`;

  // ── Call Claude ─────────────────────────────────
  console.log('Step 2: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '');

    results = JSON.parse(raw);
    console.log('Step 2 done: Claude responded OK');
  } catch (aiErr) {
    console.error('AI / parse error:', aiErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate results. Please try again.' }) };
  }

  // ── Persist to Supabase ─────────────────────────
  try {
    await supabase.from('assessments').insert({
      access_code,
      email: resolvedEmail,
      answers,
      results,
    });

    await supabase
      .from('access_codes')
      .update({ assessment_completed: true })
      .eq('code', access_code);
  } catch (dbErr) {
    // Non-fatal — results already generated, just log
    console.error('Supabase persist error:', dbErr.message);
  }

  // ── Push Contact to Zoho CRM ────────────────────
  if (resolvedEmail && process.env.ZOHO_CLIENT_ID) {
    console.log('Step 3: Pushing to Zoho CRM...');
    try {
      await pushToZoho(resolvedEmail, results);
      console.log('Step 3 done: Zoho contact upserted');
    } catch (err) {
      console.error('Zoho push error (non-fatal):', err.message);
    }
  } else {
    console.log('Step 3 skipped: no email or Zoho not configured');
  }

  // ── Send Results Email via Resend ────────────────
  if (resolvedEmail && process.env.RESEND_API_KEY) {
    console.log('Step 4: Sending results email...');
    try {
      await sendResultsEmail(resolvedEmail, results);
      console.log('Step 4 done: results email sent');
    } catch (err) {
      console.error('Email send error (non-fatal):', err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  };
};

// ── EMAIL HELPER ─────────────────────────────────────────────
async function sendResultsEmail(email, results) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const careerPathsHtml = (results.career_paths || []).map(c => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#3D1F0D;font-size:15px;">→ ${c.title}</strong>
        <p style="margin:6px 0 0;color:#6B4C3B;font-size:14px;line-height:1.6;">${c.description}</p>
      </td>
    </tr>`).join('');

  const businessIdeasHtml = (results.business_ideas || []).map(b => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#3D1F0D;font-size:15px;">→ ${b.name}</strong>
        <p style="margin:6px 0 0;color:#6B4C3B;font-size:14px;line-height:1.6;">${b.description}</p>
      </td>
    </tr>`).join('');

  const roadmapHtml = (results.roadmap || []).map((s, i) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#3D1F0D;font-size:15px;">Step ${i + 1}: ${s.title}</strong>
        <p style="margin:6px 0 0;color:#6B4C3B;font-size:14px;line-height:1.6;">${s.action}</p>
      </td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FDF6ED;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF6ED;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#3D1F0D;border-radius:16px 16px 0 0;padding:32px;text-align:center;">
            <p style="margin:0 0 4px;color:#E8D5C0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">Changing Tribes</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Your Tribe Blueprint</h1>
          </td>
        </tr>

        <!-- TRIBE NAME -->
        <tr>
          <td style="background:#C85C2D;padding:24px 32px;text-align:center;">
            <p style="margin:0 0 4px;color:#FDF6ED;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Your Tribe Profile</p>
            <h2 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${results.tribe_name || ''}</h2>
          </td>
        </tr>

        <!-- TRIBE DESCRIPTION -->
        <tr>
          <td style="background:#ffffff;padding:32px;border-left:1px solid #E8D5C0;border-right:1px solid #E8D5C0;">
            <p style="margin:0;color:#6B4C3B;font-size:15px;line-height:1.75;">${results.tribe_description || ''}</p>
          </td>
        </tr>

        <!-- PAST ANALYSIS -->
        <tr>
          <td style="background:#FDF6ED;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 12px;color:#3D1F0D;font-size:18px;">🔍 Understanding Your Past</h3>
            <p style="margin:0;color:#6B4C3B;font-size:14px;line-height:1.75;">${results.past_analysis || ''}</p>
          </td>
        </tr>

        <!-- CAREER PATHS -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🧭 Your Next Career Paths</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
          </td>
        </tr>

        <!-- BUSINESS IDEAS -->
        <tr>
          <td style="background:#FDF6ED;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🚀 Business Ideas For You</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${businessIdeasHtml}</table>
          </td>
        </tr>

        <!-- ROADMAP -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🗺️ Your Transition Roadmap</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${roadmapHtml}</table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background:#3D1F0D;border-radius:0 0 16px 16px;padding:32px;text-align:center;">
            <p style="margin:0 0 16px;color:#E8D5C0;font-size:14px;line-height:1.6;">Ready to take the next step? Connect with the Changing Tribes community.</p>
            <a href="https://changingtribes.com" style="background:#C85C2D;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Visit Changing Tribes →</a>
            <p style="margin:24px 0 0;color:#6B4C3B;font-size:12px;">© 2024 Changing Tribes · <a href="https://changingtribes.com" style="color:#E8D5C0;">changingtribes.com</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: 'Tribe Blueprint <blueprint@changingtribes.com>',
    to: email,
    subject: `Your Tribe Blueprint: ${results.tribe_name || 'Results Inside'}`,
    html,
  });
}

// ── ZOHO CRM HELPER ─────────────────────────────────────────
// Uses the refresh token to get a short-lived access token, then
// upserts a Contact by email so duplicates are never created.

async function pushToZoho(email, results) {
  const datacenter = process.env.ZOHO_DATACENTER || 'com'; // com | eu | in | com.au

  // Step 1: exchange refresh token for access token
  const tokenRes = await fetch(
    `https://accounts.zoho.${datacenter}/oauth/v2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      }),
    }
  );

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    throw new Error(`Zoho token error: ${JSON.stringify(tokenData)}`);
  }

  // Step 2: derive a sensible name from the email address
  const namePart  = email.split('@')[0].replace(/[._-]+/g, ' ');
  const lastName  = namePart.charAt(0).toUpperCase() + namePart.slice(1);

  // Step 3: build the Contact payload
  // Uses Description to store the full tribe profile summary.
  // The "Lead_Source" picklist value must exist in your Zoho account —
  // change it if needed under Setup → CRM Settings → Picklists.
  const careerSummary = (results.career_paths || [])
    .map(c => `• ${c.title}`)
    .join('\n');

  const bizSummary = (results.business_ideas || [])
    .map(b => `• ${b.name}`)
    .join('\n');

  const description =
    `Tribe Blueprint Assessment\n` +
    `Tribe Profile: ${results.tribe_name || ''}\n\n` +
    `${results.tribe_description || ''}\n\n` +
    `Suggested Career Paths:\n${careerSummary}\n\n` +
    `Business Ideas:\n${bizSummary}`;

  const payload = {
    data: [
      {
        Last_Name:   lastName,
        Email:       email,
        Lead_Source: 'Web Download',   // ← change to match a value in your Zoho picklist
        Description: description,
      },
    ],
    duplicate_check_fields: ['Email'], // upsert — never creates a duplicate
  };

  // Step 4: upsert the Contact
  const contactRes = await fetch(
    `https://www.zohoapis.${datacenter}/crm/v2/Contacts/upsert`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const contactData = await contactRes.json();

  if (contactData.data && contactData.data[0].status === 'error') {
    throw new Error(`Zoho contact error: ${JSON.stringify(contactData.data[0])}`);
  }

  console.log('Zoho Contact upserted:', email, contactData.data?.[0]?.status);
  return contactData;
}
