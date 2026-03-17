-- ═══════════════════════════════════════════════════════════
--  Tribe Compass — Supabase Database Schema
--  Run this entire file in the Supabase SQL Editor
--  (Dashboard → SQL Editor → New Query → paste → Run)
-- ═══════════════════════════════════════════════════════════

-- ── 1. COUPONS ──────────────────────────────────────────────
-- You create coupon codes here and share them with people
-- who should get free access.

CREATE TABLE IF NOT EXISTS coupons (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  code        TEXT    UNIQUE NOT NULL,           -- e.g. 'CHANGINGTRIBES'
  max_uses    INTEGER DEFAULT 1,                 -- how many times it can be used
  uses_count  INTEGER DEFAULT 0,                 -- how many times used so far
  active      BOOLEAN DEFAULT TRUE,              -- set FALSE to disable
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ                        -- NULL = never expires
);

-- ── 2. ACCESS CODES ─────────────────────────────────────────
-- Generated automatically after a successful payment or coupon redemption.
-- Each code unlocks exactly one assessment.

CREATE TABLE IF NOT EXISTS access_codes (
  id                   UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  code                 TEXT    UNIQUE NOT NULL,
  email                TEXT,
  source               TEXT    NOT NULL CHECK (source IN ('stripe', 'coupon')),
  stripe_session_id    TEXT,
  coupon_id            UUID    REFERENCES coupons (id),
  assessment_completed BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. ASSESSMENTS ──────────────────────────────────────────
-- Stores the completed assessment answers and the AI-generated results.

CREATE TABLE IF NOT EXISTS assessments (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  access_code  TEXT    NOT NULL,
  email        TEXT,
  answers      JSONB   NOT NULL,   -- { q1: 5, q2: 8, ... }
  results      JSONB,              -- full AI results object
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_access_codes_code        ON access_codes (code);
CREATE INDEX IF NOT EXISTS idx_access_codes_stripe      ON access_codes (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_assessments_access_code  ON assessments  (access_code);
CREATE INDEX IF NOT EXISTS idx_assessments_email        ON assessments  (email);

-- ── ROW-LEVEL SECURITY ───────────────────────────────────────
-- Enable RLS so only your service-role key (used by the Netlify functions)
-- can read/write these tables. The public anon key cannot access them.

ALTER TABLE coupons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments  ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically — no extra policy needed.
-- If you ever want to add an admin dashboard, create a policy here.


-- ── 4. COMPASS ASSESSMENTS ──────────────────────────────────
-- Stores Tribes Compass direction statements and AI-generated results.

CREATE TABLE IF NOT EXISTS compass_assessments (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  access_code         TEXT        NOT NULL,
  email               TEXT,
  direction_statement TEXT,
  blueprint_answers   JSONB,      -- snapshot of Blueprint scores used
  results             JSONB,      -- full Compass AI results object
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compass_access_code ON compass_assessments (access_code);
CREATE INDEX IF NOT EXISTS idx_compass_email        ON compass_assessments (email);

ALTER TABLE compass_assessments ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
--  SAMPLE DATA  —  uncomment and edit to create your coupons
-- ═══════════════════════════════════════════════════════════

-- Unlimited uses coupon (great for sharing on social or email lists):
INSERT INTO coupons (code, max_uses) VALUES ('AJLCOUPON', 9999);
INSERT INTO coupons (code, max_uses) VALUES ('AJL2026', 9999);

-- Single-use VIP coupon:
-- INSERT INTO coupons (code, max_uses) VALUES ('ANDYVIP', 1);

-- Expiring launch coupon (expires 31 Dec 2026):
-- INSERT INTO coupons (code, max_uses, expires_at)
-- VALUES ('LAUNCH2026', 200, '2026-12-31 23:59:59+00');
