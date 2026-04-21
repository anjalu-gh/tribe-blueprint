# Tribe Blueprint — Project Context & Restore Point

**Last updated:** April 21, 2026  
**Owner:** Andy (andrew@changingtribes.com)  
**Live URL:** https://blueprint.changingtribes.com  
**GitHub repo:** https://github.com/anjalu-gh/tribe-blueprint  
**Netlify site:** auto-deploys from GitHub main branch  

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
| Email | Resend API — sends branded results email from blueprint@changingtribes.com |

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
| `APP_URL` | `https://blueprint.changingtribes.com` |
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
- From address: `blueprint@changingtribes.com`
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
