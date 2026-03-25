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

  const prompt = `You are a world-class career strategist, business advisor, and executive coach working with Changing Tribes — a platform that helps people navigate major professional transitions with clarity and confidence.

A person has completed the Tribes Blueprint 40-question assessment and is now using Tribes Compass to map their specific direction. ${blueprintContext}

THEIR DIRECTION STATEMENT (what they want to do next):
"${direction || 'Not specified'}"

THEIR TRIBES BLUEPRINT PROFILE (40-question assessment scores):
${scoreSummary}

YOUR TASK:
Generate a personal Tribes Compass report. Be specific to this person — reference their actual scores and direction. Speak as "you". Name real industries, platforms, income numbers.

CRITICAL FORMATTING RULE: Your response MUST start with { and end with }. No backticks, no markdown, no text before or after the JSON. Every string value must be 1 sentence only — no exceptions. The JSON must complete fully within the token limit.

{
  "compass_title": "Short evocative title",
  "compass_intro": "1 sentence on what makes their profile and direction uniquely powerful.",
  "profile_snapshot": {
    "archetype_headline": "1 punchy sentence capturing who this person is professionally.",
    "core_strengths": ["Strength 1", "Strength 2", "Strength 3", "Strength 4"],
    "ai_resistance": "1 sentence: what makes this person hard to replace with AI.",
    "biggest_risk": "1 sentence: the one blind spot to watch out for."
  },
  "career_paths": [
    {
      "title": "Specific Career Title",
      "why_it_fits": "1 sentence grounded in their scores and direction.",
      "income_reality": "Real income range e.g. $60–90k years 1–3, $120–180k by year 7.",
      "years_1_3": "1 sentence: entry point, first roles, realistic income.",
      "years_4_7": "1 sentence: progression path and income growth.",
      "years_8_10": "1 sentence: where top practitioners land and income ceiling.",
      "ai_resistance": "1 sentence on why this is hard to automate."
    },
    { "title": "...", "why_it_fits": "...", "income_reality": "...", "years_1_3": "...", "years_4_7": "...", "years_8_10": "...", "ai_resistance": "..." },
    { "title": "...", "why_it_fits": "...", "income_reality": "...", "years_1_3": "...", "years_4_7": "...", "years_8_10": "...", "ai_resistance": "..." }
  ],
  "careers_to_avoid": [
    { "title": "Career to Avoid", "reason": "1 sentence: why this conflicts with their profile." },
    { "title": "Career to Avoid", "reason": "1 sentence." }
  ],
  "business_models": [
    {
      "name": "Specific Business Name",
      "concept": "1 sentence: what this business does.",
      "why_it_fits": "1 sentence: why this matches their skills.",
      "startup_cost": "e.g. $500–$2,000",
      "year_1_target": "e.g. $40,000–$70,000",
      "year_3_potential": "e.g. $120,000–$180,000",
      "first_client_path": "1 sentence: specific first step to land a paying client.",
      "ai_resistance": "1 sentence on why this needs irreplaceable human skills."
    },
    { "name": "...", "concept": "...", "why_it_fits": "...", "startup_cost": "...", "year_1_target": "...", "year_3_potential": "...", "first_client_path": "...", "ai_resistance": "..." },
    { "name": "...", "concept": "...", "why_it_fits": "...", "startup_cost": "...", "year_1_target": "...", "year_3_potential": "...", "first_client_path": "...", "ai_resistance": "..." }
  ],
  "work_environment": {
    "ideal_setup": "1 sentence: the work setup where this person thrives.",
    "ideal_culture": "1 sentence: the culture that brings out their best.",
    "red_flags": ["Red flag role/environment 1", "Red flag role/environment 2", "Red flag role/environment 3"]
  },
  "action_plan": [
    { "period": "Week 1–2", "title": "Step Title", "action": "1–2 specific actions naming real platforms or communities." },
    { "period": "Week 3–4", "title": "Step Title", "action": "1–2 specific actions." },
    { "period": "Week 5–6", "title": "Step Title", "action": "1–2 specific actions." },
    { "period": "Week 7–8", "title": "Step Title", "action": "1–2 specific actions." },
    { "period": "Week 9–10", "title": "Step Title", "action": "1–2 specific actions." },
    { "period": "Week 11–12", "title": "Step Title", "action": "1–2 specific actions — what do they have to show after 90 days?" }
  ],
  "resources": {
    "books": [
      { "title": "Book Title by Author", "why": "1 sentence." },
      { "title": "Book Title by Author", "why": "1 sentence." },
      { "title": "Book Title by Author", "why": "1 sentence." }
    ],
    "communities": [
      { "name": "Community Name", "why": "1 sentence." },
      { "name": "Community Name", "why": "1 sentence." },
      { "name": "Community Name", "why": "1 sentence." }
    ],
    "tools": [
      { "name": "Tool Name", "why": "1 sentence." },
      { "name": "Tool Name", "why": "1 sentence." },
      { "name": "Tool Name", "why": "1 sentence." }
    ]
  }
}`;

  // ── Call Claude ─────────────────────────────────
  console.log('Compass Step 3: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system:     'You output raw JSON only. Never use markdown. Never use backticks. Every string value must be exactly 1 sentence — be specific and name real industries, income numbers, and platforms, but keep it to one sentence per field so the JSON completes fully.',
      messages:   [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '{'   },
      ],
    });

    console.log('Compass stop_reason:', message.stop_reason, '| output_tokens:', message.usage?.output_tokens);
    const rawText = '{' + message.content[0].text;
    console.log('Compass raw (first 300):', rawText.slice(0, 300));

    results = JSON.parse(rawText);
    console.log('Compass Step 3 done: Claude responded OK');
  } catch (aiErr) {
    console.error('Compass AI / parse error:', aiErr.constructor.name, aiErr.message);
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

  const snap2 = results.profile_snapshot || {};
  const careerSummary = (results.career_paths || [])
    .map(c => `• ${c.title}\n  ${c.why_it_fits}\n  Income: ${c.income_reality}\n  Arc: ${c.years_1_3} → ${c.years_4_7} → ${c.years_8_10}\n  Break in: ${c.how_to_break_in}`)
    .join('\n\n');

  const avoidSummary = (results.careers_to_avoid || [])
    .map(a => `• ${a.title}: ${a.reason}`)
    .join('\n\n');

  const bizSummary = (results.business_models || [])
    .map(b => `• ${b.name}\n  ${b.concept}\n  ${b.why_it_fits}\n  Startup cost: ${b.startup_cost} | Y1: ${b.year_1_target} | Y3: ${b.year_3_potential}\n  First client: ${b.first_client_path}`)
    .join('\n\n');

  const actionSummary = (results.action_plan || [])
    .map(a => `${a.period} — ${a.title}: ${a.action}`)
    .join('\n');

  const compassNote =
    `\n\n━━━ TRIBES COMPASS RESULTS ━━━\n` +
    `Direction: "${direction}"\n` +
    `Profile: ${results.compass_title || ''}\n\n` +
    `${results.compass_intro || ''}\n\n` +
    `━━━ PROFILE SNAPSHOT ━━━\n` +
    `${snap2.archetype_headline || ''}\n` +
    `Strengths: ${(snap2.core_strengths || []).join(', ')}\n` +
    `AI-Resistance: ${snap2.ai_resistance || ''}\n` +
    `Biggest Risk: ${snap2.biggest_risk || ''}\n\n` +
    `━━━ CAREER PATHS (10-YEAR ARCS) ━━━\n${careerSummary}\n\n` +
    `━━━ CAREERS TO AVOID ━━━\n${avoidSummary}\n\n` +
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

  // ── Profile Snapshot ──
  const snap = results.profile_snapshot || {};
  const strengthsHtml = (snap.core_strengths || []).map(s =>
    `<span style="display:inline-block;background:#FDF6ED;border:1px solid #E8D5C0;border-radius:20px;padding:4px 12px;margin:3px 4px 3px 0;font-size:13px;color:#3D1F0D;font-weight:600;">${s}</span>`
  ).join('');

  // ── Career Paths ──
  const careerPathsHtml = (results.career_paths || []).map((c, i) => `
    <tr>
      <td style="padding:24px 0;border-bottom:2px solid #E8D5C0;">
        <p style="margin:0 0 4px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Career Path ${i + 1}</p>
        <strong style="color:#3D1F0D;font-size:17px;display:block;margin-bottom:10px;">→ ${c.title}</strong>
        <p style="margin:0 0 10px;color:#6B4C3B;font-size:14px;line-height:1.7;">${c.why_it_fits}</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr>
            <td style="background:#FFF8F0;border-left:3px solid #E8943A;border-radius:0 8px 8px 0;padding:12px 16px;">
              <p style="margin:0 0 4px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">A Day in the Life</p>
              <p style="margin:0;color:#6B4C3B;font-size:13px;line-height:1.65;font-style:italic;">${c.day_in_the_life}</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr>
            <td style="background:#F0F7F0;border-left:3px solid #4A7C59;border-radius:0 8px 8px 0;padding:10px 14px;">
              <p style="margin:0 0 2px;color:#2D5016;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">💰 Income Reality</p>
              <p style="margin:0;color:#3D5030;font-size:13px;line-height:1.6;">${c.income_reality}</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #E8D5C0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#FDF6ED;padding:12px 14px;border-bottom:1px solid #E8D5C0;">
              <strong style="color:#3D1F0D;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">📅 Your 10-Year Arc</strong>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
              <strong style="color:#C85C2D;font-size:12px;">Years 1–3 · Getting In</strong>
              <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_1_3}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
              <strong style="color:#C85C2D;font-size:12px;">Years 4–7 · Building Authority</strong>
              <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_4_7}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;">
              <strong style="color:#C85C2D;font-size:12px;">Years 8–10 · Legacy & Leadership</strong>
              <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_8_10}</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td style="background:#EEF3FF;border-left:3px solid #4466CC;border-radius:0 8px 8px 0;padding:10px 14px;">
              <p style="margin:0 0 2px;color:#2244AA;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">🚪 How to Break In</p>
              <p style="margin:0;color:#334488;font-size:13px;line-height:1.6;">${c.how_to_break_in}</p>
            </td>
          </tr>
        </table>
        <p style="margin:8px 0 0;color:#9A6B5A;font-size:12px;font-style:italic;">⚠️ Watch out for: ${c.watch_out_for}</p>
        <p style="margin:8px 0 0;color:#2D5016;font-size:12px;font-style:italic;">🛡️ AI-resistant because: ${c.ai_resistance}</p>
      </td>
    </tr>`).join('');

  // ── Careers to Avoid ──
  const avoidHtml = (results.careers_to_avoid || []).map(a => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F5E0E0;">
        <strong style="color:#8B2020;font-size:14px;">✗ ${a.title}</strong>
        <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${a.reason}</p>
      </td>
    </tr>`).join('');

  // ── Business Models ──
  const businessHtml = (results.business_models || []).map((b, i) => `
    <tr>
      <td style="padding:24px 0;border-bottom:2px solid #E8D5C0;">
        <p style="margin:0 0 4px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Business Idea ${i + 1}</p>
        <strong style="color:#3D1F0D;font-size:17px;display:block;margin-bottom:6px;">→ ${b.name}</strong>
        <p style="margin:0 0 10px;color:#6B4C3B;font-size:14px;line-height:1.7;">${b.concept}</p>
        <p style="margin:0 0 12px;color:#6B4C3B;font-size:14px;line-height:1.7;">${b.why_it_fits}</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #E8D5C0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
              <strong style="color:#3D1F0D;font-size:12px;">💸 Startup Cost:</strong>
              <span style="color:#6B4C3B;font-size:13px;"> ${b.startup_cost}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
              <strong style="color:#3D1F0D;font-size:12px;">🎯 Year 1 Target:</strong>
              <span style="color:#6B4C3B;font-size:13px;"> ${b.year_1_target}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;">
              <strong style="color:#3D1F0D;font-size:12px;">📈 Year 3 Potential:</strong>
              <span style="color:#6B4C3B;font-size:13px;"> ${b.year_3_potential}</span>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td style="background:#EEF3FF;border-left:3px solid #4466CC;border-radius:0 8px 8px 0;padding:10px 14px;">
              <p style="margin:0 0 2px;color:#2244AA;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">🤝 How to Get Your First Client</p>
              <p style="margin:0;color:#334488;font-size:13px;line-height:1.6;">${b.first_client_path}</p>
            </td>
          </tr>
        </table>
        <p style="margin:8px 0 0;color:#2D5016;font-size:12px;font-style:italic;">🛡️ AI-resistant because: ${b.ai_resistance}</p>
        <p style="margin:6px 0 0;color:#6B4C3B;font-size:12px;font-style:italic;">🤝 Ideal partner: ${b.ideal_partner}</p>
      </td>
    </tr>`).join('');

  // ── Work Environment ──
  const env = results.work_environment || {};
  const redFlagsHtml = (env.red_flags || []).map(f =>
    `<li style="margin-bottom:6px;color:#8B2020;font-size:13px;">${f}</li>`
  ).join('');

  // ── Action Plan ──
  const actionHtml = (results.action_plan || []).map(a => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #E8D5C0;">
        <strong style="color:#C85C2D;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">${a.period}</strong>
        <strong style="display:block;color:#3D1F0D;font-size:15px;margin:4px 0 8px;">${a.title}</strong>
        <p style="margin:0;color:#6B4C3B;font-size:14px;line-height:1.7;">${a.action}</p>
      </td>
    </tr>`).join('');

  // ── Resources ──
  const res = results.resources || {};
  const booksHtml = (res.books || []).map(b =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">📖 ${b.title}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${b.why}</p></td></tr>`
  ).join('');
  const communitiesHtml = (res.communities || []).map(c =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">🌐 ${c.name}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${c.why}</p></td></tr>`
  ).join('');
  const toolsHtml = (res.tools || []).map(t =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">🛠️ ${t.name}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${t.why}</p></td></tr>`
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FDF6ED;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF6ED;padding:40px 20px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#3D1F0D;border-radius:16px 16px 0 0;padding:36px 32px;text-align:center;">
            <p style="margin:0 0 6px;color:#E8D5C0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Changing Tribes</p>
            <h1 style="margin:0 0 6px;color:#ffffff;font-size:30px;font-weight:700;">Your Tribes Compass</h1>
            <p style="margin:0;color:#E8D5C0;font-size:13px;opacity:0.8;">Your complete career & business roadmap</p>
          </td>
        </tr>

        <!-- COMPASS TITLE -->
        <tr>
          <td style="background:linear-gradient(135deg,#C85C2D,#E8943A);padding:24px 32px;text-align:center;">
            <p style="margin:0 0 6px;color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Your Direction Profile</p>
            <h2 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${results.compass_title || ''}</h2>
          </td>
        </tr>

        <!-- DIRECTION + INTRO -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border-left:1px solid #E8D5C0;border-right:1px solid #E8D5C0;">
            <p style="margin:0 0 8px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Your Direction</p>
            <p style="margin:0 0 18px;color:#3D1F0D;font-size:16px;font-style:italic;line-height:1.65;border-left:3px solid #E8943A;padding-left:14px;">"${direction}"</p>
            <p style="margin:0;color:#6B4C3B;font-size:15px;line-height:1.8;">${results.compass_intro || ''}</p>
          </td>
        </tr>

        <!-- PROFILE SNAPSHOT -->
        <tr>
          <td style="background:#FDF6ED;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">🧬 Your Profile Snapshot</h3>
            <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${snap.archetype_headline || ''}</p>

            <p style="margin:0 0 8px;color:#3D1F0D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Your Core Strengths</p>
            <div style="margin-bottom:16px;">${strengthsHtml}</div>

            <p style="margin:0 0 8px;color:#3D1F0D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">How You Work Best</p>
            <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${snap.working_style || ''}</p>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#F0F7F0;border-radius:8px;padding:14px 16px;border-left:3px solid #4A7C59;margin-bottom:10px;display:block;">
                  <p style="margin:0 0 4px;color:#2D5016;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">🛡️ Your AI-Resistance Profile</p>
                  <p style="margin:0;color:#3D5030;font-size:13px;line-height:1.6;">${snap.ai_resistance || ''}</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
              <tr>
                <td style="background:#FFF3F3;border-radius:8px;padding:14px 16px;border-left:3px solid #CC4444;">
                  <p style="margin:0 0 4px;color:#8B2020;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">⚠️ Your Biggest Risk to Watch</p>
                  <p style="margin:0;color:#5A1A1A;font-size:13px;line-height:1.6;">${snap.biggest_risk || ''}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CAREER PATHS -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🧭 Your Career Paths — Full 10-Year View</h3>
            <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Five to six paths matched to who you are and where you want to go.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
          </td>
        </tr>

        <!-- CAREERS TO AVOID -->
        <tr>
          <td style="background:#FFF8F8;padding:24px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 6px;color:#8B2020;font-size:17px;font-weight:700;">⛔ Careers to Avoid</h3>
            <p style="margin:0 0 16px;color:#9A7A6A;font-size:13px;">These paths would drain you — here's why, based on your specific profile.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${avoidHtml}</table>
          </td>
        </tr>

        <!-- BUSINESS MODELS -->
        <tr>
          <td style="background:#FDF6ED;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🚀 Business Models Built for You</h3>
            <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Five to six business ideas tailored to your skills, direction, and practical context.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${businessHtml}</table>
          </td>
        </tr>

        <!-- WORK ENVIRONMENT -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">🏡 Your Ideal Work Environment</h3>

            <p style="margin:0 0 6px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Where You Thrive</p>
            <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${env.ideal_setup || ''}</p>

            <p style="margin:0 0 6px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Your Ideal Team</p>
            <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${env.ideal_team || ''}</p>

            <p style="margin:0 0 8px;color:#8B2020;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Red Flags — Walk Away From These</p>
            <ul style="margin:0 0 16px;padding-left:18px;">${redFlagsHtml}</ul>

            <p style="margin:0 0 6px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Your Leadership Style</p>
            <p style="margin:0;color:#6B4C3B;font-size:14px;line-height:1.75;">${env.leadership_style || ''}</p>
          </td>
        </tr>

        <!-- 90-DAY ACTION PLAN -->
        <tr>
          <td style="background:#FDF6ED;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🗺️ Your 90-Day Action Plan</h3>
            <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Fortnightly steps — specific, concrete, and calibrated to your timeline.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${actionHtml}</table>
          </td>
        </tr>

        <!-- RESOURCES -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">📚 Resources Matched to You</h3>
            <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Books</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${booksHtml}</table>
            <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Communities & Networks</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${communitiesHtml}</table>
            <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Tools & Platforms</p>
            <table width="100%" cellpadding="0" cellspacing="0">${toolsHtml}</table>
          </td>
        </tr>

        <!-- CLOSING MESSAGE -->
        <tr>
          <td style="background:linear-gradient(160deg,#FFF3E0,#FFE4B5);padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
            <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">✉️ A Note for the Road</h3>
            <p style="margin:0;color:#5A3A2A;font-size:15px;line-height:1.85;white-space:pre-line;">${results.closing_message || ''}</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background:#3D1F0D;border-radius:0 0 16px 16px;padding:36px 32px;text-align:center;">
            <p style="margin:0 0 20px;color:#E8D5C0;font-size:14px;line-height:1.7;">Ready to take action? Connect with the Changing Tribes community and share your compass results.</p>
            <a href="https://changingtribes.com" style="background:#C85C2D;color:#ffffff;padding:16px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Visit Changing Tribes →</a>
            <p style="margin:28px 0 0;color:#6B4C3B;font-size:12px;">© 2025 Changing Tribes · <a href="https://changingtribes.com" style="color:#E8D5C0;">changingtribes.com</a></p>
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
