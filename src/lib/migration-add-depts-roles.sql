-- ============================================
-- Migration: Add Marketing & Administration departments + new roles
-- Date: 31 March 2026
-- ============================================

-- 1. Widen role column from VARCHAR(20) to VARCHAR(30) for longer role names
ALTER TABLE profiles ALTER COLUMN role TYPE VARCHAR(30);

-- 2. Drop old CHECK constraint and add updated one with all roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'super_admin', 'department_head', 'staff',
    'ip_coordinator', 'anesthesiologist', 'ot_coordinator',
    'nurse', 'billing_executive', 'insurance_coordinator',
    'pharmacist', 'physiotherapist', 'marketing_executive',
    'clinical_care', 'pac_coordinator',
    'administrator', 'medical_administrator', 'operations_manager', 'unit_head',
    'marketing', 'guest'
  ));

-- 3. Insert Marketing department (safe — ON CONFLICT)
INSERT INTO departments (name, slug)
VALUES ('Marketing', 'marketing')
ON CONFLICT (slug) DO NOTHING;

-- 4. Insert Administration department (safe — ON CONFLICT)
INSERT INTO departments (name, slug)
VALUES ('Administration', 'administration')
ON CONFLICT (slug) DO NOTHING;
