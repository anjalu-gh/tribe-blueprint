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

// Human-readable labels for all 40 questions
const QUESTION_LABELS = {
  // ── HOW YOU WORK ──
  q1:  { left: 'Working independently',                  right: 'Collaborating with a team',               category: 'How You Work' },
  q2:  { left: 'Routine and structure',                   right: 'Variety and spontaneity',                 category: 'How You Work' },
  q3:  { left: 'Following clear instructions',            right: 'Setting own direction',                   category: 'How You Work' },
  q4:  { left: 'Working behind the scenes',               right: 'Being the face of something',             category: 'How You Work' },
  q5:  { left: 'Hands-on / physical work',                right: 'Desk / digital work',                     category: 'How You Work' },
  // ── WHAT ENERGIZES YOU ──
  q6:  { left: 'Analytical and logical thinking',         right: 'Creative and artistic expression',        category: 'What Energizes You' },
  q7:  { left: 'Motivated by stability',                  right: 'Motivated by growth and change',          category: 'What Energizes You' },
  q8:  { left: 'Helping individuals one-on-one',          right: 'Impacting large groups',                  category: 'What Energizes You' },
  q9:  { left: 'Working with data and systems',           right: 'Working with people and relationships',   category: 'What Energizes You' },
  q10: { left: 'Energized by competition',                right: 'Energized by cooperation',                category: 'What Energizes You' },
  // ── YOUR SKILLS & STRENGTHS ──
  q11: { left: 'Deep, specialized expertise',             right: 'Broad, generalist knowledge',             category: 'Your Skills & Strengths' },
  q12: { left: 'Attention to detail',                     right: 'Big-picture thinking',                    category: 'Your Skills & Strengths' },
  q13: { left: 'Creating new things',                     right: 'Managing and organizing',                 category: 'Your Skills & Strengths' },
  q14: { left: 'Communicating through writing',           right: 'Speaking / presenting',                   category: 'Your Skills & Strengths' },
  q15: { left: 'Execution and doing',                     right: 'Strategy and planning',                   category: 'Your Skills & Strengths' },
  // ── RISK & CHANGE ──
  q16: { left: 'Guaranteed, steady income',               right: 'Variable income with higher potential',   category: 'Risk & Change' },
  q17: { left: 'Established organizations',               right: 'Startups or building own thing',          category: 'Risk & Change' },
  q18: { left: 'Careful decisions after research',        right: 'Quick decisions on instinct',             category: 'Risk & Change' },
  q19: { left: 'Low-risk, stable situations',             right: 'High-risk, high-reward situations',       category: 'Risk & Change' },
  q20: { left: 'Gradual, incremental change',             right: 'Bold leaps and big pivots',               category: 'Risk & Change' },
  // ── YOUR VALUES & VISION ──
  q21: { left: 'Financial security is top priority',      right: 'Personal fulfillment / purpose is top priority', category: 'Your Values & Vision' },
  q22: { left: 'Work-life balance non-negotiable',        right: 'Will sacrifice balance for success',      category: 'Your Values & Vision' },
  q23: { left: 'Local / community-level impact',          right: 'Global / large-scale impact',             category: 'Your Values & Vision' },
  q24: { left: 'Prefers being an employee',               right: 'Prefers being own boss',                  category: 'Your Values & Vision' },
  q25: { left: 'Driven by day-to-day enjoyment',          right: 'Driven by legacy and reputation',         category: 'Your Values & Vision' },
  // ── WHAT YOU'VE BUILT & DONE ──
  q26: { left: 'Built or managed systems, processes, and operations', right: 'Sold, pitched, or persuaded people to buy or act', category: "What You've Built & Done" },
  q27: { left: 'Coached, taught, or developed other people',          right: 'Created original content, products, or creative work', category: "What You've Built & Done" },
  q28: { left: 'Led or managed teams and organizations',              right: 'Built deep technical skills or specialized expertise', category: "What You've Built & Done" },
  q29: { left: 'Strongest experience in large, established organizations', right: 'Strongest experience in small teams, startups, or self-directed work', category: "What You've Built & Done" },
  q30: { left: 'Worked primarily within one industry or field',       right: 'Worked across multiple industries, worn many hats',    category: "What You've Built & Done" },
  // ── YOUR HUMAN EDGE ──
  q31: { left: 'Works best through screens and digital communication', right: 'Works best in person — physical presence matters',    category: 'Your Human Edge' },
  q32: { left: 'Most effective with information, data, or content',   right: 'Most effective with emotions, relationships, wellbeing', category: 'Your Human Edge' },
  q33: { left: 'Relies on proven frameworks and best practices',      right: 'Relies on gut instinct and reading human situations',   category: 'Your Human Edge' },
  q34: { left: 'Prefers clearly defined problems with known solutions', right: 'Thrives on messy, ambiguous, human situations',      category: 'Your Human Edge' },
  q35: { left: 'Energized by efficiency, scale, and systems',         right: 'Energized by deep, meaningful impact on specific people', category: 'Your Human Edge' },
  // ── YOUR WORLD & CONTEXT ──
  q36: { left: 'Wants to work locally, embedded in community',        right: 'Wants to work nationally or globally, location-independent', category: 'Your World & Context' },
  q37: { left: 'Needs income from next move within ~6 months',        right: 'Has a year or more before needing income from something new', category: 'Your World & Context' },
  q38: { left: 'Wants to work alone or with a very small team',       right: 'Wants to build a team and organization',               category: 'Your World & Context' },
  q39: { left: 'Wants to serve individuals directly (B2C)',           right: 'Wants to serve businesses or organizations (B2B)',      category: 'Your World & Context' },
  q40: { left: 'Drawn to the physical world — products, places, nature, food', right: 'Drawn to the digital/ideas world — online, knowledge, content, software', category: 'Your World & Context' },
};

