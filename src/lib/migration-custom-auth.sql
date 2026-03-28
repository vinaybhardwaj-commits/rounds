-- ============================================
-- Migration: Add custom auth fields to profiles
-- Run this on the existing Neon database
-- ============================================

-- Add password_hash column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Add status column with default
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending_approval';

-- Add CHECK constraint for status (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('pending_approval', 'active', 'suspended', 'rejected'));
  END IF;
END $$;

-- Add approval tracking columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Add index on status for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

-- Seed superuser: vinay.bhardwaj@even.in
INSERT INTO profiles (email, full_name, role, account_type, status)
VALUES ('vinay.bhardwaj@even.in', 'Vinay Bhardwaj', 'super_admin', 'internal', 'active')
ON CONFLICT (email) DO UPDATE SET
  role = 'super_admin',
  status = 'active',
  updated_at = NOW();
