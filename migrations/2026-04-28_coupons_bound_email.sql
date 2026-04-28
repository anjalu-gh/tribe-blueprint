-- Migration: add bound_email column to coupons
-- Purpose: lock follow-up coupons (issued automatically after a paid Compass)
--          to a specific email address so they can't be forwarded or shared.
-- Generic coupons (e.g. COMPASSTEST) keep working: bound_email is NULL for them.
--
-- Run this in the Supabase SQL editor before deploying the new code.

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS bound_email text;

-- Lookup index used to check "does this email already have a follow-up coupon?"
-- Partial index keeps it small (only rows where bound_email is set).
CREATE INDEX IF NOT EXISTS coupons_bound_email_idx
  ON coupons (bound_email)
  WHERE bound_email IS NOT NULL;
