-- ============================================
-- Rounds v5 Migration: New Tables
-- Run against Neon PostgreSQL via admin route
-- Date: 29 March 2026
-- ============================================

-- Enable UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. PATIENT THREADS
-- Links a patient to their Rounds discussion
-- lifecycle. Maps to Patient Journey v2 stages
-- 1-11 (collapsed to 8 operational stages).
-- ============================================

CREATE TABLE IF NOT EXISTS patient_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Patient identity
  patient_name VARCHAR(200) NOT NULL,
  uhid VARCHAR(50),                      -- KareXpert Unique Hospital ID
  ip_number VARCHAR(50),                 -- Inpatient number (assigned at admission)
  even_member_id VARCHAR(50),            -- Even App member ID (if insured)

  -- GetStream channel mapping
  getstream_channel_id VARCHAR(100),     -- The patient-thread channel ID in GetStream

  -- Journey tracking
  current_stage VARCHAR(30) NOT NULL DEFAULT 'opd'
    CHECK (current_stage IN ('opd','pre_admission','admitted','pre_op','surgery','post_op','discharge','post_discharge')),
  lead_source VARCHAR(50),               -- Even App, Practo, Walk-in, Marketing, VC Referral, etc.

  -- Clinical
  primary_consultant_id UUID REFERENCES profiles(id),
  primary_diagnosis TEXT,
  planned_procedure TEXT,

  -- Organisational
  department_id UUID REFERENCES departments(id),

  -- Dates
  admission_date TIMESTAMPTZ,
  planned_surgery_date TIMESTAMPTZ,
  discharge_date TIMESTAMPTZ,

  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_threads_stage ON patient_threads(current_stage);