function buildScoreSummary(answers) {
  // Group questions by category for a cleaner prompt
  const groups = {};
  Object.entries(answers).forEach(([id, score]) => {
    const q = QUESTION_LABELS[id];
    if (!q) return;
    const s = parseInt(score, 10);
    const tendency =
      s <= 2 ? `strongly leans toward "${q.left}"` :
      s <= 4 ? `leans toward "${q.left}"` :
      s === 5 ? `is balanced between "${q.left}" and "${q.right}"` :
      s <= 7 ? `leans toward "${q.right}"` :
               `strongly leans toward "${q.right}"`;
    const line = `  - ${tendency} (score ${s}/10)`;
    if (!groups[q.category]) groups[q.category] = [];
    groups[q.category].push(line);
  });

  return Object.entries(groups)
    .map(([cat, lines]) => `${cat}:\n${lines.join('\n')}`)
    .join('\n\n');
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

A person has completed a 40-question personality, skills, and context assessment. Their responses are grouped into 8 categories below (each score is 1–10):

${scoreSummary}

IMPORTANT GUIDANCE FOR EACH CATEGORY:

1. "How You Work", "What Energizes You", "Your Skills & Strengths", "Risk & Change", "Your Values & Vision" — use these to build the person's core personality archetype and working style profile.

2. "What You've Built & Done" — these are their PROVEN, TRANSFERABLE SKILLS. Use these to ground your career and business recommendations in what this person has actually done, not just what they prefer. A person with high scores toward "sold, pitched, persuaded" has real sales DNA. A person toward "coached, taught, developed" has real facilitation and mentoring ability. Use this category to add credibility and specificity to your suggestions.

3. "Your Human Edge" — this is the AI-RESISTANCE profile. Use these scores to identify this person's most future-proof strengths — the capabilities that AI and automation genuinely cannot replace. High scores toward the right side of these questions (in-person work, emotional attunement, human judgment, ambiguity navigation, deep personal impact) indicate strong AI-resistant attributes. Explicitly factor this into career path and business idea recommendations — prioritize paths where human presence, trust, and judgment are irreplaceable.

4. "Your World & Context" — use these as PRACTICAL CONSTRAINTS and signals. The income timeline (q37) should shape how aggressive or cautious the roadmap steps are. Local vs. global (q36) should shape whether suggestions are community-based or location-independent. Individual vs. organizational clients (q39) shapes whether suggestions are B2C or B2B. Physical vs. digital world (q40) should influence the type of business and career suggested.

Based on all 40 scores, generate a rich, personalized career and business analysis. Be specific and actionable — avoid generic advice. Speak warmly and directly to the person as "you".

Return ONLY valid JSON — no markdown fences, no explanation, just the JSON object — with this exact structure:

{
  "tribe_name": "The [Archetype Name]",
  "tribe_description": "2–3 sentences describing this person's unique archetype and what makes them stand out professionally.",
  "past_analysis": "2–3 sentences about the kinds of roles and environments they have likely thrived or struggled in, based on their scores — reference their proven skills and experience background specifically.",
  "career_paths": [
    { "title": "Specific Career Title", "description": "2–3 sentences on why this path fits their exact profile, references their transferable skills, and explains why it is resilient to AI and automation." },
    { "title": "Specific Career Title", "description": "2–3 sentences." },
    { "title": "Specific Career Title", "description": "2–3 sentences." }
  ],
  "business_ideas": [
    { "name": "Specific Business Type or Name", "description": "2–3 sentences on why this idea suits their proven skills, fits their practical context (local/global, B2C/B2B, timeline), and why it plays to human strengths AI cannot easily replace." },
    { "name": "Specific Business Type or Name", "description": "2–3 sentences." },
    { "name": "Specific Business Type or Name", "description": "2–3 sentences." }
  ],
  "roadmap": [
    { "title": "Action Step Title", "action": "A specific, concrete action they can take in the next 30 days — calibrated to their income timeline and practical context." },
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
      await pushToZoho(resolvedEmail, results, answers);
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
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Your Tribes Blueprint</h1>
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
    subject: `Your Tribes Blueprint: ${results.tribe_name || 'Results Inside'}`,
    html,
  });
}

