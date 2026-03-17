// netlify/functions/compass-results.js
// Verifies the Compass access code, fetches Blueprint scores from Supabase,
// calls Claude API with Blueprint profile + direction statement,
// saves results, updates Zoho CRM, and sends results email.

const Anthropic      = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend }     = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Category labels — matches generate-results.js exactly
const QUESTION_LABELS = {
  q1:  { left: 'Working independently',                  right: 'Collaborating with a team',               category: 'How You Work' },
  q2:  { left: 'Routine and structure',                   right: 'Variety and spontaneity',                 category: 'How You Work' },
  q3:  { left: 'Following clear instructions',            right: 'Setting own direction',                   category: 'How You Work' },
  q4:  { left: 'Working behind the scenes',               right: 'Being the face of something',             category: 'How You Work' },
  q5:  { left: 'Hands-on / physical work',                right: 'Desk / digital work',                     category: 'How You Work' },
  q6:  { left: 'Analytical and logical thinking',         right: 'Creative and artistic expression',        category: 'What Energizes You' },
  q7:  { left: 'Motivated by stability',                  right: 'Motivated by growth and change',          category: 'What Energizes You' },
  q8:  { left: 'Helping individuals one-on-one',          right: 'Impacting large groups',                  category: 'What Energizes You' },
  q9:  { left: 'Working with data and systems',           right: 'Working with people and relationships',   category: 'What Energizes You' },
  q10: { left: 'Energized by competition',                right: 'Energized by cooperation',                category: 'What Energizes You' },
  q11: { left: 'Deep, specialized expertise',             right: 'Broad, generalist knowledge',             category: 'Your Skills & Strengths' },
  q12: { left: 'Attention to detail',                     right: 'Big-picture thinking',                    category: 'Your Skills & Strengths' },
  q13: { left: 'Creating new things',                     right: 'Managing and organizing',                 category: 'Your Skills & Strengths' },
  q14: { left: 'Communicating through writing',           right: 'Speaking / presenting',                   category: 'Your Skills & Strengths' },
  q15: { left: 'Execution and doing',                     right: 'Strategy and planning',                   category: 'Your Skills & Strengths' },
  q16: { left: 'Guaranteed, steady income',               right: 'Variable income with higher potential',   category: 'Risk & Change' },
  q17: { left: 'Established organizations',               right: 'Startups or building own thing',          category: 'Risk & Change' },
  q18: { left: 'Careful decisions after research',        right: 'Quick decisions on instinct',             category: 'Risk & Change' },
  q19: { left: 'Low-risk, stable situations',             right: 'High-risk, high-reward situations',       category: 'Risk & Change' },
  q20: { left: 'Gradual, incremental change',             right: 'Bold leaps and big pivots',               category: 'Risk & Change' },
  q21: { left: 'Financial security is top priority',      right: 'Personal fulfillment / purpose is top priority', category: 'Your Values & Vision' },
  q22: { left: 'Work-life balance non-negotiable',        right: 'Will sacrifice balance for success',      category: 'Your Values & Vision' },
  q23: { left: 'Local / community-level impact',          right: 'Global / large-scale impact',             category: 'Your Values & Vision' },
  q24: { left: 'Prefers being an employee',               right: 'Prefers being own boss',                  category: 'Your Values & Vision' },
  q25: { left: 'Driven by day-to-day enjoyment',          right: 'Driven by legacy and reputation',         category: 'Your Values & Vision' },
  q26: { left: 'Built or managed systems, processes, and operations', right: 'Sold, pitched, or persuaded people to buy or act', category: "What You've Built & Done" },
  q27: { left: 'Coached, taught, or developed other people',          right: 'Created original content, products, or creative work', category: "What You've Built & Done" },
  q28: { left: 'Led or managed teams and organizations',              right: 'Built deep technical skills or specialized expertise', category: "What You've Built & Done" },
  q29: { left: 'Strongest experience in large, established organizations', right: 'Strongest experience in small teams, startups, or self-directed work', category: "What You've Built & Done" },
  q30: { left: 'Worked primarily within one industry or field',       right: 'Worked across multiple industries, worn many hats', category: "What You've Built & Done" },
  q31: { left: 'Works best through screens and digital communication', right: 'Works best in person — physical presence matters', category: 'Your Human Edge' },
  q32: { left: 'Most effective with information, data, or content',   right: 'Most effective with emotions, relationships, wellbeing', category: 'Your Human Edge' },
  q33: { left: 'Relies on proven frameworks and best practices',      right: 'Relies on gut instinct and reading human situations', category: 'Your Human Edge' },
  q34: { left: 'Prefers clearly defined problems with known solutions', right: 'Thrives on messy, ambiguous, human situations', category: 'Your Human Edge' },
  q35: { left: 'Energized by efficiency, scale, and systems',         right: 'Energized by deep, meaningful impact on specific people', category: 'Your Human Edge' },
  q36: { left: 'Wants to work locally, embedded in community',        right: 'Wants to work nationally or globally, location-independent', category: 'Your World & Context' },
  q37: { left: 'Needs income from next move within ~6 months',        right: 'Has a year or more before needing income from something new', category: 'Your World & Context' },
  q38: { left: 'Wants to work alone or with a very small team',       right: 'Wants to build a team and organization', category: 'Your World & Context' },
  q39: { left: 'Wants to serve individuals directly (B2C)',           right: 'Wants to serve businesses or organizations (B2B)', category: 'Your World & Context' },
  q40: { left: 'Drawn to the physical world — products, places, nature, food', right: 'Drawn to the digital/ideas world — online, knowledge, content, software', category: 'Your World & Context' },
};

