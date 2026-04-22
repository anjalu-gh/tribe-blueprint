# Tribe Blueprint — Project Context & Restore Point

**Last updated:** April 22, 2026 — 12:10 PM EST
**Owner:** Andy (andrew@changingtribes.com)
**Live URLs:**
- https://www.pathworksblueprint.com (Blueprint)
- https://www.pathworkscompass.com (Compass)
- https://www.pathworksproject.com (Project landing)

**GitHub repo:** https://github.com/anjalu-gh/tribe-blueprint
**Netlify:** 3 sites, all auto-deploy from GitHub main branch

---

## 🔖 SAVE POINT — April 22, 2026 @ 12:10 PM EST

**Trigger phrase to restore context:** `RESET TO PATHWORKS SAVE POINT 2026-04-22`

If you ever get stuck, paste that phrase and I'll re-read this file and treat this as the known-good baseline.

### State of the three sites as of this save point

**1. pathworksblueprint.com** (root of repo → `index.html`)
- Full paid assessment app, untouched in this session
- Stripe + Supabase + Anthropic + Zoho + Resend all wired

**2. pathworkscompass.com** (root of repo → `index.html`, hostname-switched)
- Same HTML file as Blueprint, but JS detects `pathworkscompass` hostname and swaps:
  - `document.title` → "Pathworks Compass | by Changing Tribes"
  - Nav wordmark → "Pathworks Compass / by Changing Tribes"
  - Nav links replaced with: "Need to return to the Pathworks Blueprint?" text + "Get Started" CTA → pathworksblueprint.com
- Hostname-switching script lives at top of `<body>` in `index.html` (≈ lines 7–22)
- `<ul class="nav-links">` has `id="nav-links-list"` hook at ≈ line 445

**3. pathworksproject.com** (repo subfolder → `pathworks-landing/index.html`)
- Standalone landing page; different HTML from Blueprint/Compass
- Hero section now matches Blueprint copy word-for-word ("Turn What You Know Into What Comes Next")
- Top nav wired: Blueprint → blueprint URL · Compass → compass URL · About → `#how-it-works` anchor · Get Started → blueprint URL
- Section "Your Blueprint is just the starting point" has `id="how-it-works"` (≈ line 1175)
- Pointer graphic is a real vintage woodcut hand: `pathworks-landing/vintage-hand.png` rendered via `<img>` with `filter: invert(1); mix-blend-mode: screen;` so it reads as cream on the teal background

### Folders on Andy's Mac (Desktop)
- ✅ `~/Desktop/New Project/tribe-blueprint/` — LIVE SOURCE, do all edits here
- 🗑️ `~/Desktop/New Project/pathworks-compass/` — DELETED (was stale legacy)
- 📦 `~/Desktop/New Project/pathworks-project/` — ARCHIVED (was stale legacy)

### Deploy flow (confirmed working)
```bash
cd ~/Desktop/"New Project"/tribe-blueprint
git add <files>
git commit -m "describe change"
git push
# → Netlify auto-deploys all 3 sites in ~60 seconds
```

### Git tag at this save point
Run this once to mark the code at this state (see "Backup" section below for details):
```bash
cd ~/Desktop/"New Project"/tribe-blueprint
git tag -a save-2026-04-22-1210 -m "Save point: April 22, 2026 12:10 PM EST"
git push origin save-2026-04-22-1210
```

### Known-good backend env vars
All 13 Netlify env vars (Supabase, Stripe, Anthropic, Zoho, Resend, APP_URL, PRICE_CENTS) set and verified. See table below.

---

## 💾 How to back up the whole project

**Option A — Zip the folder (fast, local, no tools needed).**
Open Terminal and run:
```bash
cd ~/Desktop
zip -r "tribe-blueprint-backup-2026-04-22.zip" "New Project/tribe-blueprint" -x "*/node_modules/*" "*/.git/*"
```
This produces a dated zip on your Desktop. Excludes `node_modules` (rebuildable) and `.git` (code lives on GitHub). Do this any time you want a frozen snapshot before experimenting.

**Option B — Git tag (for code only, free via GitHub).**
```bash
cd ~/Desktop/"New Project"/tribe-blueprint
git tag -a save-2026-04-22-1210 -m "Save point: April 22, 2026 12:10 PM EST"
git push origin save-2026-04-22-1210
```
To roll back later:
```bash
git checkout save-2026-04-22-1210       # look at the old version
git reset --hard save-2026-04-22-1210   # force main back to this tag (destructive, be sure)
```

**Option C — Both.** Recommended. Zip = full safety (env files, images, uploads). Tag = clean rewind for code.

---

## What This App Does

Tribe Blueprint is a paid personality and skills assessment web app for Changing Tribes. Users pay $19 (or use a coupon code for free access), answer 25 sliding-scale questions (1–10) across 5 categories, and receive AI-generated results showing their "tribe" personality type, past work analysis, future career paths, business ideas, and a roadmap. Results are displayed on screen AND emailed to the user.

---

## Architecture Overview

| Layer | Technology |
|-------|-----------|
| Frontend | Single-page HTML/CSS/JS (`index.html`) — 5 pages: landing → access → assessment → loading → results |
| Hosting | Netlify (auto-deploy from GitHub) + custom subdomain via InMotion |
| Backend | Netlify serverless functions (Node.js, esbuild bundler) |
| Database | Supabase (PostgreSQL) — coupons, access_codes, assessments tables |
| Payments | Stripe Checkout — $19 USD (`PRICE_CENTS=1900`) |
| AI | Anthropic Claude API — model: `claude-haiku-4-5-20251001` |
| CRM | Zoho CRM v2 API — upserts Contact on assessment completion |
| Email | Resend API — sends branded results email from hello@changingtribes.com |