// ── ZOHO CRM HELPER ─────────────────────────────────────────
// Uses the refresh token to get a short-lived access token, then
// upserts a Contact by email so duplicates are never created.

async function pushToZoho(email, results, answers) {
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

  // Step 3: build the full Contact description
  // Includes the complete assessment profile, all results, and the full roadmap.

  // ── Assessment scores grouped by category ──
  const scoreLines = [];
  const categoryOrder = [
    'How You Work', 'What Energizes You', 'Your Skills & Strengths',
    'Risk & Change', 'Your Values & Vision',
    "What You've Built & Done", 'Your Human Edge', 'Your World & Context',
  ];
  const scoreGroups = {};
  Object.entries(answers || {}).forEach(([id, score]) => {
    const q = QUESTION_LABELS[id];
    if (!q) return;
    const s = parseInt(score, 10);
    const tendency =
      s <= 2 ? `Strongly: ${q.left}` :
      s <= 4 ? `Leans: ${q.left}` :
      s === 5 ? `Balanced` :
      s <= 7 ? `Leans: ${q.right}` :
               `Strongly: ${q.right}`;
    if (!scoreGroups[q.category]) scoreGroups[q.category] = [];
    scoreGroups[q.category].push(`  ${tendency} (${s}/10)`);
  });
  categoryOrder.forEach(cat => {
    if (scoreGroups[cat]) {
      scoreLines.push(`${cat}:\n${scoreGroups[cat].join('\n')}`);
    }
  });

  // ── Full career paths ──
  const careerFull = (results.career_paths || [])
    .map(c => `• ${c.title}\n  ${c.description}`)
    .join('\n\n');

  // ── Full business ideas ──
  const bizFull = (results.business_ideas || [])
    .map(b => `• ${b.name}\n  ${b.description}`)
    .join('\n\n');

  // ── Full roadmap ──
  const roadmapFull = (results.roadmap || [])
    .map((s, i) => `Step ${i + 1}: ${s.title}\n  ${s.action}`)
    .join('\n\n');

  const description =
    `━━━ TRIBES BLUEPRINT ASSESSMENT ━━━\n` +
    `Tribe Profile: ${results.tribe_name || ''}\n` +
    `${results.tribe_description || ''}\n\n` +
    `━━━ UNDERSTANDING THEIR PAST ━━━\n` +
    `${results.past_analysis || ''}\n\n` +
    `━━━ ASSESSMENT SCORES ━━━\n` +
    `${scoreLines.join('\n\n')}\n\n` +
    `━━━ CAREER PATHS ━━━\n` +
    `${careerFull}\n\n` +
    `━━━ BUSINESS IDEAS ━━━\n` +
    `${bizFull}\n\n` +
    `━━━ TRANSITION ROADMAP ━━━\n` +
    `${roadmapFull}`;

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
