# Tribe Blueprint — Deployment Guide
**Changing Tribes Career & Life Transition Assessment**

This guide walks you through the complete setup: database, payments, AI, Zoho CRM, and hosting.
Estimated time: 45–60 minutes.

---

## What You'll Need Accounts For

| Service        | What it does                                      | Cost                        |
| -------------- | ------------------------------------------------- | --------------------------- |
| [Supabase][1]  | Database — stores coupons, access codes, results  | Free tier is plenty         |
| [Stripe][2]    | Handles $19 payments                              | 2.9% + 30¢ per transaction  |
| [Anthropic][3] | AI that generates the results                     | \~$0.01–0.05 per assessment |
| [Zoho CRM][4]  | Receives a Contact for every completed assessment | You already have this       |
| [Netlify][5]   | Hosts the website                                 | Free tier is fine           |
| [GitHub][6]    | Stores the code (Netlify deploys from here)       | Free                        |

---

## Step 1 — Set Up Supabase

1. Go to [supabase.com][7] → **New Project**
2. Give it a name (e.g. `tribe-blueprint`), choose a region close to you, set a password
3. Once created, go to **SQL Editor** → **New Query**
4. Paste the entire contents of `supabase-schema.sql` and click **Run**
5. To create coupon codes, scroll to the bottom of the SQL file, uncomment the `INSERT` lines you want, edit them, and run them

**Get your keys:**
- Go to **Project Settings → API**
- Copy the **Project URL** → this is `SUPABASE_URL`
- Copy the **service\_role** secret key (not the anon key) → this is `SUPABASE_SERVICE_KEY`

---

## Step 2 — Set Up Stripe

1. Go to [dashboard.stripe.com][8] → Sign up / log in
2. Start in **Test mode** (toggle in top-left) while testing
3. Go to **Developers → API keys**
   4. Copy the **Secret key** → this is `STRIPE_SECRET_KEY`
4. The app charges **$19 USD** by default. Change this with the `PRICE_CENTS` environment variable (in cents, so `1900` = $19.00)

When ready to go live, switch Stripe to **Live mode** and use the live secret key.

---

## Step 3 — Get an Anthropic API Key

1. Go to [console.anthropic.com][9] → Sign up / log in
2. Go to **API Keys** → **Create Key**
3. Copy it → this is `ANTHROPIC_API_KEY`
4. Add $10 in credits to start — it lasts a long time at ~$0.02 per assessment

---

## Step 4 — Set Up Zoho CRM Integration

Every time someone completes the Tribe Blueprint assessment, they are automatically added as a **Contact** in your Zoho CRM with their Tribe Profile, career path matches, and business ideas saved in the Description field.

### 4a — Create a Zoho Developer App

1. Go to [api-console.zoho.com][10] and sign in with your Zoho account
2. Click **Add Client** → choose **Server-based Applications**
3. Fill in:
   4. **Client Name:** Tribe Blueprint
   5. **Homepage URL:** your Netlify URL (e.g. `https://blueprint.changingtribes.com`)
   6. **Authorized Redirect URIs:** `https://www.zoho.com/crm/developer/oauthredirect` (use this exactly)
4. Click **Create** — you'll see your **Client ID** and **Client Secret**. Copy both.

### 4b — Generate a Refresh Token (one-time setup)

Zoho uses OAuth — you need to do this once to get a long-lived refresh token.

1. In your browser, visit this URL (replace `YOUR_CLIENT_ID` with yours):

```
https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.Contacts.CREATE,ZohoCRM.modules.Contacts.UPDATE&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=https://www.zoho.com/crm/developer/oauthredirect
```

2. Log in and click **Accept** — Zoho will redirect you to a page showing a **code** in the URL. Copy that code (it starts with `1000.`). It expires in 60 seconds so be quick.

3. Open Terminal and run this command (replace the three values):

```bash
curl -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=https://www.zoho.com/crm/developer/oauthredirect" \
  -d "code=THE_CODE_YOU_COPIED"
```

4. You'll get back a JSON response. Copy the **refresh\_token** value → this is `ZOHO_REFRESH_TOKEN`

**Note:** If your Zoho account is in the EU, India, or Australia, use the region-specific URL:
- EU: `accounts.zoho.eu`
- India: `accounts.zoho.in`
- Australia: `accounts.zoho.com.au`

And set `ZOHO_DATACENTER` to `eu`, `in`, or `com.au` in your Netlify environment variables.

### 4c — Check Your Lead Source Picklist

The app sets **Lead Source** to `Web Download` by default. Make sure this value exists in your Zoho CRM:
- Go to Zoho CRM → **Setup → Customization → Modules → Contacts → Fields**
- Find the **Lead Source** field → check the picklist values
- If `Web Download` isn't there, either add it or edit `generate-results.js` and change `'Web Download'` to a value that exists in your account

---

## Step 5 — Push Code to GitHub

1. Go to [github.com][11] → **New repository** → name it `tribe-blueprint`
2. On your computer, open Terminal:

```bash
cd "path/to/tribe-compass"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/tribe-blueprint.git
git push -u origin main
```

---

## Step 6 — Deploy to Netlify

