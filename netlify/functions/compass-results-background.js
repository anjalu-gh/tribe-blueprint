// netlify/functions/compass-results-background.js
// Background function — Netlify returns 202 immediately, this runs asynchronously.
// No HTTP timeout pressure. Verifies access code, calls Claude, sends results email.

const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  if (event.httpMethod !== 'POST') return;

  let email, access_code, direction;
  try {
    ({ email, access_code, direction } = JSON.parse(event.body));
  } catch {
    console.error('Background: invalid request body');
    return;
  }

  // ── Verify access code ──────────────────────────
  console.log('BG Step 1: Verifying access code...');
  const { data: accessData, error: accessErr } = await supabase
    .from('access_codes')
    .select('*')
    .eq('code', access_code)
    .single();

  if (accessErr || !accessData) {
    console.error('BG Step 1: Invalid access code —', access_code);
    return;
  }
  console.log('BG Step 1 done: access code valid');

  const resolvedEmail = email || accessData.email || '';

  // ── Fetch Blueprint scores ───────────────────────
  console.log('BG Step 2: Fetching Blueprint scores...');
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
    blueprintAnswers   = blueprintData.answers;
    blueprintTribeName = blueprintData.results?.tribe_name || '';
    console.log('BG Step 2 done: Blueprint scores found for', resolvedEmail);
  } else {
    console.log('BG Step 2: No Blueprint scores found — direction only');
  }

  // ── Build Claude prompt ──────────────────────────
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
Generate a deeply personal Tribes Compass report. Be specific — reference their actual scores and direction. Speak as "you". Name real industries, platforms, income numbers, and communities.

INSTRUCTIONS: Replace every placeholder with real, specific content tailored to this person. Write 2–3 sentences per field — rich and detailed. Return only valid JSON, nothing else.

