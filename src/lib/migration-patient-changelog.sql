-- ============================================
-- Migration: Patient Changelog + New Stages + PAC Status
-- Date: 31 March 2026
-- ============================================

-- 1. Add pac_status column to patient_threads
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS pac_status VARCHAR(30) DEFAULT NULL;

-- 2. Update current_stage constraint to include new stages
ALTER TABLE patient_threads DROP CONSTRAINT IF EXISTS patient_threads_current_stage_check;
ALTER TABLE patient_threads ADD CONSTRAINT patient_threads_current_stage_check
  CHECK (current_stage IN (
    'opd', 'pre_admission', 'admitted', 'pre_op', 'surgery',
    'post_op', 'discharge', 'post_discharge',
    'medical_management', 'post_op_care', 'long_term_followup'
  ));

-- 3. Add pac_status constraint
ALTER TABLE patient_threads ADD CONSTRAINT patient_threads_pac_status_check
  CHECK (pac_status IS NULL OR pac_status IN (
    'telemed_pac_pending', 'inpatient_pac_pending',
    'telemed_pac_passed', 'inpatient_pac_passed'
  ));

-- 4. Create patient_changelog table
CREATE TABLE IF NOT EXISTS patient_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_thread_id UUID NOT NULL REFERENCES patient_threads(id),
  change_type VARCHAR(30) NOT NULL
    CHECK (change_type IN ('stage_change', 'field_edit', 'pac_status_change', 'form_submission')),
  field_name VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  old_display TEXT,
  new_display TEXT,
  changed_by UUID NOT NULL REFERENCES profiles(id),
  changed_by_name VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Indexes for changelog
CREATE INDEX IF NOT EXISTS idx_changelog_patient ON patient_changelog(patient_thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_type ON patient_changelog(change_type);
CREATE INDEX IF NOT EXISTS idx_changelog_created ON patient_changelog(created_at DESC);