1. Go to [netlify.com][12] → **Add new site → Import an existing project**
2. Connect to **GitHub** and select your `tribe-blueprint` repo
3. Build settings are auto-detected — click **Deploy**
4. Once deployed, note your Netlify URL (e.g. `https://amazing-name-123.netlify.app`)

**Set your environment variables:**
Netlify → Site Settings → Environment Variables → Add all of the following:

| Variable               | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`         | Your Supabase Project URL                                        |
| `SUPABASE_SERVICE_KEY` | Your Supabase service\_role key                                  |
| `STRIPE_SECRET_KEY`    | Your Stripe secret key                                           |
| `ANTHROPIC_API_KEY`    | Your Anthropic API key                                           |
| `APP_URL`              | Your full site URL (e.g. `https://blueprint.changingtribes.com`) |
| `PRICE_CENTS`          | `1900` (for $19.00)                                              |
| `ZOHO_CLIENT_ID`       | From Step 4a                                                     |
| `ZOHO_CLIENT_SECRET`   | From Step 4a                                                     |
| `ZOHO_REFRESH_TOKEN`   | From Step 4b                                                     |
| `ZOHO_DATACENTER`      | `com` (or `eu` / `in` / `com.au` if not US)                      |

After adding variables, go to **Deploys → Trigger deploy** to redeploy.

---

## Step 7 — Point a Subdomain from InMotion Hosting

Rather than using an ugly Netlify URL, you can host Tribe Blueprint at something like `blueprint.changingtribes.com` — while your main site stays on InMotion. This takes about 5 minutes.

1. Log in to your **InMotion Hosting cPanel**
2. Go to **Domains → Zone Editor** (or **DNS Zone Editor**)
3. Find `changingtribes.com` and click **Manage**
4. Add a new DNS record:
   5. **Type:** CNAME
   6. **Name:** `blueprint` (or whatever subdomain you want — `blueprint`, `assess`, `quiz`, etc.)
   7. **Value:** your Netlify subdomain, e.g. `amazing-name-123.netlify.app`
   8. **TTL:** 3600 (or leave as default)
5. Save the record. DNS changes take 5–30 minutes to propagate.

6. Back in Netlify → **Site Settings → Domain Management → Add custom domain**
   2. Enter `blueprint.changingtribes.com`
   3. Netlify will verify it automatically and issue a free SSL certificate

7. Update your `APP_URL` environment variable to `https://blueprint.changingtribes.com` and redeploy.

Your site is now live at `https://blueprint.changingtribes.com` — fully secure, on your brand domain.

---

## Step 8 — Create Your Coupon Codes

In Supabase → SQL Editor:

```sql
-- Your personal test coupon:
INSERT INTO coupons (code, max_uses) VALUES ('ANDYTEST', 10);

-- Unlimited coupon for emails and social:
INSERT INTO coupons (code, max_uses) VALUES ('CHANGINGTRIBES', 9999);

-- Time-limited launch offer:
INSERT INTO coupons (code, max_uses, expires_at)
VALUES ('LAUNCH2026', 100, '2026-12-31 23:59:59+00');

-- Disable a coupon:
UPDATE coupons SET active = FALSE WHERE code = 'OLDCODE';
```

---

## Step 9 — Test Everything

1. Use Stripe's test card: **4242 4242 4242 4242**, any future expiry, any CVC
2. Complete the assessment
3. Check Zoho CRM → Contacts — you should see the new contact appear within seconds
4. When happy, switch Stripe to **Live mode** and update `STRIPE_SECRET_KEY` in Netlify

---

## What Each Completed Assessment Sends to Zoho CRM

| Zoho Field  | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Last Name   | Derived from email (e.g. `andrew@...` → `Andrew`)           |
| Email       | Their email address                                         |
| Lead Source | `Web Download` (configurable)                               |
| Description | Tribe name, tribe description, career paths, business ideas |

---

## Viewing Your Data in Supabase

In Supabase → **Table Editor**:
- `assessments` — all completed assessments with full answers + AI results
- `access_codes` — all access codes issued (paid + coupon)
- `coupons` — coupon inventory and usage counts

---

## Customising the App

All content is in `index.html`. Open it in any text editor:
- **Price on landing page:** search for `$19`
- **Questions:** find the `categories` array in the `<script>` section
- **Brand colours:** edit the `:root { ... }` CSS variables at the top
- **Changing Tribes link:** search for `changingtribes.com`

To change the AI model or adjust the prompt, edit `netlify/functions/generate-results.js`.
To change what gets sent to Zoho, edit the `pushToZoho` function in the same file.

After any change: save → commit to GitHub → Netlify auto-deploys in \~60 seconds.

---

## Questions?

Contact: andrew@changingtribes.com

[1]:	https://supabase.com
[2]:	https://stripe.com
[3]:	https://console.anthropic.com
[4]:	https://crm.zoho.com
[5]:	https://netlify.com
[6]:	https://github.com
[7]:	https://supabase.com
[8]:	https://dashboard.stripe.com
[9]:	https://console.anthropic.com
[10]:	https://api-console.zoho.com
[11]:	https://github.com
[12]:	https://netlify.com