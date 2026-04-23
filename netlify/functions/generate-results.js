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

  let email, answers;
  try {
    ({ email, answers } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  // Blueprint is free — no access code required
  console.log('Step 1: Blueprint request received for', email);
  const resolvedEmail = email.trim();

  // ── Build Claude prompt ─────────────────────────
  const scoreSummary = buildScoreSummary(answers || {});

  const prompt = `You are a deeply insightful career counselor and business strategist working with Pathworks Project — a platform that helps people transition to new chapters of their professional lives.

A person has completed a 40-question personality, skills, and context assessment. Their responses are grouped into 8 categories below (each score is 1–10):

${scoreSummary}

IMPORTANT GUIDANCE FOR EACH CATEGORY:

1. "How You Work", "What Energizes You", "Your Skills & Strengths", "Risk & Change", "Your Values & Vision" — use these to build the person's core personality archetype and working style profile.

2. "What You've Built & Done" — these are their PROVEN, TRANSFERABLE SKILLS. Use these to ground your career and business recommendations in what this person has actually done, not just what they prefer. A person with high scores toward "sold, pitched, persuaded" has real sales DNA. A person toward "coached, taught, developed" has real facilitation and mentoring ability. Use this category to add credibility and specificity to your suggestions.

3. "Your Human Edge" — this is the AI-RESISTANCE profile. Use these scores to identify this person's most future-proof strengths — the capabilities that AI and automation genuinely cannot replace. High scores toward the right side of these questions (in-person work, emotional attunement, human judgment, ambiguity navigation, deep personal impact) indicate strong AI-resistant attributes. Explicitly factor this into career path and business idea recommendations — prioritize paths where human presence, trust, and judgment are irreplaceable.

4. "Your World & Context" — use these as PRACTICAL CONSTRAINTS and signals. The income timeline (q37) should shape how aggressive or cautious the roadmap steps are. Local vs. global (q36) should shape whether suggestions are community-based or location-independent. Individual vs. organizational clients (q39) shapes whether suggestions are B2C or B2B. Physical vs. digital world (q40) should influence the type of business and career suggested.

Based on all 40 scores, generate a rich, personalized career and business analysis. Be specific and actionable — avoid generic advice. Speak warmly and directly to the person as "you".

CRITICAL: Keep every description field to a MAXIMUM of 2 sentences. Be punchy and specific, not verbose. The entire JSON response must be under 3000 tokens.

Return ONLY valid JSON — no markdown fences, no explanation, just the JSON object — with this exact structure:

{
  "tribe_name": "The [Archetype Name]",
  "tribe_description": "2–3 sentences describing this person's unique profile and what makes them stand out professionally.",
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
  ],
  "startup_ideas": [
    { "name": "Business Type or Concept", "benefit": "Core benefit or value this business delivers to customers" },
    ... (provide exactly 20 entries total)
  ],
  "target_companies": [
    { "name": "Company Name", "sector": "Industry / Role Type" },
    ... (provide exactly 27 entries total)
  ]
}

For startup_ideas: List exactly 20 types of businesses this person could realistically start or run. Every idea must be AI-resistant — built on human judgment, physical presence, trust, emotional intelligence, creativity, or complex relationship-driven value that AI cannot easily replicate. For each entry provide: the business name/type and the core customer benefit (what problem it solves or value it delivers). Match the mix to their proven skills, archetype, and practical context (local/global, B2C/B2B, income timeline). Include a variety of models: service businesses, consulting practices, community businesses, physical/local businesses, creative ventures, and mission-driven organizations.

For target_companies: List exactly 27 real, named companies where this person could realistically apply or partner with. These must be AI-resistant organizations — companies where human judgment, relationships, physical presence, creative direction, or complex problem-solving are central to the value delivered. Match the companies to this person's specific profile, career paths, proven skills, and practical context (local vs. global, B2C vs. B2B). Include a mix of: well-known employers, mid-size growth companies, mission-driven organizations, and industry-specific firms. Use real company names only.`;

  // ── Call Claude ─────────────────────────────────
  console.log('Step 2: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 5000,
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
      email: resolvedEmail,
      answers,
      results,
    });
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
      <td style="padding:16px 0;border-bottom:1px solid #B8D4DA;">
        <strong style="color:#0F4F53;font-size:15px;">→ ${c.title}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.6;">${c.description}</p>
      </td>
    </tr>`).join('');

  const businessIdeasHtml = (results.business_ideas || []).map(b => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #B8D4DA;">
        <strong style="color:#0F4F53;font-size:15px;">→ ${b.name}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.6;">${b.description}</p>
      </td>
    </tr>`).join('');

  // Startup ideas grid — 3 per row
  const startups = results.startup_ideas || [];
  const startupRows = [];
  for (let i = 0; i < startups.length; i += 3) {
    const row = startups.slice(i, i + 3);
    const cells = row.map(s => `
      <td width="33%" style="padding:10px 8px;vertical-align:top;">
        <div style="background:#ffffff;border:1px solid #B8D4DA;border-radius:8px;padding:12px 10px;text-align:center;">
          <strong style="color:#0F4F53;font-size:13px;display:block;margin-bottom:4px;">${s.name}</strong>
          <span style="color:#1A6B72;font-size:11px;line-height:1.4;display:block;">${s.benefit}</span>
        </div>
      </td>`).join('');
    const empties = row.length < 3 ? Array(3 - row.length).fill('<td width="33%"></td>').join('') : '';
    startupRows.push(`<tr>${cells}${empties}</tr>`);
  }
  const startupIdeasHtml = startupRows.join('');

  const roadmapHtml = (results.roadmap || []).map((s, i) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #B8D4DA;">
        <strong style="color:#0F4F53;font-size:15px;">Step ${i + 1}: ${s.title}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.6;">${s.action}</p>
      </td>
    </tr>`).join('');

  // Build companies grid — 3 per row
  const companies = results.target_companies || [];
  const companyRows = [];
  for (let i = 0; i < companies.length; i += 3) {
    const row = companies.slice(i, i + 3);
    const cells = row.map(c => `
      <td width="33%" style="padding:10px 8px;vertical-align:top;">
        <div style="background:#ffffff;border:1px solid #B8D4DA;border-radius:8px;padding:12px 10px;text-align:center;">
          <strong style="color:#0F4F53;font-size:13px;display:block;margin-bottom:4px;">${c.name}</strong>
          <span style="color:#1A6B72;font-size:11px;">${c.sector}</span>
        </div>
      </td>`).join('');
    // Pad last row if needed
    const empties = row.length < 3 ? Array(3 - row.length).fill('<td width="33%"></td>').join('') : '';
    companyRows.push(`<tr>${cells}${empties}</tr>`);
  }
  const companiesHtml = companyRows.join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F8FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F8FA;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0F4F53;border-radius:16px 16px 0 0;padding:32px;text-align:center;">
            <p style="margin:0 0 4px;color:#B8D4DA;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">Pathworks Project</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Your Pathworks Blueprint</h1>
          </td>
        </tr>

        <!-- PROFILE NAME -->
        <tr>
          <td style="background:#1A6B72;padding:24px 32px;text-align:center;">
            <p style="margin:0 0 4px;color:#D8ECF0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Your Profile</p>
            <h2 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${results.tribe_name || ''}</h2>
          </td>
        </tr>

        <!-- PROFILE DESCRIPTION -->
        <tr>
          <td style="background:#ffffff;padding:32px;border-left:1px solid #B8D4DA;border-right:1px solid #B8D4DA;">
            <p style="margin:0;color:#4A6670;font-size:15px;line-height:1.75;">${results.tribe_description || ''}</p>
          </td>
        </tr>

        <!-- PAST ANALYSIS -->
        <tr>
          <td style="background:#D8ECF0;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 12px;color:#0F4F53;font-size:18px;">🔍 Understanding Your Past</h3>
            <p style="margin:0;color:#4A6670;font-size:14px;line-height:1.75;">${results.past_analysis || ''}</p>
          </td>
        </tr>

        <!-- CAREER PATHS -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 4px;color:#0F4F53;font-size:18px;">🧭 Your Next Career Paths</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
          </td>
        </tr>

        <!-- BUSINESS IDEAS -->
        <tr>
          <td style="background:#D8ECF0;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 4px;color:#0F4F53;font-size:18px;">🚀 Business Ideas For You</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${businessIdeasHtml}</table>
          </td>
        </tr>

        <!-- STARTUP IDEAS -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;">💡 20 Businesses You Could Start</h3>
            <p style="margin:0 0 16px;color:#4A6670;font-size:13px;line-height:1.5;">AI-resistant business types matched to your skills and tribe profile — each one built on human strengths that automation cannot replace.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${startupIdeasHtml}</table>
          </td>
        </tr>

        <!-- ROADMAP -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 4px;color:#0F4F53;font-size:18px;">🗺️ Your Transition Roadmap</h3>
            <table width="100%" cellpadding="0" cellspacing="0">${roadmapHtml}</table>
          </td>
        </tr>

        <!-- TARGET COMPANIES -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;">🏢 Companies Where You Can Thrive</h3>
            <p style="margin:0 0 16px;color:#4A6670;font-size:13px;line-height:1.5;">AI-resistant organizations matched to your tribe profile and skills — places where human judgment and relationships drive the value.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${companiesHtml}</table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background:#0F4F53;border-radius:0 0 16px 16px;padding:32px;text-align:center;">
            <p style="margin:0 0 8px;color:#E7B928;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Ready to Go Deeper?</p>
            <p style="margin:0 0 20px;color:#B8D4DA;font-size:14px;line-height:1.6;">Your Blueprint shows you who you are. <strong style="color:#ffffff;">Pathworks Compass</strong> maps exactly where to go next — 3 career paths, 3 businesses to start, and your 10-year arc.</p>
            <a href="https://www.pathworkscompass.com" style="background:#E7B928;color:#0F4F53;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin-bottom:20px;">Continue to Pathworks Compass →</a>
            <p style="margin:0 0 20px;color:#4A6670;font-size:12px;">or</p>
            <a href="https://pathworksproject.com" style="background:#1A6B72;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Visit Pathworks Project →</a>
            <p style="margin:24px 0 0;color:#4A6670;font-size:12px;">© 2026 Pathworks Project · <a href="https://pathworksproject.com" style="color:#B8D4DA;">pathworksproject.com</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: 'Pathworks Blueprint <hello@changingtribes.com>',
    to: email,
    subject: `Your Pathworks Blueprint: ${results.tribe_name || 'Results Inside'}`,
    html,
  });
}

// ── ZOHO CRM HELPER ─────────────────────────────────────────
// Uses the refresh token to get a short-lived access token, then
// upserts a Contact by email so duplicates are never created.

async function pushToZoho(email, results, answers) {
  const datacenter = process.env.ZOHO_DATACENTER || 'com'; // com | eu | in | com.au

  // Step 1: exchange refresh token for access token
  const tokenController = new AbortController();
  const tokenTimeout = setTimeout(() => tokenController.abort(), 8000);
  const tokenRes = await fetch(
    `https://accounts.zoho.${datacenter}/oauth/v2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: tokenController.signal,
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      }),
    }
  );
  clearTimeout(tokenTimeout);

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

  // ── Startup ideas (20 AI-resistant business types) ──
  const startupFull = (results.startup_ideas || [])
    .map(s => `• ${s.name} — ${s.benefit}`)
    .join('\n');

  // ── Full roadmap ──
  const roadmapFull = (results.roadmap || [])
    .map((s, i) => `Step ${i + 1}: ${s.title}\n  ${s.action}`)
    .join('\n\n');

  // ── Target companies ──
  const companiesFull = (results.target_companies || [])
    .map(c => `• ${c.name} (${c.sector})`)
    .join('\n');

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
    `━━━ STARTUP IDEAS (20 AI-RESISTANT BUSINESS TYPES) ━━━\n` +
    `${startupFull}\n\n` +
    `━━━ TRANSITION ROADMAP ━━━\n` +
    `${roadmapFull}\n\n` +
    `━━━ TARGET COMPANIES (AI-RESISTANT) ━━━\n` +
    `${companiesFull}`;

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
  const contactController = new AbortController();
  const contactTimeout = setTimeout(() => contactController.abort(), 8000);
  const contactRes = await fetch(
    `https://www.zohoapis.${datacenter}/crm/v2/Contacts/upsert`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: contactController.signal,
      body: JSON.stringify(payload),
    }
  );
  clearTimeout(contactTimeout);

  const contactData = await contactRes.json();

  if (contactData.data && contactData.data[0].status === 'error') {
    throw new Error(`Zoho contact error: ${JSON.stringify(contactData.data[0])}`);
  }

  console.log('Zoho Contact upserted:', email, contactData.data?.[0]?.status);
  return contactData;
}
