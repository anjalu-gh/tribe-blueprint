// netlify/functions/generate-results-background.js
// Background function — Netlify returns 202 to the client immediately and this
// runs asynchronously (no HTTP timeout pressure). Calls Claude API to generate
// personalized Blueprint results, saves to Supabase, pushes a Contact to Zoho CRM,
// and emails the user via Resend. The frontend no longer renders results on screen
// — the email is the deliverable.

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Surface missing env vars at boot — Netlify function logs will show this
// every cold start, so a misconfigured deploy is obvious instead of failing
// silently mid-pipeline.
const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error('[blueprint] MISSING ENV VARS:', missingEnv.join(', '));
}

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

// Extract the root JSON object using brace counting — tolerates trailing text
function extractRootJSON(str) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc)                 { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true;  continue; }
    if (c === '"')           { inStr = !inStr; continue; }
    if (inStr)               continue;
    if (c === '{')           depth++;
    if (c === '}')           { depth--; if (depth === 0) return str.substring(0, i + 1); }
  }
  return str;
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

  const prompt = `You are a deeply insightful people analyst and coach working with Pathworks Blueprint — the first step in the Pathworks suite. The Blueprint is about WHO the person is: how they work, what energizes them, where they thrive, what drains them, and what makes them uniquely valuable in the age of AI. A separate tool, Pathworks Compass, handles the WHERE (specific careers, businesses, companies). Do NOT recommend careers, businesses, or companies in this response — the Blueprint is strictly a personal work-style profile.

A person has completed a 40-question assessment. Their responses are grouped into 8 categories below (each score is 1–10):

${scoreSummary}

HOW TO READ THE CATEGORIES:
1. "How You Work", "What Energizes You", "Your Skills & Strengths", "Risk & Change", "Your Values & Vision" — these define core working style, motivation, and operating preferences.
2. "What You've Built & Done" — these are their proven, observable skills. Reference them specifically when naming strengths (e.g. "you have real sales DNA", "you're a natural facilitator").
3. "Your Human Edge" — this is the AI-resistance profile. High-right scores (in-person, emotional attunement, human judgment, ambiguity tolerance, deep personal impact) mean their human value is harder for AI to replace. Call this out explicitly in the ai_edge section.
4. "Your World & Context" — practical constraints (timeline, local/global, B2C/B2B, physical/digital). Use these to color the picture but don't turn them into career recommendations.

YOUR JOB: Produce a rich personal Blueprint — warm, specific, and reflective. Speak directly as "you". Sound like a thoughtful coach who has read the person carefully, not a generic personality test.

LENGTH: Keep each description to 2–3 sentences unless specified. Every bullet in list fields should be 1 concrete sentence.

Return ONLY valid JSON — no markdown fences, no explanation — with this exact structure:

{
  "tribe_name": "The [Archetype Name] — evocative, specific, 2-4 words",
  "tribe_description": "2-3 sentences naming who this person is at their best and what makes their blend of traits distinctive.",
  "past_analysis": "3-4 sentences describing the kinds of work and environments they've likely thrived in vs. struggled with — reference their proven-skills scores (q26-q30) specifically.",
  "work_style": "3-4 sentences describing how they actually work best — pace, structure, autonomy, collaboration preferences, decision-making style.",
  "energizers": [
    "A specific thing that makes this person come alive at work",
    "Another energizer",
    "Another energizer",
    "Another energizer",
    "Another energizer"
  ],
  "drains": [
    "A specific thing that depletes this person's energy at work",
    "Another drain",
    "Another drain",
    "Another drain",
    "Another drain"
  ],
  "strengths_to_lean_into": [
    { "name": "Named strength (2-4 words)", "description": "2 sentences: what this strength looks like in action and why it matters for this person." },
    { "name": "...", "description": "..." },
    { "name": "...", "description": "..." },
    { "name": "...", "description": "..." },
    { "name": "...", "description": "..." }
  ],
  "blind_spots": [
    { "name": "Named blind spot (2-4 words)", "description": "2 sentences: what tends to go wrong for this person and a concrete way to guard against it." },
    { "name": "...", "description": "..." },
    { "name": "...", "description": "..." },
    { "name": "...", "description": "..." }
  ],
  "environments_thrive": "3-4 sentences on the kinds of environments, cultures, and structures where this person will flourish. Focus on conditions (pace, autonomy, people dynamics, cadence), not specific job titles or companies.",
  "environments_avoid": "2-3 sentences on the kinds of environments that will grind this person down, calibrated to their specific scores.",
  "ai_edge": "3-4 sentences describing this person's human advantage in the age of AI — what they can do that AI cannot easily replicate. Ground this in their Human Edge and proven-skills scores.",
  "roadmap": [
    { "title": "Action step title", "action": "A concrete reflective or experimental step they can take in the next 30 days to better understand or leverage their profile — not a career-change action." },
    { "title": "...", "action": "..." },
    { "title": "...", "action": "..." },
    { "title": "...", "action": "..." },
    { "title": "...", "action": "..." }
  ]
}

CRITICAL CONSTRAINTS:
- Do NOT include career_paths, business_ideas, startup_ideas, target_companies, or any list of specific jobs/businesses/companies. Those belong to Pathworks Compass, which is the next tool they'll use. If tempted to recommend a career or business, stop and reframe it as a strength, energizer, or environment condition instead.
- energizers and drains: 5 items each, specific and non-redundant.
- strengths_to_lean_into: exactly 5 items.
- blind_spots: exactly 4 items.
- roadmap: exactly 5 items, all about self-knowledge / experimentation / environment design — NOT about landing jobs or starting businesses.`;

  // ── Call Claude ─────────────────────────────────
  console.log('Step 2: Calling Claude API...');
  let results;
  try {
    // NOTE: claude-opus-4-6 rejects assistant-message prefill ("conversation
    // must end with a user message"). We rely on the system prompt + the
    // brace-counting extractRootJSON to strip any stray prose that might
    // sneak in around the JSON object.
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 7000,
      system:     'You are a JSON-only responder. Output nothing except the JSON object — no markdown, no backticks, no commentary, no preamble, no closing remarks. Start your response with `{` and end it with `}`. Keep every placeholder replaced with warm, specific, deeply personalised content. Follow the schema exactly and respect every count requirement. This is a personal work-style Blueprint, not a career recommendation — do not list specific careers, businesses, or companies.',
      messages:   [
        { role: 'user', content: prompt },
      ],
    });

    console.log('Blueprint stop_reason:', message.stop_reason, '| output_tokens:', message.usage?.output_tokens);
    const rawText  = message.content[0].text;
    const jsonText = extractRootJSON(rawText);

    results = JSON.parse(jsonText);
    console.log('Step 2 done: Claude responded OK');
  } catch (aiErr) {
    console.error('AI / parse error:', aiErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate results. Please try again.' }) };
  }

  // ── Persist to Supabase ─────────────────────────
  // NOTE: Supabase JS v2 returns `{ data, error }` and does NOT throw on
  // row-level failures (RLS rejection, schema mismatch, bad URL/key once
  // initialized, etc.). A bare try/catch will silently swallow all of
  // those — we have to read `error` explicitly and log it loudly so
  // Netlify function logs surface the failure.
  console.log('Step 2.5: Persisting to Supabase...');
  try {
    const { data: dbData, error: dbError } = await supabase
      .from('assessments')
      .insert({
        email: resolvedEmail,
        answers,
        results,
      })
      .select();

    if (dbError) {
      console.error('[blueprint] Supabase insert returned error:', JSON.stringify({
        message: dbError.message,
        details: dbError.details,
        hint:    dbError.hint,
        code:    dbError.code,
      }));
    } else {
      console.log('[blueprint] Supabase insert OK, rows:', dbData?.length ?? 0);
    }
  } catch (dbErr) {
    // Network / client init failures land here
    console.error('[blueprint] Supabase persist threw:', dbErr.message);
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

  // ── Energizers / Drains 2-col list ──
  const energizersHtml = (results.energizers || []).map(e =>
    `<li style="margin-bottom:8px;color:#0F4F53;font-size:14px;line-height:1.55;">${e}</li>`).join('');
  const drainsHtml = (results.drains || []).map(d =>
    `<li style="margin-bottom:8px;color:#8B3030;font-size:14px;line-height:1.55;">${d}</li>`).join('');

  // ── Strengths ──
  const strengthsHtml = (results.strengths_to_lean_into || []).map(s => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #B8D4DA;">
        <strong style="color:#0F4F53;font-size:15px;">✦ ${s.name || ''}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.65;">${s.description || ''}</p>
      </td>
    </tr>`).join('');

  // ── Blind spots ──
  const blindSpotsHtml = (results.blind_spots || []).map(b => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #E0C8C8;">
        <strong style="color:#8B3030;font-size:15px;">⚠ ${b.name || ''}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.65;">${b.description || ''}</p>
      </td>
    </tr>`).join('');

  // ── Roadmap (self-knowledge steps) ──
  const roadmapHtml = (results.roadmap || []).map((s, i) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #B8D4DA;">
        <strong style="color:#0F4F53;font-size:15px;">Step ${i + 1}: ${s.title || ''}</strong>
        <p style="margin:6px 0 0;color:#4A6670;font-size:14px;line-height:1.65;">${s.action || ''}</p>
      </td>
    </tr>`).join('');

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
          <td style="background:#0F4F53;border-radius:16px 16px 0 0;padding:36px 32px 32px;text-align:center;">
            <!-- Pathworks Blueprint lockup -->
            <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <div style="width:28px;height:28px;border-radius:50%;background:#F4C83F;font-size:0;line-height:0;">&nbsp;</div>
                </td>
                <td style="vertical-align:middle;text-align:left;">
                  <div style="font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:22px;color:#ffffff;line-height:1;letter-spacing:-0.01em;">pathworks</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:9px;color:#F4C83F;letter-spacing:0.22em;margin-top:6px;">BLUEPRINT</div>
                </td>
              </tr>
            </table>
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

        <!-- HOW YOU WORK -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 12px;color:#0F4F53;font-size:18px;">⚙️ How You Work Best</h3>
            <p style="margin:0;color:#4A6670;font-size:14px;line-height:1.75;">${results.work_style || ''}</p>
          </td>
        </tr>

        <!-- ENERGIZERS + DRAINS (2 col) -->
        <tr>
          <td style="background:#D8ECF0;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" valign="top" style="padding-right:14px;">
                  <h3 style="margin:0 0 10px;color:#0F4F53;font-size:16px;">⚡ Energizers</h3>
                  <p style="margin:0 0 10px;color:#4A6670;font-size:12px;line-height:1.5;">What brings you alive at work.</p>
                  <ul style="margin:0;padding-left:18px;">${energizersHtml}</ul>
                </td>
                <td width="50%" valign="top" style="padding-left:14px;border-left:1px solid #B8D4DA;">
                  <h3 style="margin:0 0 10px;color:#8B3030;font-size:16px;">🪫 Drains</h3>
                  <p style="margin:0 0 10px;color:#4A6670;font-size:12px;line-height:1.5;">What depletes you — watch for these.</p>
                  <ul style="margin:0;padding-left:18px;">${drainsHtml}</ul>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- STRENGTHS -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;">✦ Strengths to Lean Into</h3>
            <p style="margin:0 0 10px;color:#4A6670;font-size:13px;line-height:1.5;">The capabilities that make you distinctive. Build your next chapter on these.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${strengthsHtml}</table>
          </td>
        </tr>

        <!-- BLIND SPOTS -->
        <tr>
          <td style="background:#FFF8F5;padding:24px 32px;border:1px solid #E0C8C8;border-top:none;">
            <h3 style="margin:0 0 6px;color:#8B3030;font-size:18px;">⚠ Blind Spots to Watch</h3>
            <p style="margin:0 0 10px;color:#4A6670;font-size:13px;line-height:1.5;">Patterns that tend to trip people with your profile up. Name them, plan around them.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${blindSpotsHtml}</table>
          </td>
        </tr>

        <!-- ENVIRONMENTS THRIVE / AVOID -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 10px;color:#0F4F53;font-size:18px;">🌱 Environments Where You'll Thrive</h3>
            <p style="margin:0 0 18px;color:#4A6670;font-size:14px;line-height:1.75;">${results.environments_thrive || ''}</p>
            <h3 style="margin:0 0 10px;color:#8B3030;font-size:16px;">🚫 Environments to Avoid</h3>
            <p style="margin:0;color:#4A6670;font-size:14px;line-height:1.75;">${results.environments_avoid || ''}</p>
          </td>
        </tr>

        <!-- AI EDGE -->
        <tr>
          <td style="background:#0F4F53;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
            <p style="margin:0 0 6px;color:#F4C83F;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Your AI-Age Advantage</p>
            <h3 style="margin:0 0 12px;color:#ffffff;font-size:20px;">🛡️ What AI Can't Replicate in You</h3>
            <p style="margin:0;color:#B8D4DA;font-size:14px;line-height:1.8;">${results.ai_edge || ''}</p>
          </td>
        </tr>

        <!-- ROADMAP -->
        <tr>
          <td style="background:#ffffff;padding:24px 32px;border:1px solid #B8D4DA;border-top:none;">
            <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;">🗺️ Your Next 30 Days</h3>
            <p style="margin:0 0 10px;color:#4A6670;font-size:13px;line-height:1.5;">Concrete, reflective steps to put this Blueprint to work — not jobs to chase, but clarity to build.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${roadmapHtml}</table>
          </td>
        </tr>

        <!-- CTA — TO COMPASS -->
        <tr>
          <td style="background:#0F4F53;border-radius:0 0 16px 16px;padding:36px 32px;text-align:center;">
            <p style="margin:0 0 8px;color:#F4C83F;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">Your Blueprint is step 1 of 2</p>
            <h3 style="margin:0 0 14px;color:#ffffff;font-size:22px;">Now map exactly where to go next.</h3>
            <p style="margin:0 0 22px;color:#B8D4DA;font-size:14px;line-height:1.7;">The Blueprint tells you who you are. <strong style="color:#ffffff;">Pathworks Compass</strong> takes your Blueprint profile and your direction statement and generates 5–7 career paths, 5–7 businesses matched to your capital, 12 real companies where you'd thrive, and 20 startup ideas — plus a full 90-day action plan and resources list, delivered as a PDF.</p>
            <a href="https://www.pathworkscompass.com" style="background:#F4C83F;color:#0F4F53;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;margin-bottom:22px;">Continue to Pathworks Compass →</a>
            <p style="margin:0 0 6px;color:#B8D4DA;font-size:12px;">Or explore the full Pathworks Project:</p>
            <a href="https://pathworksproject.com" style="color:#F4C83F;text-decoration:none;font-weight:600;font-size:13px;">pathworksproject.com →</a>
            <p style="margin:24px 0 0;color:#4A6670;font-size:12px;">© ${new Date().getFullYear()} Pathworks Project · A Changing Tribes company</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Resend returns { data, error } instead of throwing on API-level failures
  // (bounced address, suppression list, etc.). Capture both so silent
  // rejections show up in the Netlify function log.
  const { data: resendData, error: resendError } = await resend.emails.send({
    from: 'Pathworks Blueprint <hello@changingtribes.com>',
    to: email,
    subject: `Your Pathworks Blueprint: ${results.tribe_name || 'Results Inside'}`,
    html,
  });
  if (resendError) {
    console.error('[blueprint] Resend returned error:', JSON.stringify({
      name:       resendError.name,
      message:    resendError.message,
      statusCode: resendError.statusCode,
    }));
    throw new Error(`Resend send failed: ${resendError.message || resendError.name}`);
  }
  console.log('[blueprint] Resend accepted, message id:', resendData?.id || '(no id returned)');
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

  // ── Energizers / Drains ──
  const energizersFull = (results.energizers || []).map(e => `• ${e}`).join('\n');
  const drainsFull     = (results.drains     || []).map(d => `• ${d}`).join('\n');

  // ── Strengths ──
  const strengthsFull = (results.strengths_to_lean_into || [])
    .map(s => `• ${s.name}\n  ${s.description}`)
    .join('\n\n');

  // ── Blind spots ──
  const blindSpotsFull = (results.blind_spots || [])
    .map(b => `• ${b.name}\n  ${b.description}`)
    .join('\n\n');

  // ── Roadmap ──
  const roadmapFull = (results.roadmap || [])
    .map((s, i) => `Step ${i + 1}: ${s.title}\n  ${s.action}`)
    .join('\n\n');

  const description =
    `━━━ PATHWORKS BLUEPRINT ━━━\n` +
    `Tribe Profile: ${results.tribe_name || ''}\n` +
    `${results.tribe_description || ''}\n\n` +
    `━━━ UNDERSTANDING THEIR PAST ━━━\n` +
    `${results.past_analysis || ''}\n\n` +
    `━━━ HOW THEY WORK BEST ━━━\n` +
    `${results.work_style || ''}\n\n` +
    `━━━ ENERGIZERS ━━━\n${energizersFull}\n\n` +
    `━━━ DRAINS ━━━\n${drainsFull}\n\n` +
    `━━━ STRENGTHS TO LEAN INTO ━━━\n${strengthsFull}\n\n` +
    `━━━ BLIND SPOTS ━━━\n${blindSpotsFull}\n\n` +
    `━━━ ENVIRONMENTS WHERE THEY THRIVE ━━━\n${results.environments_thrive || ''}\n\n` +
    `━━━ ENVIRONMENTS TO AVOID ━━━\n${results.environments_avoid || ''}\n\n` +
    `━━━ AI-AGE ADVANTAGE ━━━\n${results.ai_edge || ''}\n\n` +
    `━━━ 30-DAY ROADMAP ━━━\n${roadmapFull}\n\n` +
    `━━━ ASSESSMENT SCORES ━━━\n${scoreLines.join('\n\n')}`;

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