{
  "compass_title": "The AI Product Strategist & Neurotech Pioneer",
  "compass_intro": "Your 10/10 autonomy drive combined with big-picture vision and people instinct makes you rare — someone who can lead at the frontier without losing the human thread.",
  "career_paths": [
    {
      "title": "AI Product Lead — Deep Tech or B2B SaaS",
      "why_it_fits": "Your 9/10 big-picture score and 10/10 autonomy preference point at product leadership roles at companies like Cohere, Scale AI, or Palantir where direction-setting is the job. This isn't an execution role — it's a strategy role, and your profile is built for it.",
      "day_in_the_life": "You start mornings in customer discovery calls and competitive research, move into roadmap reviews with engineering in the afternoon, and end the day writing strategy memos that shape next quarter's bets. The variety and intellectual stimulation match your 9/10 variety score perfectly.",
      "income_reality": "Entry AI product roles pay $130–180k total comp; senior PMs at Series B+ companies reach $220–350k; VP of Product at a well-funded AI company can exceed $500k with equity.",
      "years_1_3": "Join a 10–50 person AI startup as founding PM via Wellfound or LinkedIn, targeting $120–150k base plus meaningful equity — look for companies raising Series A with a technical team that lacks product leadership.",
      "years_4_7": "Move to VP of Product at a Series B/C company or land a Senior PM role at Salesforce AI, Microsoft Copilot, or a well-funded vertical AI startup, reaching $200–280k total comp.",
      "years_8_10": "Chief Product Officer at a scale-up, or found your own AI product studio or venture — top practitioners in this lane earn $500k–$1M+ via equity stakes and advisory roles.",
      "how_to_break_in": "Publish a 1,000-word AI product teardown on LinkedIn — analyse a product like Perplexity or Notion AI in detail, share your strategic take, and tag the founders — this gets you noticed faster than any cold application.",
      "watch_out_for": "Early AI startups pivot sharply and equity can evaporate — lock in vesting schedules and clear product ownership scope before signing anything.",
      "ai_resistance": "Product strategy requires human judgment, organisational trust, stakeholder alignment, and the ability to read ambiguous market signals — capabilities that AI tools assist but cannot perform."
    },
    { "title": "Replace with real title", "why_it_fits": "Replace — 2 sentences referencing their actual scores and direction.", "day_in_the_life": "Replace — 2 vivid sentences of a typical day.", "income_reality": "Replace — real income range from entry to senior.", "years_1_3": "Replace — specific entry path, roles, and income.", "years_4_7": "Replace — progression path and income growth.", "years_8_10": "Replace — where leaders in this field end up.", "how_to_break_in": "Replace — 2 specific first steps naming real platforms.", "watch_out_for": "Replace — the real risk or pitfall in this path.", "ai_resistance": "Replace — why this path needs irreplaceable humans." },
    { "title": "Replace with real title", "why_it_fits": "Replace — 2 sentences.", "day_in_the_life": "Replace — 2 sentences.", "income_reality": "Replace — real income range.", "years_1_3": "Replace — entry path.", "years_4_7": "Replace — progression.", "years_8_10": "Replace — ceiling.", "how_to_break_in": "Replace — 2 specific steps.", "watch_out_for": "Replace — main risk.", "ai_resistance": "Replace — why human." }
  ],
  "business_models": [
    {
      "name": "AI Strategy & Implementation Consultancy",
      "concept": "A boutique consultancy helping mid-market companies ($20M–$200M) identify their highest-ROI AI use cases and implement them — from vendor selection to internal training and deployment. You become their fractional Chief AI Officer.",
      "why_it_fits": "Your systems thinking and people instinct let you diagnose complex organisations fast and design solutions that actually get adopted. Your 10/10 autonomy score means you thrive as the independent expert, not the employee.",
      "startup_cost": "$1,500–$3,000 (LLC formation, website, Notion, Calendly, Loom — no office needed)",
      "year_1_target": "$80,000–$140,000 via 3–5 retainer clients at $3,000–$5,000/month",
      "year_3_potential": "$250,000–$500,000 with a small team, productised offers, and speaking revenue",
      "first_client_path": "Message 20 former colleagues or LinkedIn connections with a specific offer — a free 45-minute AI audit of their current operations — then convert the best fit into a paid 3-month engagement at $4,500/month.",
      "ai_resistance": "Clients hire consultants for accountability, judgment under uncertainty, and the ability to navigate internal politics — none of which AI can deliver.",
      "ideal_partner": "A technical co-founder or senior engineer who can handle implementation while you handle strategy and client relationships."
    },
    { "name": "Replace with real business name", "concept": "Replace — 2 sentences: what it does and who it serves.", "why_it_fits": "Replace — 2 sentences on why this fits their profile.", "startup_cost": "Replace — realistic startup cost range.", "year_1_target": "Replace — realistic year 1 revenue.", "year_3_potential": "Replace — year 3 upside.", "first_client_path": "Replace — 2 specific tactics to land first client.", "ai_resistance": "Replace — why this needs irreplaceable humans.", "ideal_partner": "Replace — ideal co-founder or collaborator profile." },
    { "name": "Replace with real business name", "concept": "Replace — 2 sentences.", "why_it_fits": "Replace — 2 sentences.", "startup_cost": "Replace.", "year_1_target": "Replace.", "year_3_potential": "Replace.", "first_client_path": "Replace — 2 tactics.", "ai_resistance": "Replace — 1 sentence.", "ideal_partner": "Replace — 1 sentence." }
  ],
  "work_environment": {
    "ideal_setup": "You do your best work with full autonomy over your schedule and outputs — a results-only environment where you are judged on outcomes, not hours. Remote-first or location-independent with occasional in-person for high-stakes client work.",
    "ideal_culture": "Fast-moving, intellectually ambitious, and comfortable with ambiguity — a team that debates ideas hard but trusts each individual to execute. Avoid bureaucratic cultures that confuse process compliance with progress.",
    "red_flags": [
      "Micromanagement or time-tracking cultures that value presence over output",
      "Slow-moving large organisations where decisions require multiple approval layers",
      "Roles with no ownership or autonomy — pure execution without strategic input"
    ]
  },
  "action_plan": [
    { "period": "Week 1–2", "title": "Map Your Landscape", "action": "List 15 target companies on Wellfound, LinkedIn, and Crunchbase — filter by stage (Series A/B), sector (your target industry), and headcount (10–100). Write a one-paragraph positioning statement: who you are, what problem you solve, and what makes you different from every other candidate or consultant." },
    { "period": "Week 3–4", "title": "Replace with real step title", "action": "Replace — 2 specific actions naming real platforms, communities, or people to contact." },
    { "period": "Week 5–6", "title": "Replace with real step title", "action": "Replace — 2 specific actions naming real platforms, communities, or people to contact." },
    { "period": "Week 7–8", "title": "Replace with real step title", "action": "Replace — 2 specific actions." },
    { "period": "Week 9–10", "title": "Replace with real step title", "action": "Replace — 2 specific actions." },
    { "period": "Week 11–12", "title": "Replace with real step title", "action": "Replace — what concrete proof point do they have after 90 days, and what does the next 90 days look like from here?" }
  ],
  "resources": {
    "books": [
      { "title": "Replace with real book title and author", "why": "Replace — why this book is relevant to their specific direction." },
      { "title": "Replace with real book title and author", "why": "Replace — 1 sentence." },
      { "title": "Replace with real book title and author", "why": "Replace — 1 sentence." }
    ],
    "communities": [
      { "name": "Replace with real community or network name", "why": "Replace — why to join and what to do there." },
      { "name": "Replace with real community or network name", "why": "Replace — 1 sentence." },
      { "name": "Replace with real community or network name", "why": "Replace — 1 sentence." }
    ],
    "tools": [
      { "name": "Replace with real tool or platform name", "why": "Replace — why this tool matters for their path." },
      { "name": "Replace with real tool or platform name", "why": "Replace — 1 sentence." },
      { "name": "Replace with real tool or platform name", "why": "Replace — 1 sentence." }
    ]
  }
}`;

  // ── Call Claude ──────────────────────────────────
  console.log('BG Step 3: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 6000,
      system:     'You are a JSON-only responder. Output nothing except the JSON object. No markdown, no backticks, no explanation. Replace every placeholder with real, specific, deeply personalised content for this person. Write 2–3 sentences per field — rich, specific, naming real platforms and dollar figures.',
      messages:   [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '{'   },
      ],
    });

    console.log('BG stop_reason:', message.stop_reason, '| output_tokens:', message.usage?.output_tokens);
    const rawText = '{' + message.content[0].text;

    results = JSON.parse(rawText);
    console.log('BG Step 3 done: Claude responded OK');
  } catch (aiErr) {
    console.error('BG Claude/parse error:', aiErr.constructor.name, aiErr.message);
    return;
  }

  // ── Persist to Supabase ──────────────────────────
  try {
    await supabase.from('compass_assessments').insert({
      access_code,
      email:               resolvedEmail,
      direction_statement: direction,
      blueprint_answers:   blueprintAnswers,
      results,
    });
    await supabase
      .from('access_codes')
      .update({ assessment_completed: true })
      .eq('code', access_code);
  } catch (dbErr) {
    console.error('BG Supabase error:', dbErr.message);
  }

  // ── Update Zoho CRM ──────────────────────────────
  if (resolvedEmail && process.env.ZOHO_CLIENT_ID) {
    console.log('BG Step 4: Updating Zoho CRM...');
    try {
      await updateZohoWithCompass(resolvedEmail, direction, results);
      console.log('BG Step 4 done: Zoho updated');
    } catch (err) {
      console.error('BG Zoho error:', err.message);
    }
  }

  // ── Send Results Email ───────────────────────────
  if (resolvedEmail && process.env.RESEND_API_KEY) {
    console.log('BG Step 5: Sending results email...');
    try {
      await sendCompassEmail(resolvedEmail, direction, results);
      console.log('BG Step 5 done: email sent to', resolvedEmail);
    } catch (err) {
      console.error('BG email error:', err.message);
    }
  }
};
