// netlify/functions/compass-results-background.js
// Background function — Netlify returns 202 immediately, this runs asynchronously.
// No HTTP timeout pressure. Verifies access code, calls Claude, sends results email + PDF.

const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');
const PDFDocument      = require('pdfkit');

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

  // ── Send Results Email + PDF ─────────────────────
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

// ── PDF GENERATION ────────────────────────────────────────────
function generateCompassPDF(email, direction, results) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Brand colors (RGB) ──
    const ORANGE  = '#C85C2D';
    const BROWN   = '#3D1F0D';
    const MUTED   = '#6B4C3B';
    const CREAM   = '#FDF6ED';
    const GREEN   = '#2D5016';
    const BORDER  = '#E8D5C0';
    const LBLUE   = '#4466CC';
    const W = 612, H = 792, M = 50, CW = W - M * 2;

    const safe = v => (v || '').toString().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    function y() { return doc.y; }

    function checkBreak(needed = 80) {
      if (doc.y + needed > H - 70) doc.addPage();
    }

    function hRule(color = BORDER) {
      doc.moveDown(0.3)
         .strokeColor(color).lineWidth(0.5)
         .moveTo(M, doc.y).lineTo(W - M, doc.y).stroke()
         .moveDown(0.5);
    }

    function sectionHeader(title, icon = '') {
      checkBreak(60);
      doc.moveDown(0.6);
      doc.rect(M, doc.y, CW, 28).fill(BROWN);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
         .text((icon ? icon + '  ' : '') + title.toUpperCase(), M + 12, doc.y - 22, { width: CW - 20, lineBreak: false });
      doc.moveDown(1.1);
    }

    function subHeader(title, color = ORANGE) {
      checkBreak(50);
      doc.moveDown(0.5)
         .fillColor(color).font('Helvetica-Bold').fontSize(10)
         .text(title.toUpperCase(), M, doc.y, { characterSpacing: 0.5 })
         .moveDown(0.2);
    }

    function bodyText(text, opts = {}) {
      checkBreak(opts.needed || 40);
      doc.fillColor(opts.color || MUTED).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(opts.size || 10.5)
         .text(safe(text), M + (opts.indent || 0), doc.y, { width: CW - (opts.indent || 0), lineGap: 2 })
         .moveDown(0.4);
    }

    function labelValue(label, value, labelColor = ORANGE) {
      checkBreak(35);
      const startY = doc.y;
      doc.fillColor(labelColor).font('Helvetica-Bold').fontSize(9.5)
         .text(label + ':', M, startY, { continued: true, width: CW });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text('  ' + safe(value), { width: CW });
      doc.moveDown(0.3);
    }

    function infoBox(label, value, bgColor, borderColor) {
      checkBreak(50);
      doc.moveDown(0.3);
      const bx = M, bw = CW;
      const tempY = doc.y;
      // measure text height
      const textH = doc.heightOfString(safe(value), { width: bw - 24, fontSize: 10 }) + 30;
      doc.rect(bx, tempY, bw, textH).fill(bgColor).strokeColor(borderColor).lineWidth(1).stroke();
      doc.rect(bx, tempY, 3, textH).fill(borderColor);
      doc.fillColor(borderColor).font('Helvetica-Bold').fontSize(8.5)
         .text(label.toUpperCase(), bx + 10, tempY + 8, { width: bw - 20, characterSpacing: 0.4 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
         .text(safe(value), bx + 10, tempY + 22, { width: bw - 20, lineGap: 1.5 });
      doc.y = tempY + textH + 4;
      doc.moveDown(0.3);
    }

    // ══════════════════════════════════════════════
    // COVER PAGE
    // ══════════════════════════════════════════════
    doc.rect(0, 0, W, 220).fill(BROWN);
    doc.fillColor('#E8D5C0').font('Helvetica').fontSize(9)
       .text('CHANGING TRIBES', M, 50, { align: 'center', width: CW, characterSpacing: 2 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30)
       .text('TRIBES COMPASS', M, 75, { align: 'center', width: CW });
    doc.fillColor('#E8D5C0').font('Helvetica').fontSize(12)
       .text('Your Personalized Career & Business Report', M, 118, { align: 'center', width: CW });

    doc.rect(0, 220, W, 60).fill(ORANGE);
    const titleText = safe(results.compass_title || 'Your Direction Profile');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
       .text(titleText, M, 238, { align: 'center', width: CW });

    doc.y = 310;
    doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
       .text('YOUR DIRECTION', M, doc.y, { align: 'center', width: CW, characterSpacing: 1 });
    doc.moveDown(0.4);
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(12)
       .text('"' + safe(direction) + '"', M + 30, doc.y, { align: 'center', width: CW - 60, lineGap: 3 });

    doc.moveDown(1.2);
    hRule(BORDER);

    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text(safe(results.compass_intro || ''), M + 20, doc.y, { width: CW - 40, align: 'center', lineGap: 3 });

    // Footer on cover
    doc.fillColor(BORDER).font('Helvetica').fontSize(8)
       .text('Prepared by Changing Tribes  ·  changingtribes.com  ·  ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
             M, H - 40, { align: 'center', width: CW });

    // ══════════════════════════════════════════════
    // CAREER PATHS
    // ══════════════════════════════════════════════
    doc.addPage();
    sectionHeader('Your Career Paths — Full 10-Year View', '🧭');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Three paths matched to who you are and where you want to go.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.career_paths || []).forEach((c, i) => {
      checkBreak(120);
      // Path header bar
      doc.rect(M, doc.y, CW, 24).fill(i % 2 === 0 ? '#FFF3E8' : '#F5EFE8');
      doc.strokeColor(ORANGE).lineWidth(0.5)
         .rect(M, doc.y, CW, 24).stroke();
      doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
         .text(`CAREER PATH ${i + 1}`, M + 10, doc.y + 4, { continued: true });
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(11)
         .text(`   ${safe(c.title)}`, { lineBreak: false });
      doc.y += 24;
      doc.moveDown(0.5);

      bodyText(c.why_it_fits, { color: BROWN });
      infoBox('A Day in the Life', c.day_in_the_life, '#FFF8F0', ORANGE);
      infoBox('Income Reality', c.income_reality, '#F0F7F0', GREEN);

      // 10-year arc
      checkBreak(80);
      doc.moveDown(0.3)
         .fillColor(BROWN).font('Helvetica-Bold').fontSize(9)
         .text('YOUR 10-YEAR ARC', M, doc.y, { characterSpacing: 0.5 })
         .moveDown(0.3);

      const arcW = (CW - 8) / 3;
      const arcY = doc.y;
      const arcLabels = ['Years 1–3  ·  Getting In', 'Years 4–7  ·  Building', 'Years 8–10  ·  Legacy'];
      const arcVals   = [c.years_1_3, c.years_4_7, c.years_8_10];
      const maxH = Math.max(...arcVals.map(v =>
        doc.heightOfString(safe(v || ''), { width: arcW - 16, fontSize: 9.5 }) + 40
      ));

      arcLabels.forEach((lbl, j) => {
        const ax = M + j * (arcW + 4);
        doc.rect(ax, arcY, arcW, maxH).fill('#FDF6ED').strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
           .text(lbl, ax + 8, arcY + 8, { width: arcW - 16 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
           .text(safe(arcVals[j] || ''), ax + 8, arcY + 22, { width: arcW - 16, lineGap: 1.5 });
      });
      doc.y = arcY + maxH + 6;
      doc.moveDown(0.4);

      infoBox('How to Break In', c.how_to_break_in, '#EEF3FF', LBLUE);
      labelValue('⚠️ Watch Out For', c.watch_out_for, '#8B3030');
      labelValue('🛡️ AI-Resistant Because', c.ai_resistance, GREEN);
      doc.moveDown(0.4);
      hRule();
    });

    // ══════════════════════════════════════════════
    // BUSINESS MODELS
    // ══════════════════════════════════════════════
    doc.addPage();
    sectionHeader('Business Models Built for You', '🚀');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Three business ideas tailored to your skills, direction, and context.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.business_models || []).forEach((b, i) => {
      checkBreak(100);
      doc.rect(M, doc.y, CW, 24).fill('#FDF6ED');
      doc.strokeColor(ORANGE).lineWidth(0.5).rect(M, doc.y, CW, 24).stroke();
      doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
         .text(`BUSINESS IDEA ${i + 1}`, M + 10, doc.y + 4, { continued: true });
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(11)
         .text(`   ${safe(b.name)}`, { lineBreak: false });
      doc.y += 24;
      doc.moveDown(0.5);

      bodyText(b.concept,    { color: BROWN });
      bodyText(b.why_it_fits, { color: MUTED });

      // Financials row
      checkBreak(50);
      const fW = (CW - 8) / 3;
      const fY = doc.y;
      const fItems = [
        { label: 'Startup Cost', val: b.startup_cost },
        { label: 'Year 1 Target', val: b.year_1_target },
        { label: 'Year 3 Potential', val: b.year_3_potential },
      ];
      const fMaxH = Math.max(...fItems.map(f =>
        doc.heightOfString(safe(f.val || ''), { width: fW - 16, fontSize: 9.5 }) + 36
      ));
      fItems.forEach((f, j) => {
        const fx = M + j * (fW + 4);
        doc.rect(fx, fY, fW, fMaxH).fill('#F0F7F0').strokeColor(GREEN).lineWidth(0.5).stroke();
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8)
           .text(f.label.toUpperCase(), fx + 8, fY + 8, { width: fW - 16 });
        doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(9.5)
           .text(safe(f.val || ''), fx + 8, fY + 22, { width: fW - 16, lineGap: 1.5 });
      });
      doc.y = fY + fMaxH + 6;
      doc.moveDown(0.4);

      infoBox('How to Get Your First Client', b.first_client_path, '#EEF3FF', LBLUE);
      labelValue('🛡️ AI-Resistant Because', b.ai_resistance, GREEN);
      labelValue('🤝 Ideal Partner / Co-Founder', b.ideal_partner, LBLUE);
      doc.moveDown(0.4);
      hRule();
    });

    // ══════════════════════════════════════════════
    // WORK ENVIRONMENT
    // ══════════════════════════════════════════════
    checkBreak(120);
    sectionHeader('Your Ideal Work Environment', '🏡');
    const env = results.work_environment || {};
    subHeader('Where You Thrive');
    bodyText(env.ideal_setup);
    subHeader('Your Ideal Culture');
    bodyText(env.ideal_culture);
    subHeader('Red Flags — Walk Away From These', '#8B3030');
    (env.red_flags || []).forEach(flag => {
      checkBreak(30);
      doc.fillColor('#8B3030').font('Helvetica').fontSize(10)
         .text('✗  ' + safe(flag), M + 10, doc.y, { width: CW - 10, lineGap: 1.5 })
         .moveDown(0.3);
    });

    // ══════════════════════════════════════════════
    // 90-DAY ACTION PLAN
    // ══════════════════════════════════════════════
    doc.addPage();
    sectionHeader('Your 90-Day Action Plan', '🗺️');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Fortnightly steps — specific, concrete, and calibrated to your situation.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.action_plan || []).forEach((a, i) => {
      checkBreak(70);
      const aY = doc.y;
      const aH = doc.heightOfString(safe(a.action || ''), { width: CW - 110, fontSize: 10.5 }) + 50;
      doc.rect(M, aY, CW, aH).fill(i % 2 === 0 ? '#FFF8F0' : '#FDF6ED')
         .strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.rect(M, aY, 90, aH).fill(ORANGE);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5)
         .text(safe(a.period), M + 6, aY + 10, { width: 78, align: 'center' });
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10.5)
         .text(safe(a.title), M + 100, aY + 8, { width: CW - 110 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
         .text(safe(a.action), M + 100, aY + 26, { width: CW - 110, lineGap: 1.5 });
      doc.y = aY + aH + 4;
      doc.moveDown(0.2);
    });

    // ══════════════════════════════════════════════
    // RESOURCES
    // ══════════════════════════════════════════════
    checkBreak(120);
    sectionHeader('Resources Matched to You', '📚');
    const res = results.resources || {};

    subHeader('Books to Read');
    (res.books || []).forEach(b => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text('📖  ' + safe(b.title), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(b.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    subHeader('Communities & Networks to Join');
    (res.communities || []).forEach(c => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text('🌐  ' + safe(c.name), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(c.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    subHeader('Tools & Platforms');
    (res.tools || []).forEach(t => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text('🛠️  ' + safe(t.name), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(t.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    // ══════════════════════════════════════════════
    // CLOSING PAGE
    // ══════════════════════════════════════════════
    doc.addPage();
    doc.rect(0, 0, W, H).fill(BROWN);
    doc.fillColor('#E8D5C0').font('Helvetica').fontSize(9)
       .text('CHANGING TRIBES', M, 80, { align: 'center', width: CW, characterSpacing: 2 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22)
       .text('Your next chapter starts now.', M, 110, { align: 'center', width: CW });
    doc.moveDown(1.5);
    doc.fillColor('#E8D5C0').font('Helvetica').fontSize(11)
       .text('This report was generated specifically for you based on your Tribes Blueprint\nprofile and direction statement. Keep it, share it, and return to it\nas your journey unfolds.', M + 40, doc.y, { align: 'center', width: CW - 80, lineGap: 4 });
    doc.moveDown(2);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(12)
       .text('changingtribes.com', M, doc.y, { align: 'center', width: CW });
    doc.moveDown(0.5);
    doc.fillColor('#E8D5C0').font('Helvetica').fontSize(9)
       .text('© ' + new Date().getFullYear() + ' Changing Tribes. All rights reserved.', M, doc.y, { align: 'center', width: CW });

    // ── Page numbers on interior pages ──
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count - 1; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(BORDER).font('Helvetica').fontSize(8)
         .text(`Tribes Compass Report  ·  ${safe(results.compass_title || '')}  ·  Page ${i + 1}`,
               M, H - 28, { align: 'center', width: CW });
    }

    doc.end();
  });
}

// ── ZOHO UPDATE ───────────────────────────────────────────────
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
    .map(c => `• ${c.title}\n  ${c.why_it_fits}\n  Income: ${c.income_reality}\n  Arc: ${c.years_1_3} → ${c.years_4_7} → ${c.years_8_10}\n  Break in: ${c.how_to_break_in}`)
    .join('\n\n');
  const bizSummary = (results.business_models || [])
    .map(b => `• ${b.name}\n  ${b.concept}\n  Startup: ${b.startup_cost} | Y1: ${b.year_1_target} | Y3: ${b.year_3_potential}\n  First client: ${b.first_client_path}`)
    .join('\n\n');
  const actionSummary = (results.action_plan || [])
    .map(a => `${a.period} — ${a.title}: ${a.action}`)
    .join('\n');

  const compassNote =
    `\n\n━━━ TRIBES COMPASS RESULTS ━━━\n` +
    `Direction: "${direction}"\nProfile: ${results.compass_title || ''}\n\n` +
    `${results.compass_intro || ''}\n\n` +
    `━━━ CAREER PATHS ━━━\n${careerSummary}\n\n` +
    `━━━ BUSINESS MODELS ━━━\n${bizSummary}\n\n` +
    `━━━ 90-DAY ACTION PLAN ━━━\n${actionSummary}`;

  const namePart = email.split('@')[0].replace(/[._-]+/g, ' ');
  const lastName  = namePart.charAt(0).toUpperCase() + namePart.slice(1);

  await fetch(
    `https://www.zohoapis.${datacenter}/crm/v2/Contacts/upsert`,
    {
      method:  'POST',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{ Last_Name: lastName, Email: email, Description: compassNote }],
        duplicate_check_fields: ['Email'],
      }),
    }
  );
}

// ── EMAIL (HTML + PDF attachment) ────────────────────────────
async function sendCompassEmail(email, direction, results) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Generate PDF
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateCompassPDF(email, direction, results);
    console.log('BG PDF generated:', Math.round(pdfBuffer.length / 1024), 'KB');
  } catch (pdfErr) {
    console.error('BG PDF generation error (non-fatal):', pdfErr.message);
  }

  // ── Career paths HTML ──
  const careerPathsHtml = (results.career_paths || []).map((c, i) => `
    <tr><td style="padding:24px 0;border-bottom:2px solid #E8D5C0;">
      <p style="margin:0 0 4px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Career Path ${i + 1}</p>
      <strong style="color:#3D1F0D;font-size:17px;display:block;margin-bottom:10px;">→ ${c.title || ''}</strong>
      <p style="margin:0 0 10px;color:#6B4C3B;font-size:14px;line-height:1.7;">${c.why_it_fits || ''}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr><td style="background:#FFF8F0;border-left:3px solid #E8943A;border-radius:0 8px 8px 0;padding:12px 16px;">
          <p style="margin:0 0 4px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">A Day in the Life</p>
          <p style="margin:0;color:#6B4C3B;font-size:13px;line-height:1.65;font-style:italic;">${c.day_in_the_life || ''}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr><td style="background:#F0F7F0;border-left:3px solid #2D5016;border-radius:0 8px 8px 0;padding:10px 14px;">
          <p style="margin:0 0 2px;color:#2D5016;font-size:12px;font-weight:700;text-transform:uppercase;">💰 Income Reality</p>
          <p style="margin:0;color:#3D5030;font-size:13px;line-height:1.6;">${c.income_reality || ''}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #E8D5C0;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#FDF6ED;padding:10px 14px;border-bottom:1px solid #E8D5C0;">
          <strong style="color:#3D1F0D;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">📅 Your 10-Year Arc</strong>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
          <strong style="color:#C85C2D;font-size:12px;">Years 1–3 · Getting In</strong>
          <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_1_3 || ''}</p>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
          <strong style="color:#C85C2D;font-size:12px;">Years 4–7 · Building Authority</strong>
          <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_4_7 || ''}</p>
        </td></tr>
        <tr><td style="padding:10px 14px;">
          <strong style="color:#C85C2D;font-size:12px;">Years 8–10 · Legacy & Leadership</strong>
          <p style="margin:4px 0 0;color:#6B4C3B;font-size:13px;line-height:1.6;">${c.years_8_10 || ''}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td style="background:#EEF3FF;border-left:3px solid #4466CC;border-radius:0 8px 8px 0;padding:10px 14px;">
          <p style="margin:0 0 2px;color:#2244AA;font-size:12px;font-weight:700;text-transform:uppercase;">🚪 How to Break In</p>
          <p style="margin:0;color:#334488;font-size:13px;line-height:1.6;">${c.how_to_break_in || ''}</p>
        </td></tr>
      </table>
      <p style="margin:8px 0 0;color:#8B3030;font-size:12px;font-style:italic;">⚠️ Watch out for: ${c.watch_out_for || ''}</p>
      <p style="margin:8px 0 0;color:#2D5016;font-size:12px;font-style:italic;">🛡️ AI-resistant because: ${c.ai_resistance || ''}</p>
    </td></tr>`).join('');

  // ── Business models HTML ──
  const businessHtml = (results.business_models || []).map((b, i) => `
    <tr><td style="padding:24px 0;border-bottom:2px solid #E8D5C0;">
      <p style="margin:0 0 4px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Business Idea ${i + 1}</p>
      <strong style="color:#3D1F0D;font-size:17px;display:block;margin-bottom:6px;">→ ${b.name || ''}</strong>
      <p style="margin:0 0 10px;color:#6B4C3B;font-size:14px;line-height:1.7;">${b.concept || ''}</p>
      <p style="margin:0 0 12px;color:#6B4C3B;font-size:14px;line-height:1.7;">${b.why_it_fits || ''}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #E8D5C0;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
          <strong style="color:#3D1F0D;font-size:12px;">💸 Startup Cost:</strong>
          <span style="color:#6B4C3B;font-size:13px;"> ${b.startup_cost || ''}</span>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #E8D5C0;">
          <strong style="color:#3D1F0D;font-size:12px;">🎯 Year 1 Target:</strong>
          <span style="color:#6B4C3B;font-size:13px;"> ${b.year_1_target || ''}</span>
        </td></tr>
        <tr><td style="padding:10px 14px;">
          <strong style="color:#3D1F0D;font-size:12px;">📈 Year 3 Potential:</strong>
          <span style="color:#6B4C3B;font-size:13px;"> ${b.year_3_potential || ''}</span>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td style="background:#EEF3FF;border-left:3px solid #4466CC;border-radius:0 8px 8px 0;padding:10px 14px;">
          <p style="margin:0 0 2px;color:#2244AA;font-size:12px;font-weight:700;text-transform:uppercase;">🤝 How to Get Your First Client</p>
          <p style="margin:0;color:#334488;font-size:13px;line-height:1.6;">${b.first_client_path || ''}</p>
        </td></tr>
      </table>
      <p style="margin:8px 0 0;color:#2D5016;font-size:12px;font-style:italic;">🛡️ AI-resistant because: ${b.ai_resistance || ''}</p>
      <p style="margin:6px 0 0;color:#6B4C3B;font-size:12px;font-style:italic;">🤝 Ideal partner: ${b.ideal_partner || ''}</p>
    </td></tr>`).join('');

  // ── Work environment HTML ──
  const env = results.work_environment || {};
  const redFlagsHtml = (env.red_flags || []).map(f =>
    `<li style="margin-bottom:6px;color:#8B3030;font-size:13px;">${f}</li>`).join('');

  // ── Action plan HTML ──
  const actionHtml = (results.action_plan || []).map(a => `
    <tr><td style="padding:16px 0;border-bottom:1px solid #E8D5C0;">
      <strong style="color:#C85C2D;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">${a.period || ''}</strong>
      <strong style="display:block;color:#3D1F0D;font-size:15px;margin:4px 0 8px;">${a.title || ''}</strong>
      <p style="margin:0;color:#6B4C3B;font-size:14px;line-height:1.7;">${a.action || ''}</p>
    </td></tr>`).join('');

  // ── Resources HTML ──
  const resSec = results.resources || {};
  const booksHtml = (resSec.books || []).map(b =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">📖 ${b.title || ''}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${b.why || ''}</p></td></tr>`).join('');
  const commHtml = (resSec.communities || []).map(c =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">🌐 ${c.name || ''}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${c.why || ''}</p></td></tr>`).join('');
  const toolsHtml = (resSec.tools || []).map(t =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#3D1F0D;font-size:13px;">🛠️ ${t.name || ''}</strong><p style="margin:3px 0 0;color:#6B4C3B;font-size:12px;line-height:1.5;">${t.why || ''}</p></td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FDF6ED;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FDF6ED;padding:40px 20px;">
<tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:#3D1F0D;border-radius:16px 16px 0 0;padding:36px 32px;text-align:center;">
    <p style="margin:0 0 6px;color:#E8D5C0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Changing Tribes</p>
    <h1 style="margin:0 0 6px;color:#ffffff;font-size:30px;font-weight:700;">Your Tribes Compass</h1>
    <p style="margin:0;color:#E8D5C0;font-size:13px;opacity:0.8;">Your complete career & business roadmap</p>
  </td></tr>

  <!-- TITLE BAND -->
  <tr><td style="background:linear-gradient(135deg,#C85C2D,#E8943A);padding:24px 32px;text-align:center;">
    <p style="margin:0 0 6px;color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Your Direction Profile</p>
    <h2 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${results.compass_title || ''}</h2>
  </td></tr>

  <!-- DIRECTION + INTRO -->
  <tr><td style="background:#ffffff;padding:28px 32px;border-left:1px solid #E8D5C0;border-right:1px solid #E8D5C0;">
    <p style="margin:0 0 8px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Your Direction</p>
    <p style="margin:0 0 18px;color:#3D1F0D;font-size:16px;font-style:italic;line-height:1.65;border-left:3px solid #E8943A;padding-left:14px;">"${direction}"</p>
    <p style="margin:0;color:#6B4C3B;font-size:15px;line-height:1.8;">${results.compass_intro || ''}</p>
  </td></tr>

  <!-- PDF CALLOUT -->
  <tr><td style="background:#FFF3E0;padding:20px 32px;border:1px solid #E8D5C0;border-top:none;text-align:center;">
    <p style="margin:0;color:#3D1F0D;font-size:14px;line-height:1.6;">📎 <strong>Your full Compass Report is attached as a PDF</strong> — save it, print it, or share it. It includes your complete career paths, business models, 90-day action plan, and resources.</p>
  </td></tr>

  <!-- CAREER PATHS -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
    <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🧭 Your Career Paths — Full 10-Year View</h3>
    <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Three paths matched to who you are and where you want to go.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
  </td></tr>

  <!-- BUSINESS MODELS -->
  <tr><td style="background:#FDF6ED;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
    <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🚀 Business Models Built for You</h3>
    <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Three business ideas tailored to your skills, direction, and context.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${businessHtml}</table>
  </td></tr>

  <!-- WORK ENVIRONMENT -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
    <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">🏡 Your Ideal Work Environment</h3>
    <p style="margin:0 0 6px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Where You Thrive</p>
    <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${env.ideal_setup || ''}</p>
    <p style="margin:0 0 6px;color:#C85C2D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Your Ideal Culture</p>
    <p style="margin:0 0 16px;color:#6B4C3B;font-size:14px;line-height:1.75;">${env.ideal_culture || ''}</p>
    <p style="margin:0 0 8px;color:#8B3030;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Red Flags — Walk Away From These</p>
    <ul style="margin:0;padding-left:18px;">${redFlagsHtml}</ul>
  </td></tr>

  <!-- ACTION PLAN -->
  <tr><td style="background:#FDF6ED;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
    <h3 style="margin:0 0 6px;color:#3D1F0D;font-size:18px;font-weight:700;">🗺️ Your 90-Day Action Plan</h3>
    <p style="margin:0 0 20px;color:#9A7A6A;font-size:13px;">Fortnightly steps — specific, concrete, and calibrated to your timeline.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${actionHtml}</table>
  </td></tr>

  <!-- RESOURCES -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #E8D5C0;border-top:none;">
    <h3 style="margin:0 0 16px;color:#3D1F0D;font-size:18px;font-weight:700;">📚 Resources Matched to You</h3>
    <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Books</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${booksHtml}</table>
    <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Communities & Networks</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${commHtml}</table>
    <p style="margin:0 0 10px;color:#C85C2D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Tools & Platforms</p>
    <table width="100%" cellpadding="0" cellspacing="0">${toolsHtml}</table>
  </td></tr>

  <!-- FOOTER CTA -->
  <tr><td style="background:#3D1F0D;border-radius:0 0 16px 16px;padding:36px 32px;text-align:center;">
    <p style="margin:0 0 20px;color:#E8D5C0;font-size:14px;line-height:1.7;">Ready to take action? Connect with the Changing Tribes community and share your compass results.</p>
    <a href="https://changingtribes.com" style="background:#C85C2D;color:#ffffff;padding:16px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Visit Changing Tribes →</a>
    <p style="margin:28px 0 0;color:#6B4C3B;font-size:12px;">© ${new Date().getFullYear()} Changing Tribes · <a href="https://changingtribes.com" style="color:#E8D5C0;">changingtribes.com</a></p>
  </td></tr>

</table></td></tr>
</table></body></html>`;

  const emailPayload = {
    from:    'Tribes Compass <blueprint@changingtribes.com>',
    to:      email,
    subject: `Your Tribes Compass: ${results.compass_title || 'Results Inside'}`,
    html,
  };

  if (pdfBuffer) {
    emailPayload.attachments = [{
      filename: 'Your-Tribes-Compass-Report.pdf',
      content:  pdfBuffer.toString('base64'),
    }];
  }

  await resend.emails.send(emailPayload);
}
