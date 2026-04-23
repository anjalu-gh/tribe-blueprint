// netlify/functions/compass-results-background.js
// Background function — Netlify returns 202 immediately, this runs asynchronously.
// No HTTP timeout pressure. Verifies access code, calls Claude, sends results email + PDF.

const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

// Load pdfkit safely — email still sends without PDF if unavailable
let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch (e) { console.error('pdfkit not available:', e.message); }

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

  const prompt = `You are a world-class career strategist, business advisor, and executive coach working with Pathworks Project — a platform that helps people navigate major professional transitions with clarity and confidence.

A person has completed the Pathworks Blueprint 40-question assessment and is now using Pathworks Compass to map their specific direction. ${blueprintContext}

THEIR DIRECTION STATEMENT (what they want to do next):
"${direction || 'Not specified'}"

THEIR TRIBES BLUEPRINT PROFILE (40-question assessment scores):
${scoreSummary}

YOUR TASK:
Generate a deeply personal Tribes Compass report. Be specific — reference their actual scores and direction. Speak as "you". Name real industries, platforms, income numbers, and communities.

INSTRUCTIONS: Replace ALL fields with real, specific content for this person. 2 sentences per field. Name real companies, platforms, dollar figures. Return valid JSON only.

{
  "compass_title": "Write a specific title for this person e.g. The Healthcare Operations Entrepreneur",
  "compass_intro": "2 sentences: why their profile makes them well-suited for their direction.",
  "career_paths": [
    { "title": "Specific career title", "why_it_fits": "2 sentences referencing their scores.", "day_in_the_life": "2 vivid sentences of a typical day.", "income_reality": "Entry to senior income range with real numbers.", "years_1_3": "Specific entry path, roles, income.", "years_4_7": "Progression and income growth.", "years_8_10": "Where leaders end up.", "how_to_break_in": "2 specific first steps naming real platforms.", "watch_out_for": "The real risk in this path.", "ai_resistance": "Why this needs irreplaceable humans." },
    { "title": "Specific career title", "why_it_fits": "2 sentences.", "day_in_the_life": "2 sentences.", "income_reality": "Real range.", "years_1_3": "Entry path.", "years_4_7": "Progression.", "years_8_10": "Ceiling.", "how_to_break_in": "2 steps.", "watch_out_for": "Main risk.", "ai_resistance": "Why human." },
    { "title": "Specific career title", "why_it_fits": "2 sentences.", "day_in_the_life": "2 sentences.", "income_reality": "Real range.", "years_1_3": "Entry path.", "years_4_7": "Progression.", "years_8_10": "Ceiling.", "how_to_break_in": "2 steps.", "watch_out_for": "Main risk.", "ai_resistance": "Why human." }
  ],
  "business_models": [
    { "name": "Specific business name", "concept": "2 sentences: what it does and who it serves.", "why_it_fits": "2 sentences on profile fit.", "startup_cost": "Realistic cost range.", "year_1_target": "Realistic year 1 revenue.", "year_3_potential": "Year 3 upside.", "first_client_path": "2 specific tactics to land first client.", "ai_resistance": "Why this needs humans.", "ideal_partner": "Ideal co-founder profile." },
    { "name": "Specific business name", "concept": "2 sentences.", "why_it_fits": "2 sentences.", "startup_cost": "Cost range.", "year_1_target": "Year 1 revenue.", "year_3_potential": "Year 3 upside.", "first_client_path": "2 tactics.", "ai_resistance": "1 sentence.", "ideal_partner": "1 sentence." },
    { "name": "Specific business name", "concept": "2 sentences.", "why_it_fits": "2 sentences.", "startup_cost": "Cost range.", "year_1_target": "Year 1 revenue.", "year_3_potential": "Year 3 upside.", "first_client_path": "2 tactics.", "ai_resistance": "1 sentence.", "ideal_partner": "1 sentence." }
  ],
  "work_environment": {
    "ideal_setup": "2 sentences on physical/remote setup and schedule preferences.",
    "ideal_culture": "2 sentences on team culture and pace.",
    "red_flags": ["Red flag 1", "Red flag 2", "Red flag 3"]
  },
  "action_plan": [
    { "period": "Week 1–2", "title": "Step title", "action": "2 specific actions naming real platforms." },
    { "period": "Week 3–4", "title": "Step title", "action": "2 specific actions." },
    { "period": "Week 5–6", "title": "Step title", "action": "2 specific actions." },
    { "period": "Week 7–8", "title": "Step title", "action": "2 specific actions." },
    { "period": "Week 9–10", "title": "Step title", "action": "2 specific actions." },
    { "period": "Week 11–12", "title": "Step title", "action": "What proof point do they have after 90 days?" }
  ],
  "resources": {
    "books": [
      { "title": "Real book title and author", "why": "Why relevant to their direction." },
      { "title": "Real book title and author", "why": "1 sentence." },
      { "title": "Real book title and author", "why": "1 sentence." }
    ],
    "communities": [
      { "name": "Real community name", "why": "Why join and what to do there." },
      { "name": "Real community name", "why": "1 sentence." },
      { "name": "Real community name", "why": "1 sentence." }
    ],
    "tools": [
      { "name": "Real tool name", "why": "Why this matters for their path." },
      { "name": "Real tool name", "why": "1 sentence." },
      { "name": "Real tool name", "why": "1 sentence." }
    ]
  }
}`;

  // ── Call Claude ──────────────────────────────────
  console.log('BG Step 3: Calling Claude API...');
  let results;
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system:     'You are a JSON-only responder. Output nothing except the JSON object. No markdown, no backticks, no explanation. Replace every placeholder with real, specific, deeply personalised content for this person. Write 2–3 sentences per field — rich, specific, naming real platforms and dollar figures.',
      messages:   [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '{'   },
      ],
    });

    console.log('BG stop_reason:', message.stop_reason, '| output_tokens:', message.usage?.output_tokens);
    const rawText = '{' + message.content[0].text;

    // Extract just the root JSON object using brace counting — handles trailing text robustly
    function extractRootJSON(str) {
      let depth = 0, inStr = false, esc = false;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (esc)            { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true;  continue; }
        if (c === '"')      { inStr = !inStr; continue; }
        if (inStr)          continue;
        if (c === '{')      depth++;
        if (c === '}')      { depth--; if (depth === 0) return str.substring(0, i + 1); }
      }
      return str;
    }
    const jsonText = extractRootJSON(rawText);

    results = JSON.parse(jsonText);
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
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Brand colors (teal/forest palette) ──
    const ORANGE  = '#1A6B72';   // teal accent (replaces old orange)
    const BROWN   = '#0F4F53';   // dark teal header (replaces old brown)
    const MUTED   = '#4A6670';   // muted teal body text
    const CREAM   = '#F0F8FA';   // light teal page bg
    const GREEN   = '#2D5016';   // kept for financial sections
    const BORDER  = '#B8D4DA';   // teal border
    const LBLUE   = '#4466CC';   // kept for callout boxes
    const GOLD    = '#E7B928';   // gold CTA accent
    const W = 612, H = 792, M = 50, CW = W - M * 2;

    // Strip control chars AND emoji (Helvetica can't render them — outputs garbage)
    const safe = v => (v || '').toString()
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u2600-\u27BF\u2B50-\u2B55\u231A-\u231B\u25AA-\u25FE\u2614-\u2615]/g, '')
      .replace(/[\uD800-\uDFFF]/g, '')
      .trim();

    function y() { return doc.y; }

    function checkBreak(needed = 80) {
      if (doc.y + needed > H - 70) doc.addPage();
    }

    // Smart page break — only adds a page if not already near the top
    function newPage() {
      if (doc.y > 160) doc.addPage();
    }

    function hRule(color = BORDER) {
      doc.moveDown(0.3)
         .strokeColor(color).lineWidth(0.5)
         .moveTo(M, doc.y).lineTo(W - M, doc.y).stroke()
         .moveDown(0.5);
    }

    function sectionHeader(title) {
      checkBreak(60);
      doc.moveDown(0.6);
      const headerY = doc.y;
      doc.rect(M, headerY, CW, 30).fill(BROWN);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
         .text(title.toUpperCase(), M + 12, headerY + 9, { width: CW - 24, lineBreak: false, characterSpacing: 0.3 });
      doc.y = headerY + 30;
      doc.moveDown(0.6);
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
      doc.moveDown(0.3);
      const bx = M, bw = CW;
      const innerW = bw - 28;
      // Measure FULL box height first, then check if it fits before drawing
      const textH = doc.heightOfString(safe(value), { width: innerW, fontSize: 10 }) + 48;
      checkBreak(textH + 12); // ensure the whole box fits on this page
      const tempY = doc.y;
      doc.rect(bx, tempY, bw, textH).fill(bgColor).strokeColor(borderColor).lineWidth(1).stroke();
      doc.rect(bx, tempY, 3, textH).fill(borderColor);
      doc.fillColor(borderColor).font('Helvetica-Bold').fontSize(8.5)
         .text(label.toUpperCase(), bx + 10, tempY + 9, { width: innerW, characterSpacing: 0.4 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
         .text(safe(value), bx + 10, tempY + 23, { width: innerW, lineGap: 2 });
      doc.y = tempY + textH + 5;
      doc.moveDown(0.3);
    }

    // ══════════════════════════════════════════════
    // COVER PAGE
    // ══════════════════════════════════════════════
    doc.rect(0, 0, W, 220).fill(BROWN);
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(9)
       .text('PATHWORKS PROJECT  ·  A CHANGING TRIBES COMPANY', M, 50, { align: 'center', width: CW, characterSpacing: 1 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30)
       .text('PATHWORKS COMPASS', M, 75, { align: 'center', width: CW });
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(12)
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
       .text('Changing Tribes  ·  changingtribes.com  ·  ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
             M, H - 40, { align: 'center', width: CW });

    // ══════════════════════════════════════════════
    // CAREER PATHS
    // ══════════════════════════════════════════════
    newPage();
    sectionHeader('Track 1: AI-Resistant Career & Job Paths');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Three AI-resistant career and job paths matched to your profile — with a full 10-year roadmap for each.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.career_paths || []).forEach((c, i) => {
      checkBreak(120);
      // Path header bar
      doc.rect(M, doc.y, CW, 24).fill(i % 2 === 0 ? '#D8ECF0' : '#F0F8FA');
      doc.strokeColor(ORANGE).lineWidth(0.5)
         .rect(M, doc.y, CW, 24).stroke();
      doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
         .text(`CAREER PATH ${i + 1}`, M + 10, doc.y + 4, { continued: true });
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(11)
         .text(`   ${safe(c.title)}`, { lineBreak: false });
      doc.y += 24;
      doc.moveDown(0.5);

      bodyText(c.why_it_fits, { color: BROWN });
      infoBox('A Day in the Life', c.day_in_the_life, '#D8ECF0', ORANGE);
      infoBox('Income Reality', c.income_reality, '#F0F7F0', GREEN);

      // 10-year arc
      checkBreak(80);
      doc.moveDown(0.3)
         .fillColor(BROWN).font('Helvetica-Bold').fontSize(9)
         .text('YOUR 10-YEAR ARC', M, doc.y, { characterSpacing: 0.5 })
         .moveDown(0.3);

      const arcW = (CW - 8) / 3;
      const arcLabels = ['Years 1–3  ·  Getting In', 'Years 4–7  ·  Building', 'Years 8–10  ·  Legacy'];
      const arcVals   = [c.years_1_3, c.years_4_7, c.years_8_10];
      const maxH = Math.max(...arcVals.map(v =>
        doc.heightOfString(safe(v || ''), { width: arcW - 24, fontSize: 9.5 }) + 52
      ));
      checkBreak(maxH + 12);
      const arcY = doc.y;

      arcLabels.forEach((lbl, j) => {
        const ax = M + j * (arcW + 4);
        doc.rect(ax, arcY, arcW, maxH).fill('#F0F8FA').strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
           .text(lbl, ax + 8, arcY + 8, { width: arcW - 16 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
           .text(safe(arcVals[j] || ''), ax + 8, arcY + 22, { width: arcW - 24, lineGap: 1.5 });
      });
      doc.y = arcY + maxH + 6;
      doc.moveDown(0.4);

      infoBox('How to Break In', c.how_to_break_in, '#EEF3FF', LBLUE);
      labelValue('Watch Out For', c.watch_out_for, '#8B3030');
      labelValue('AI-Resistant Because', c.ai_resistance, GREEN);
      doc.moveDown(0.4);
      hRule();
    });

    // ══════════════════════════════════════════════
    // BUSINESS MODELS
    // ══════════════════════════════════════════════
    newPage();
    sectionHeader('Track 2: Business & Entrepreneurship Paths');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Three business and entrepreneurship ideas tailored to your skills — with startup costs, revenue targets, and first-client strategy.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.business_models || []).forEach((b, i) => {
      checkBreak(100);
      doc.rect(M, doc.y, CW, 24).fill('#F0F8FA');
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
        doc.heightOfString(safe(f.val || ''), { width: fW - 24, fontSize: 9.5 }) + 52
      ));
      checkBreak(fMaxH + 12);
      fItems.forEach((f, j) => {
        const fx = M + j * (fW + 4);
        doc.rect(fx, fY, fW, fMaxH).fill('#F0F7F0').strokeColor(GREEN).lineWidth(0.5).stroke();
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8)
           .text(f.label.toUpperCase(), fx + 8, fY + 8, { width: fW - 24 });
        doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(9.5)
           .text(safe(f.val || ''), fx + 8, fY + 22, { width: fW - 24, lineGap: 1.5 });
      });
      doc.y = fY + fMaxH + 6;
      doc.moveDown(0.4);

      infoBox('How to Get Your First Client', b.first_client_path, '#EEF3FF', LBLUE);
      labelValue('AI-Resistant Because', b.ai_resistance, GREEN);
      labelValue('Ideal Partner / Co-Founder', b.ideal_partner, LBLUE);
      doc.moveDown(0.4);
      hRule();
    });

    // ══════════════════════════════════════════════
    // WORK ENVIRONMENT
    // ══════════════════════════════════════════════
    newPage();
    sectionHeader('Your Ideal Work Environment');
    const env = results.work_environment || {};
    subHeader('Where You Thrive');
    bodyText(env.ideal_setup);
    subHeader('Your Ideal Culture');
    bodyText(env.ideal_culture);
    subHeader('Red Flags — Walk Away From These', '#8B3030');
    (env.red_flags || []).forEach(flag => {
      checkBreak(30);
      doc.fillColor('#8B3030').font('Helvetica').fontSize(10)
         .text('–  ' + safe(flag), M + 10, doc.y, { width: CW - 10, lineGap: 1.5 })
         .moveDown(0.3);
    });

    // ══════════════════════════════════════════════
    // 90-DAY ACTION PLAN
    // ══════════════════════════════════════════════
    newPage();
    sectionHeader('Your 90-Day Action Plan');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
       .text('Fortnightly steps — specific, concrete, and calibrated to your situation.', M, doc.y, { width: CW })
       .moveDown(0.6);

    (results.action_plan || []).forEach((a, i) => {
      const aH = doc.heightOfString(safe(a.action || ''), { width: CW - 118, fontSize: 10.5 }) + 62;
      checkBreak(aH + 8);
      const aY = doc.y;
      doc.rect(M, aY, CW, aH).fill(i % 2 === 0 ? '#D8ECF0' : '#F0F8FA')
         .strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.rect(M, aY, 90, aH).fill(ORANGE);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5)
         .text(safe(a.period), M + 6, aY + 10, { width: 78, align: 'center' });
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10.5)
         .text(safe(a.title), M + 100, aY + 8, { width: CW - 110 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
         .text(safe(a.action), M + 100, aY + 26, { width: CW - 118, lineGap: 1.5 });
      doc.y = aY + aH + 4;
      doc.moveDown(0.2);
    });

    // ══════════════════════════════════════════════
    // RESOURCES
    // ══════════════════════════════════════════════
    newPage();
    sectionHeader('Resources Matched to You');
    const res = results.resources || {};

    subHeader('Books to Read');
    (res.books || []).forEach(b => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text(safe(b.title), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(b.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    subHeader('Communities & Networks to Join');
    (res.communities || []).forEach(c => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text(safe(c.name), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(c.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    subHeader('Tools & Platforms');
    (res.tools || []).forEach(t => {
      checkBreak(45);
      doc.fillColor(BROWN).font('Helvetica-Bold').fontSize(10)
         .text(safe(t.name), M + 6, doc.y, { width: CW - 6 }).moveDown(0.1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
         .text(safe(t.why), M + 20, doc.y, { width: CW - 20, lineGap: 1.5 }).moveDown(0.4);
    });

    // ══════════════════════════════════════════════
    // CLOSING PAGE
    // ══════════════════════════════════════════════
    doc.addPage();
    doc.rect(0, 0, W, H).fill(BROWN);
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(9)
       .text('PATHWORKS PROJECT  ·  A CHANGING TRIBES COMPANY', M, 80, { align: 'center', width: CW, characterSpacing: 1 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22)
       .text('Your next chapter starts now.', M, 110, { align: 'center', width: CW });
    doc.moveDown(1.5);
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(11)
       .text('This report was generated specifically for you based on your Pathworks Blueprint\nProfile and direction statement. Keep it, share it, and return to it\nas your journey unfolds.', M + 40, doc.y, { align: 'center', width: CW - 80, lineGap: 4 });
    doc.moveDown(2);
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(12)
       .text('Ready to take action? Get personalized assistance in reaching your goals.', M + 20, doc.y, { align: 'center', width: CW - 40, lineGap: 3 });
    doc.moveDown(1.2);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12)
       .text('changingtribes.com', M, doc.y, { align: 'center', width: CW });
    doc.moveDown(0.5);
    doc.fillColor('#B8D4DA').font('Helvetica').fontSize(9)
       .text('© ' + new Date().getFullYear() + ' Changing Tribes. All rights reserved.', M, doc.y, { align: 'center', width: CW });

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

  // Generate PDF (only if pdfkit loaded successfully)
  let pdfBuffer = null;
  if (PDFDocument) {
    try {
      pdfBuffer = await generateCompassPDF(email, direction, results);
      console.log('BG PDF generated:', Math.round(pdfBuffer.length / 1024), 'KB');
    } catch (pdfErr) {
      console.error('BG PDF generation error (non-fatal):', pdfErr.message);
    }
  }

  // ── Career paths HTML ──
  const careerPathsHtml = (results.career_paths || []).map((c, i) => `
    <tr><td style="padding:24px 0;border-bottom:2px solid #B8D4DA;">
      <p style="margin:0 0 4px;color:#1A6B72;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Career Path ${i + 1}</p>
      <strong style="color:#0F4F53;font-size:17px;display:block;margin-bottom:10px;">→ ${c.title || ''}</strong>
      <p style="margin:0 0 10px;color:#4A6670;font-size:14px;line-height:1.7;">${c.why_it_fits || ''}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr><td style="background:#D8ECF0;border-left:3px solid #1A6B72;border-radius:0 8px 8px 0;padding:12px 16px;">
          <p style="margin:0 0 4px;color:#1A6B72;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">A Day in the Life</p>
          <p style="margin:0;color:#4A6670;font-size:13px;line-height:1.65;font-style:italic;">${c.day_in_the_life || ''}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
        <tr><td style="background:#F0F7F0;border-left:3px solid #2D5016;border-radius:0 8px 8px 0;padding:10px 14px;">
          <p style="margin:0 0 2px;color:#2D5016;font-size:12px;font-weight:700;text-transform:uppercase;">💰 Income Reality</p>
          <p style="margin:0;color:#3D5030;font-size:13px;line-height:1.6;">${c.income_reality || ''}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #B8D4DA;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#F0F8FA;padding:10px 14px;border-bottom:1px solid #B8D4DA;">
          <strong style="color:#0F4F53;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">📅 Your 10-Year Arc</strong>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #B8D4DA;">
          <strong style="color:#1A6B72;font-size:12px;">Years 1–3 · Getting In</strong>
          <p style="margin:4px 0 0;color:#4A6670;font-size:13px;line-height:1.6;">${c.years_1_3 || ''}</p>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #B8D4DA;">
          <strong style="color:#1A6B72;font-size:12px;">Years 4–7 · Building Authority</strong>
          <p style="margin:4px 0 0;color:#4A6670;font-size:13px;line-height:1.6;">${c.years_4_7 || ''}</p>
        </td></tr>
        <tr><td style="padding:10px 14px;">
          <strong style="color:#1A6B72;font-size:12px;">Years 8–10 · Legacy & Leadership</strong>
          <p style="margin:4px 0 0;color:#4A6670;font-size:13px;line-height:1.6;">${c.years_8_10 || ''}</p>
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
    <tr><td style="padding:24px 0;border-bottom:2px solid #B8D4DA;">
      <p style="margin:0 0 4px;color:#1A6B72;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Business Idea ${i + 1}</p>
      <strong style="color:#0F4F53;font-size:17px;display:block;margin-bottom:6px;">→ ${b.name || ''}</strong>
      <p style="margin:0 0 10px;color:#4A6670;font-size:14px;line-height:1.7;">${b.concept || ''}</p>
      <p style="margin:0 0 12px;color:#4A6670;font-size:14px;line-height:1.7;">${b.why_it_fits || ''}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #B8D4DA;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #B8D4DA;">
          <strong style="color:#0F4F53;font-size:12px;">💸 Startup Cost:</strong>
          <span style="color:#4A6670;font-size:13px;"> ${b.startup_cost || ''}</span>
        </td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #B8D4DA;">
          <strong style="color:#0F4F53;font-size:12px;">🎯 Year 1 Target:</strong>
          <span style="color:#4A6670;font-size:13px;"> ${b.year_1_target || ''}</span>
        </td></tr>
        <tr><td style="padding:10px 14px;">
          <strong style="color:#0F4F53;font-size:12px;">📈 Year 3 Potential:</strong>
          <span style="color:#4A6670;font-size:13px;"> ${b.year_3_potential || ''}</span>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td style="background:#EEF3FF;border-left:3px solid #4466CC;border-radius:0 8px 8px 0;padding:10px 14px;">
          <p style="margin:0 0 2px;color:#2244AA;font-size:12px;font-weight:700;text-transform:uppercase;">🤝 How to Get Your First Client</p>
          <p style="margin:0;color:#334488;font-size:13px;line-height:1.6;">${b.first_client_path || ''}</p>
        </td></tr>
      </table>
      <p style="margin:8px 0 0;color:#2D5016;font-size:12px;font-style:italic;">🛡️ AI-resistant because: ${b.ai_resistance || ''}</p>
      <p style="margin:6px 0 0;color:#4A6670;font-size:12px;font-style:italic;">🤝 Ideal partner: ${b.ideal_partner || ''}</p>
    </td></tr>`).join('');

  // ── Work environment HTML ──
  const env = results.work_environment || {};
  const redFlagsHtml = (env.red_flags || []).map(f =>
    `<li style="margin-bottom:6px;color:#8B3030;font-size:13px;">${f}</li>`).join('');

  // ── Action plan HTML ──
  const actionHtml = (results.action_plan || []).map(a => `
    <tr><td style="padding:16px 0;border-bottom:1px solid #B8D4DA;">
      <strong style="color:#1A6B72;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">${a.period || ''}</strong>
      <strong style="display:block;color:#0F4F53;font-size:15px;margin:4px 0 8px;">${a.title || ''}</strong>
      <p style="margin:0;color:#4A6670;font-size:14px;line-height:1.7;">${a.action || ''}</p>
    </td></tr>`).join('');

  // ── Resources HTML ──
  const resSec = results.resources || {};
  const booksHtml = (resSec.books || []).map(b =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#0F4F53;font-size:13px;">📖 ${b.title || ''}</strong><p style="margin:3px 0 0;color:#4A6670;font-size:12px;line-height:1.5;">${b.why || ''}</p></td></tr>`).join('');
  const commHtml = (resSec.communities || []).map(c =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#0F4F53;font-size:13px;">🌐 ${c.name || ''}</strong><p style="margin:3px 0 0;color:#4A6670;font-size:12px;line-height:1.5;">${c.why || ''}</p></td></tr>`).join('');
  const toolsHtml = (resSec.tools || []).map(t =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F0E8E0;"><strong style="color:#0F4F53;font-size:13px;">🛠️ ${t.name || ''}</strong><p style="margin:3px 0 0;color:#4A6670;font-size:12px;line-height:1.5;">${t.why || ''}</p></td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F8FA;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F8FA;padding:40px 20px;">
<tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:#0F4F53;border-radius:16px 16px 0 0;padding:36px 32px;text-align:center;">
    <p style="margin:0 0 6px;color:#B8D4DA;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Changing Tribes</p>
    <h1 style="margin:0 0 6px;color:#ffffff;font-size:30px;font-weight:700;">Your Pathworks Compass</h1>
    <p style="margin:0;color:#B8D4DA;font-size:13px;opacity:0.8;">Your complete career & business roadmap</p>
  </td></tr>

  <!-- TITLE BAND -->
  <tr><td style="background:linear-gradient(135deg,#0F4F53,#1A6B72);padding:24px 32px;text-align:center;">
    <p style="margin:0 0 6px;color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Your Direction Profile</p>
    <h2 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${results.compass_title || ''}</h2>
  </td></tr>

  <!-- DIRECTION + INTRO -->
  <tr><td style="background:#ffffff;padding:28px 32px;border-left:1px solid #B8D4DA;border-right:1px solid #B8D4DA;">
    <p style="margin:0 0 8px;color:#1A6B72;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Your Direction</p>
    <p style="margin:0 0 18px;color:#0F4F53;font-size:16px;font-style:italic;line-height:1.65;border-left:3px solid #1A6B72;padding-left:14px;">"${direction}"</p>
    <p style="margin:0;color:#4A6670;font-size:15px;line-height:1.8;">${results.compass_intro || ''}</p>
  </td></tr>

  <!-- PDF CALLOUT -->
  <tr><td style="background:#FFF3E0;padding:20px 32px;border:1px solid #B8D4DA;border-top:none;text-align:center;">
    <p style="margin:0;color:#0F4F53;font-size:14px;line-height:1.6;">📎 <strong>Your full Compass Report is attached as a PDF</strong> — save it, print it, or share it. It includes your complete career paths, business models, 90-day action plan, and resources.</p>
  </td></tr>

  <!-- CAREER PATHS -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
    <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;font-weight:700;">🧭 Your Career Paths — Full 10-Year View</h3>
    <p style="margin:0 0 20px;color:#4A6670;font-size:13px;">Three paths matched to who you are and where you want to go.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${careerPathsHtml}</table>
  </td></tr>

  <!-- BUSINESS MODELS -->
  <tr><td style="background:#F0F8FA;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
    <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;font-weight:700;">🚀 Business Models Built for You</h3>
    <p style="margin:0 0 20px;color:#4A6670;font-size:13px;">Three business ideas tailored to your skills, direction, and context.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${businessHtml}</table>
  </td></tr>

  <!-- WORK ENVIRONMENT -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
    <h3 style="margin:0 0 16px;color:#0F4F53;font-size:18px;font-weight:700;">🏡 Your Ideal Work Environment</h3>
    <p style="margin:0 0 6px;color:#1A6B72;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Where You Thrive</p>
    <p style="margin:0 0 16px;color:#4A6670;font-size:14px;line-height:1.75;">${env.ideal_setup || ''}</p>
    <p style="margin:0 0 6px;color:#1A6B72;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Your Ideal Culture</p>
    <p style="margin:0 0 16px;color:#4A6670;font-size:14px;line-height:1.75;">${env.ideal_culture || ''}</p>
    <p style="margin:0 0 8px;color:#8B3030;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Red Flags — Walk Away From These</p>
    <ul style="margin:0;padding-left:18px;">${redFlagsHtml}</ul>
  </td></tr>

  <!-- ACTION PLAN -->
  <tr><td style="background:#F0F8FA;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
    <h3 style="margin:0 0 6px;color:#0F4F53;font-size:18px;font-weight:700;">🗺️ Your 90-Day Action Plan</h3>
    <p style="margin:0 0 20px;color:#4A6670;font-size:13px;">Fortnightly steps — specific, concrete, and calibrated to your timeline.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${actionHtml}</table>
  </td></tr>

  <!-- RESOURCES -->
  <tr><td style="background:#ffffff;padding:28px 32px;border:1px solid #B8D4DA;border-top:none;">
    <h3 style="margin:0 0 16px;color:#0F4F53;font-size:18px;font-weight:700;">📚 Resources Matched to You</h3>
    <p style="margin:0 0 10px;color:#1A6B72;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Books</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${booksHtml}</table>
    <p style="margin:0 0 10px;color:#1A6B72;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Communities & Networks</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${commHtml}</table>
    <p style="margin:0 0 10px;color:#1A6B72;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Tools & Platforms</p>
    <table width="100%" cellpadding="0" cellspacing="0">${toolsHtml}</table>
  </td></tr>

  <!-- FOOTER CTA -->
  <tr><td style="background:#0F4F53;border-radius:0 0 16px 16px;padding:36px 32px;text-align:center;">
    <p style="margin:0 0 20px;color:#B8D4DA;font-size:14px;line-height:1.7;">Ready to take action? Get personalized assistance in reaching your goals.</p>
    <a href="https://www.changingtribes.com" style="background:#E7B928;color:#ffffff;padding:16px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Visit Changing Tribes →</a>
    <p style="margin:28px 0 0;color:#4A6670;font-size:12px;">© ${new Date().getFullYear()} Changing Tribes · <a href="https://www.changingtribes.com" style="color:#B8D4DA;">changingtribes.com</a></p>
  </td></tr>

</table></td></tr>
</table></body></html>`;

  const emailPayload = {
    from:    'Pathworks Compass <hello@changingtribes.com>',
    to:      email,
    subject: `Your Pathworks Compass: ${results.compass_title || 'Results Inside'}`,
    html,
  };

  if (pdfBuffer) {
    emailPayload.attachments = [{
      filename: 'Your-Pathworks-Compass-Report.pdf',
      content:  pdfBuffer.toString('base64'),
    }];
  }

  await resend.emails.send(emailPayload);
}