CREATE INDEX IF NOT EXISTS idx_patient_threads_uhid ON patient_threads(uhid) WHERE uhid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_ip_number ON patient_threads(ip_number) WHERE ip_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_consultant ON patient_threads(primary_consultant_id) WHERE primary_consultant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_dept ON patient_threads(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_created ON patient_threads(created_at DESC);

-- ============================================
-- 2. FORM SUBMISSIONS
-- All structured form data stored as JSONB.
-- Each form submission is linked to a patient
-- thread (optional) and a GetStream message.
-- ============================================

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Form identity
  form_type VARCHAR(50) NOT NULL
    CHECK (form_type IN (
      'marketing_cc_handoff','admission_advice','financial_counseling',
      'ot_billing_clearance','admission_checklist','surgery_posting',
      'pre_op_nursing_checklist','who_safety_checklist','nursing_shift_handoff',
      'discharge_readiness','post_discharge_followup','daily_department_update',
      'pac_clearance'
    )),
  form_version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','reviewed','flagged')),

  -- Relationships
  patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
  getstream_message_id VARCHAR(100),     -- Message ID in GetStream where form card lives
  getstream_channel_id VARCHAR(100),     -- Channel where the form was submitted

  -- Submitter
  submitted_by UUID NOT NULL REFERENCES profiles(id),
  department_id UUID REFERENCES departments(id),

  -- Form data (the actual fields — schema varies by form_type)
  form_data JSONB NOT NULL DEFAULT '{}',

  -- Quality
  completion_score REAL,                 -- 0.0 to 1.0 (fraction of required fields filled)
  ai_gap_report JSONB,                   -- AI-generated gap analysis (Phase 3)

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_type ON form_submissions(form_type);
CREATE INDEX IF NOT EXISTS idx_form_submissions_patient ON form_submissions(patient_thread_id) WHERE patient_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_submitted_by ON form_submissions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_gs_message ON form_submissions(getstream_message_id) WHERE getstream_message_id IS NOT NULL;

-- ============================================
-- 3. READINESS ITEMS
-- Individual checklist items extracted from
-- forms like Surgery Posting, Pre-Op Checklist,
-- Discharge Readiness. Each item is independently
-- confirmable and has its own SLA.
-- Maps to Patient Journey v2 Stages 5-6-10.
-- ============================================

CREATE TABLE IF NOT EXISTS readiness_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent
  form_submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,

  -- Item definition
  item_name VARCHAR(200) NOT NULL,
  item_category VARCHAR(100) NOT NULL,   -- e.g. 'consent', 'investigation', 'clearance', 'billing', 'nursing'
  item_description TEXT,

  -- Responsibility
  responsible_role VARCHAR(50),          -- role that should confirm this (maps to UserRole)
  responsible_user_id UUID REFERENCES profiles(id),
  responsible_department_id UUID REFERENCES departments(id),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','flagged','not_applicable')),
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMPTZ,
  flagged_reason TEXT,
  notes TEXT,

  -- SLA
  due_by TIMESTAMPTZ,
  escalated BOOLEAN NOT NULL DEFAULT false,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_readiness_form ON readiness_items(form_submission_id);
CREATE INDEX IF NOT EXISTS idx_readiness_patient ON readiness_items(patient_thread_id) WHERE patient_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readiness_status ON readiness_items(status);
CREATE INDEX IF NOT EXISTS idx_readiness_responsible ON readiness_items(responsible_user_id) WHERE responsible_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_readiness_due ON readiness_items(due_by) WHERE due_by IS NOT NULL AND status = 'pending';

-- ============================================
-- 4. ESCALATION LOG
-- Immutable audit trail of all escalations.
-- Covers: SLA breaches on readiness items,
-- message-level escalations, form gap reports,
-- and manual escalations.
-- ============================================

CREATE TABLE IF NOT EXISTS escalation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source of escalation
  source_type VARCHAR(30) NOT NULL
    CHECK (source_type IN ('message','readiness_item','form_gap','sla_breach','manual')),
  source_id VARCHAR(100) NOT NULL,       -- ID of the message, readiness item, or form

  -- People
  escalated_from UUID REFERENCES profiles(id),
  escalated_to UUID REFERENCES profiles(id),

  -- Context
  patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
  getstream_channel_id VARCHAR(100),
  getstream_message_id VARCHAR(100),

  -- Details
  reason TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,      -- Escalation chain level (1 = first, 2 = second, etc.)
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_source ON escalation_log(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_escalation_patient ON escalation_log(patient_thread_id) WHERE patient_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escalation_unresolved ON escalation_log(resolved, created_at) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_escalation_created ON escalation_log(created_at DESC);

-- ============================================
-- 5. ADMISSION TRACKER
-- Replaces Tamanna & Kavya's Google Sheet.
-- One row per active inpatient. Enriched with
-- fields from Patient Journey v2 Stages 4-10:
-- financial counselling, OT clearance, pre-auth,
-- deposit, room, package, surgery readiness,
-- discharge TAT.
-- ============================================

CREATE TABLE IF NOT EXISTS admission_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Patient
  patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
  patient_name VARCHAR(200) NOT NULL,
  uhid VARCHAR(50) NOT NULL,
  ip_number VARCHAR(50) NOT NULL,
  even_member_id VARCHAR(50),

  -- Admission
  admission_date TIMESTAMPTZ NOT NULL,
  admitted_by UUID REFERENCES profiles(id),

  -- Clinical
  primary_surgeon VARCHAR(200),
  primary_surgeon_id UUID REFERENCES profiles(id),
  surgery_name VARCHAR(300),
  planned_surgery_date TIMESTAMPTZ,
  actual_surgery_date TIMESTAMPTZ,

  -- Room
  room_number VARCHAR(20),
  bed_number VARCHAR(20),
  room_category VARCHAR(20) NOT NULL DEFAULT 'general'
    CHECK (room_category IN ('general','semi_private','private','suite','icu','nicu')),

  -- Financial (from Patient Journey v2 Stage 4)
  financial_category VARCHAR(20) NOT NULL DEFAULT 'insurance'
    CHECK (financial_category IN ('cash','insurance','credit')),
  package_name VARCHAR(200),
  estimated_cost NUMERIC(12,2),
  deposit_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (deposit_status IN ('pending','partial','collected','waived')),
  deposit_amount NUMERIC(12,2),
  deposit_collected_at TIMESTAMPTZ,

  -- Insurance/Pre-auth (from Patient Journey v2 Stage 4)
  pre_auth_status VARCHAR(20) NOT NULL DEFAULT 'not_required'
    CHECK (pre_auth_status IN ('not_required','pending','approved','denied','extension_pending')),
  pre_auth_amount NUMERIC(12,2),
  tpa_name VARCHAR(100),
  policy_number VARCHAR(100),

  -- Counselling & Clearance (from Patient Journey v2 Stages 4-5)
  financial_counselling_complete BOOLEAN NOT NULL DEFAULT false,
  financial_counselling_sheet_signed BOOLEAN NOT NULL DEFAULT false,
  ot_clearance_complete BOOLEAN NOT NULL DEFAULT false,
  ot_clearance_sheet_signed BOOLEAN NOT NULL DEFAULT false,
  pac_complete BOOLEAN NOT NULL DEFAULT false,

  -- Specialist Clearance (from Patient Journey v2 Stage 4 protocol)
  physician_clearance_required BOOLEAN NOT NULL DEFAULT false,
  physician_clearance_done BOOLEAN NOT NULL DEFAULT false,
  cardiologist_clearance_required BOOLEAN NOT NULL DEFAULT false,
  cardiologist_clearance_done BOOLEAN NOT NULL DEFAULT false,

  -- Surgery readiness
  surgery_readiness VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (surgery_readiness IN ('not_started','in_progress','ready','blocked')),

  -- Status
  current_status VARCHAR(20) NOT NULL DEFAULT 'admitted'
    CHECK (current_status IN ('admitted','pre_op','in_surgery','post_op','discharge_planned','discharged')),

  -- Discharge (from Patient Journey v2 Stage 10)
  discharge_order_at TIMESTAMPTZ,
  discharge_completed_at TIMESTAMPTZ,
  discharge_tat_minutes INTEGER,         -- Calculated: discharge_completed_at - discharge_order_at
  discharge_type VARCHAR(30)
    CHECK (discharge_type IS NULL OR discharge_type IN ('normal','dama','lama','transfer','death')),

  -- Assigned coordinators
  ip_coordinator_id UUID REFERENCES profiles(id),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admission_tracker_status ON admission_tracker(current_status);
CREATE INDEX IF NOT EXISTS idx_admission_tracker_patient ON admission_tracker(patient_thread_id) WHERE patient_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admission_tracker_uhid ON admission_tracker(uhid);
CREATE INDEX IF NOT EXISTS idx_admission_tracker_ip ON admission_tracker(ip_number);
CREATE INDEX IF NOT EXISTS idx_admission_tracker_surgery_date ON admission_tracker(planned_surgery_date) WHERE planned_surgery_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admission_tracker_active ON admission_tracker(current_status, admission_date DESC) WHERE current_status != 'discharged';

-- ============================================
-- 6. DUTY ROSTER
-- Who is on duty when, by role and department.
-- Used by the cascade engine to resolve "who
-- should I notify for this role right now?"
-- ============================================

CREATE TABLE IF NOT EXISTS duty_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  user_id UUID NOT NULL REFERENCES profiles(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  role VARCHAR(50) NOT NULL,             -- Matches UserRole

  -- When
  shift_type VARCHAR(20) NOT NULL
    CHECK (shift_type IN ('day','evening','night','on_call','visiting')),
  day_of_week INTEGER[] NOT NULL,        -- {0,1,2,3,4,5,6} where 0=Sunday
  shift_start_time TIME,                 -- e.g. 08:00
  shift_end_time TIME,                   -- e.g. 20:00

  -- Validity
  effective_from DATE NOT NULL,
  effective_to DATE,                     -- NULL = ongoing

  -- Overrides (temporary duty swaps)
  is_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  override_date DATE,                    -- Specific date for one-off overrides

  -- Metadata
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duty_roster_user ON duty_roster(user_id);
CREATE INDEX IF NOT EXISTS idx_duty_roster_dept_role ON duty_roster(department_id, role);
CREATE INDEX IF NOT EXISTS idx_duty_roster_shift ON duty_roster(shift_type, day_of_week);
CREATE INDEX IF NOT EXISTS idx_duty_roster_effective ON duty_roster(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_duty_roster_override ON duty_roster(override_date) WHERE is_override = true;

-- ============================================
-- AUTO-UPDATE TRIGGERS
-- Automatically set updated_at on row changes.
-- ============================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables that have updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'patient_threads',
    'form_submissions',
    'admission_tracker'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================
-- MIGRATION RECORD
-- ============================================

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO _migrations (name) VALUES ('v5-tables-initial')
ON CONFLICT (name) DO NOTHING;