function buildScoreSummary(answers) {
  const groups = {};
  Object.entries(answers).forEach(([id, score]) => {
    const q = QUESTION_LABELS[id];
    if (!q) return;
    const s = parseInt(score, 10);
    const tendency =
      s <= 2 ? `strongly leans toward "${q.left}"` :
      s <= 4 ? `leans toward "${q.left}"` :
      s === 5 ? `balanced between "${q.left}" and "${q.right}"` :
      s <= 7 ? `leans toward "${q.right}"` :
               `strongly leans toward "${q.right}"`;
    if (!groups[q.category]) groups[q.category] = [];
    groups[q.category].push(`  - ${tendency} (${s}/10)`);
  });

  const order = [
    'How You Work', 'What Energizes You', 'Your Skills & Strengths',
    'Risk & Change', 'Your Values & Vision',
    "What You've Built & Done", 'Your Human Edge', 'Your World & Context',
  ];
  return order
    .filter(c => groups[c])
    .map(c => `${c}:\n${groups[c].join('\n')}`)
    .join('\n\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, access_code, direction;
  try {
    ({ email, access_code, direction } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // ── Verify access code ──────────────────────────
  console.log('Compass Step 1: Verifying access code...');
  const { data: accessData, error: accessErr } = await supabase
    .from('access_codes')
    .select('*')
    .eq('code', access_code)
    .single();

  if (accessErr || !accessData) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Invalid or expired access code' }) };
  }
  console.log('Compass Step 1 done: access code valid');

  const resolvedEmail = email || accessData.email || '';

  // ── Fetch Blueprint scores from Supabase ────────
  console.log('Compass Step 2: Fetching Blueprint scores...');
  let blueprintAnswers = null;
  let blueprintTribeName = '';

  const { data: blueprintData } = await supabase
    .from('assessments')
    .select('answers, results')
    .eq('email', resolvedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (blueprintData) {
    blueprintAnswers  = blueprintData.answers;
    blueprintTribeName = blueprintData.results?.tribe_name || '';
    console.log('Compass Step 2 done: Blueprint scores found for', resolvedEmail);
  } else {
    console.log('Compass Step 2: No Blueprint scores found — proceeding with direction only');
  }

  // ── Build Claude prompt ─────────────────────────
  const scoreSummary = blueprintAnswers
    ? buildScoreSummary(blueprintAnswers)
    : 'No Blueprint assessment scores available — generate based on direction statement alone.';

  const blueprintContext = blueprintTribeName
    ? `Their Tribes Blueprint archetype is: "${blueprintTribeName}".`
    : '';

  const prompt = `You are a deeply insightful career strategist and business advisor working with Changing Tribes — a platform that helps people navigate major professional transitions.

A person has completed the Tribes Blueprint 40-question assessment and is now using Tribes Compass to map their specific direction. ${blueprintContext}

THEIR DIRECTION STATEMENT (what they want to do next):
"${direction || 'Not specified'}"

THEIR TRIBES BLUEPRINT PROFILE (40-question assessment scores):
${scoreSummary}

YOUR TASK:
Generate a rich, specific Tribes Compass report that sits at the intersection of WHO THEY ARE (their Blueprint profile) and WHERE THEY WANT TO GO (their direction statement). Every recommendation must reflect both dimensions — not just their personality, and not just their stated direction, but the precise overlap.

CRITICAL REQUIREMENTS:
1. CAREER PATHS must be at the intersection of their profile AND their direction. For each career, provide a 10-year arc in three phases.
2. BUSINESS MODELS must be at the intersection of their proven skills AND their direction. Each must be AI-resistant — explain specifically why human presence, judgment, or relationships make it hard to automate.
3. ACTION PLAN must be a 90-day biweekly plan with concrete, specific actions — not general advice.
4. Reference their Human Edge scores (q31–q35) when explaining AI-resistance.
5. Reference their World & Context scores (q36–q40) to calibrate urgency, scale, and B2B vs B2C.
6. Speak directly to the person as "you" — warm, specific, and encouraging.

Return ONLY valid JSON — no markdown fences, no explanation — with this exact structure:

{
  "compass_title": "A short evocative title for their specific direction (e.g. 'The Animal Welfare Advocate' or 'The Healthcare Connector')",
  "compass_intro": "2–3 sentences bridging their Blueprint archetype with their stated direction — what makes this combination uniquely powerful.",
  "career_paths": [
    {
      "title": "Specific Career Title",
      "why_it_fits": "2 sentences on why this career sits exactly at the intersection of their profile and direction.",
      "ai_resistance": "1–2 sentences on why this career is resilient to AI — what human qualities make it irreplaceable.",
      "years_1_3": "What this career looks like in years 1–3: entry point, typical roles, income range, key skills to build.",
      "years_4_7": "What this career looks like in years 4–7: progression, specialization, leadership or autonomy.",
      "years_8_10": "What this career looks like in years 8–10: where the best practitioners land, income ceiling, legacy."
    },
    { "title": "...", "why_it_fits": "...", "ai_resistance": "...", "years_1_3": "...", "years_4_7": "...", "years_8_10": "..." },
    { "title": "...", "why_it_fits": "...", "ai_resistance": "...", "years_1_3": "...", "years_4_7": "...", "years_8_10": "..." }
  ],
  "business_models": [
    {
      "name": "Specific Business Name or Type",
      "description": "2 sentences on what the business is and why it fits their profile and direction.",
      "revenue_model": "How it makes money — specific pricing model, typical rates or revenue range.",
      "time_to_income": "Realistic time from starting to first paying client or revenue.",
      "ai_resistance": "1–2 sentences on why this business depends on human skills AI cannot replicate."
    },
    { "name": "...", "description": "...", "revenue_model": "...", "time_to_income": "...", "ai_resistance": "..." },
    { "name": "...", "description": "...", "revenue_model": "...", "time_to_income": "...", "ai_resistance": "..." }
  ],
  "action_plan": [
    { "period": "Week 1–2", "title": "Action Step Title", "action": "Specific, concrete actions for this fortnight." },
    { "period": "Week 3–4", "title": "Action Step Title", "action": "Specific actions." },
    { "period": "Week 5–6", "title": "Action Step Title", "action": "Specific actions." },
    { "period": "Week 7–8", "title": "Action Step Title", "action": "Specific actions." },
    { "period": "Week 9–10", "title": "Action Step Title", "action": "Specific actions." },
    { "period": "Week 11–12", "title": "Action Step Title", "action": "Specific actions." }
  ]
}`;

  // ── Call Claude ─────────────────────────────────
  console.log('Compass Step 3: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '');

    results = JSON.parse(raw);
    console.log('Compass Step 3 done: Claude responded OK');
  } catch (aiErr) {
    console.error('Compass AI / parse error:', aiErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate results. Please try again.' }) };
  }

  // ── Persist to Supabase ─────────────────────────
  try {
    await supabase.from('compass_assessments').insert({
      access_code,
      email:                resolvedEmail,
      direction_statement:  direction,
      blueprint_answers:    blueprintAnswers,
      results,
    });

    await supabase
      .from('access_codes')
      .update({ assessment_completed: true })
      .eq('code', access_code);
  } catch (dbErr) {
    console.error('Compass Supabase persist error:', dbErr.message);
  }

  // ── Update Zoho CRM Contact ─────────────────────
  if (resolvedEmail && process.env.ZOHO_CLIENT_ID) {
    console.log('Compass Step 4: Updating Zoho CRM...');
    try {
      await updateZohoWithCompass(resolvedEmail, direction, results);
      console.log('Compass Step 4 done: Zoho updated');
    } catch (err) {
      console.error('Compass Zoho error (non-fatal):', err.message);
    }
  }

  // ── Send Results Email ──────────────────────────
  if (resolvedEmail && process.env.RESEND_API_KEY) {
    console.log('Compass Step 5: Sending results email...');
    try {
      await sendCompassEmail(resolvedEmail, direction, results);
      console.log('Compass Step 5 done: email sent');
    } catch (err) {
      console.error('Compass email error (non-fatal):', err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  };
};

// ── ZOHO UPDATE ──────────────────────────────────────────────
async function updateZohoWithCompass(email, direction, results) {
  const datacenter = process.env.ZOHO_DATACENTER || 'com';

  const tokenRes = await fetch(
    `https://accounts.zoho.${datacenter}/oauth/v2/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      }),
    }
  );

  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) throw new Error('Zoho token error');

  const careerSummary = (results.career_paths || [])
    .map(c => `• ${c.title}\n  ${c.why_it_fits}\n  10-year arc: ${c.years_1_3} → ${c.years_4_7} → ${c.years_8_10}`)
    .join('\n\n');

  const bizSummary = (results.business_models || [])
    .map(b => `• ${b.name}\n  ${b.description}\n  Revenue: ${b.revenue_model} | Time to income: ${b.time_to_income}`)
    .join('\n\n');

  const actionSummary = (results.action_plan || [])
    .map(a => `${a.period} — ${a.title}: ${a.action}`)
    .join('\n');

  const compassNote =
    `\n\n━━━ TRIBES COMPASS RESULTS ━━━\n` +
    `Direction: "${direction}"\n` +
    `Profile: ${results.compass_title || ''}\n\n` +
    `${results.compass_intro || ''}\n\n` +
    `━━━ CAREER PATHS (10-YEAR ARCS) ━━━\n${careerSummary}\n\n` +
    `━━━ BUSINESS MODELS ━━━\n${bizSummary}\n\n` +
    `━━━ 90-DAY ACTION PLAN ━━━\n${actionSummary}`;

  const namePart = email.split('@')[0].replace(/[._-]+/g, ' ');
  const lastName  = namePart.charAt(0).toUpperCase() + namePart.slice(1);

  await fetch(
    `https://www.zohoapis.${datacenter}/crm/v2/Contacts/upsert`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{ Last_Name: lastName, Email: email, Description: compassNote }],
        duplicate_check_fields: ['Email'],
      }),
    }
  );
}

// ── EMAIL ────────────────────────────────────────────────────
async function sendCompassEmail(email, direction, results) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const careerPathsHtml = (results.career_paths || []).map(c => `
    <tr>
      <td style="padding:20px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#3D1F0D;font-size:15px;">→ ${c.title}</strong>
        <p style="margin:6px 0 4px;color:#6B4C3B;font-size:14px;line-height:1.6;">${c.why_it_fits}</p>
        <p style="margin:4px 0 2px;color:#2D5016;font-size:13px;font-style:italic;">🛡️ ${c.ai_resistance}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
          <tr>
            <td style="background:#FDF6ED;border-radius:8px;padding:10px 14px;font-size:13px;color:#6B4C3B;">
              <strong style="color:#3D1F0D;">Years 1–3:</strong> ${c.years_1_3}<br>
              <strong style="color:#3D1F0D;">Years 4–7:</strong> ${c.years_4_7}<br>
              <strong style="color:#3D1F0D;">Years 8–10:</strong> ${c.years_8_10}
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const businessHtml = (results.business_models || []).map(b => `
    <tr>
      <td style="padding:20px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#3D1F0D;font-size:15px;">→ ${b.name}</strong>
        <p style="margin:6px 0 4px;color:#6B4C3B;font-size:14px;line-height:1.6;">${b.description}</p>
        <p style="margin:4px 0 2px;color:#6B4C3B;font-size:13px;">💰 <strong>Revenue:</strong> ${b.revenue_model}</p>
        <p style="margin:4px 0 2px;color:#6B4C3B;font-size:13px;">⏱️ <strong>Time to income:</strong> ${b.time_to_income}</p>
        <p style="margin:4px 0;color:#2D5016;font-size:13px;font-style:italic;">🛡️ ${b.ai_resistance}</p>
      </td>
    </tr>`).join('');

  const actionHtml = (results.action_plan || []).map(a => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#C85C2D;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">${a.period}</strong>
        <strong style="display:block;color:#3D1F0D;font-size:15px;margin:4px 0;">${a.title}</strong>
        <p style="margin:0;color:#6B4C3B;font-size:14px;line-height:1.6;">${a.action}</p>
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
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Your Tribes Compass</h1>
          </td>
        </tr>

        <!-- COMPASS TITLE -->
        <tr>
          <td style="background:#C85C2D;padding:24px 32px;text-align:center;">
            <p style="margin:0 0 4px;color:#FDF6ED;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Your Direction Profile</p>
            <h2 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${results.compass_title || ''}</h2>
          </td>
        </tr>

        <!-- DIRECTION + INTRO -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border-left:1px solid #E8D5C0;border-right:1px solid #E8D5C0;">
            <p style="margin:0 0 12px;color:#C85C2D;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Your Direction</p>
            <p style="margin:0 0 16px;color:#3D1F0D;font-size:16px;font-style:italic;line-height:1.6;">"${direction}"</p>
            <p style="margin:0;color:#6B4C3B;font-size:15px;line-height:1.75;">${results.compass_intro || ''}</p>
          </td>
        </tr>

        <!-- CAREER PATHS -->
        <tr>
          <td style="background:#FDF6ED;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🧭 Your Career Paths — 10-Year View</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
          </td>
        </tr>

        <!-- BUSINESS MODELS -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🚀 Business Models For You</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${businessHtml}</table>
          </td>
        </tr>

        <!-- ACTION PLAN -->
        <tr>
          <td style="background:#FDF6ED;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 4px;color:#3D1F0D;font-size:18px;">🗺️ Your 90-Day Action Plan</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${actionHtml}</table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background:#3D1F0D;border-radius:0 0 16px 16px;padding:32px;text-align:center;">
            <p style="margin:0 0 16px;color:#E8D5C0;font-size:14px;line-height:1.6;">Ready to take action? Connect with the Changing Tribes community.</p>
            <a href="https://changingtribes.com" style="background:#C85C2D;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Visit Changing Tribes →</a>
            <p style="margin:24px 0 0;color:#6B4C3B;font-size:12px;">© 2025 Changing Tribes · <a href="https://changingtribes.com" style="color:#E8D5C0;">changingtribes.com</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from:    'Tribes Compass <blueprint@changingtribes.com>',
    to:      email,
    subject: `Your Tribes Compass: ${results.compass_title || 'Results Inside'}`,
    html,
  });
}