---

## File Structure

```
tribe-blueprint/
├── index.html                        # Full SPA (landing, access, assessment, loading, results pages)
├── privacy.html                      # Privacy policy page
├── package.json                      # Node dependencies for Netlify functions
├── netlify.toml                      # Build config (npm install, esbuild bundler, functions dir)
├── supabase-schema.sql               # Database schema (run once in Supabase SQL editor)
├── SETUP.md                          # Full deployment guide
├── PROJECT-CONTEXT.md                # THIS FILE — project restore point
└── netlify/functions/
    ├── create-checkout.js            # Creates Stripe Checkout session ($19)
    ├── verify-session.js             # Verifies Stripe payment, issues access code
    ├── verify-coupon.js              # Validates coupon, issues access code
    └── generate-results.js           # Verifies access code, calls Claude AI, saves to Supabase,
                                      #   pushes to Zoho CRM, sends Resend email
```

---

## Netlify Environment Variables (all 10 required)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. https://xxxx.supabase.co) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (bypasses RLS) |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_live_... or sk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ZOHO_CLIENT_ID` | Zoho OAuth2 client ID |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth2 client secret |
| `ZOHO_REFRESH_TOKEN` | Zoho OAuth2 refresh token (long-lived) |
| `ZOHO_DATACENTER` | `com` for USA |
| `APP_URL` | `https://www.pathworksblueprint.com` |
| `PRICE_CENTS` | `1900` (= $19.00) |
| `RESEND_API_KEY` | Resend API key (re_H4jq...) |

---

## Supabase Database Schema

Three tables (see `supabase-schema.sql` for full DDL):

- **`coupons`** — coupon codes with max_uses, expiry, use tracking
- **`access_codes`** — one-time codes issued after payment or coupon use
- **`assessments`** — completed assessment scores + AI-generated results JSON

RLS is enabled; the service role key bypasses it (used by functions).

To create a coupon in Supabase SQL editor:
```sql
INSERT INTO coupons (code, max_uses, expires_at)
VALUES ('YOURCODE', 10, '2027-01-01');
```

Test coupon (local bypass only, no DB needed): `TESTDRIVE`

---

## Zoho CRM Integration

- API version: v2
- Module: Contacts
- Fields mapped: First Name, Last Name, Email, Lead Source = "Web Download", tribe name + description saved to a custom note or description field
- Auth: OAuth2 with refresh token (token is refreshed automatically on each function call)
- The `pushToZoho()` call in `generate-results.js` is **awaited** (not fire-and-forget) — this is important or Netlify kills the function before Zoho receives data

---

## Email (Resend)

- Domain: `changingtribes.com` — **verified** in Resend dashboard (April 2026)
- From address: `hello@changingtribes.com`
- DNS records added to InMotion Hosting:
  - DKIM TXT record on `resend._domainkey.changingtribes.com`
  - SPF TXT record on `changingtribes.com` (separate from any pre-existing SPF for send.changingtribes.com — both coexist fine)
  - MX record for `send.changingtribes.com` (bounce handling)
- Email contains: tribe name, description, past work analysis, career paths, business ideas, roadmap
- Sent at end of `generate-results.js` after all other steps complete

---

## Deployment Flow

1. Code changes made locally in `/New Project/tribe-blueprint/`
2. Push to GitHub:
   ```bash
   cd $HOME/Desktop/"New Project"/tribe-blueprint
   git add .
   git commit -m "describe your change"
   git push
   ```
3. Netlify auto-detects the push and deploys (takes ~60 seconds)
4. Check deploy status: Netlify dashboard → Sites → tribe-blueprint

---

## Key Bugs Fixed (history)

- **Unescaped apostrophe** in single-quoted JS string (`can't`) broke all JS — fixed by switching to double quotes
- **Assessment timeout**: Claude Opus too slow → switched to `claude-haiku-4-5-20251001`
- **Zoho not receiving data**: `pushToZoho()` was fire-and-forget → changed to `await pushToZoho()`
- **`timeout = 26` in netlify.toml** caused deploy failure → removed that line entirely
- **Supabase key in wrong field**: service key was pasted into URL field → corrected in Netlify env vars
- **Git push failure**: placeholder `YOUR-USERNAME` left in remote URL → fixed with `git remote set-url`
- **British spellings**: "analysing", "personalised" etc. → changed to American English throughout

---

## Local Testing

Open `index.html` directly in browser (no server needed).  
Use coupon code `TESTDRIVE` to bypass payment locally.  
Use coupon code `TEST_RESULTS` (set in JS) to preview mock results.

For live preview in VS Code: install "Live Preview" extension → right-click `index.html` → Show Preview.

---

## Personality Types

The AI generates one of ~8 "tribe" archetypes based on scores, including:
- The Builder, The Connector, The Creator, The Strategist, The Healer,
  The Teacher, The Guardian, The Explorer

Exact types are determined dynamically by Claude based on the 25 question scores.

---

## Pending / Future Ideas

- [ ] Confirm Resend email delivery is working end-to-end (push Resend code to GitHub → test full flow)
- [ ] Add more question categories or change question wording (edit `index.html` questions array)
- [ ] Add an admin page to view assessment results
- [ ] Upsell or follow-up email sequence
- [ ] Affiliate/referral coupon tracking
