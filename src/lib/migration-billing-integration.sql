-- ============================================
-- Rounds Billing Integration Migration
-- Run against Neon PostgreSQL via admin route
-- Date: 2 April 2026
-- Source: Mohan (IPD Billing) meeting 1 Apr 2026
-- Design: ROUNDS-BILLING-INTEGRATION-DESIGN.md
-- ============================================

-- ============================================
-- 1. INSURANCE CLAIMS
-- One per insurance claim per patient admission.
-- Central billing entity — holds current state,
-- connects to claim_events for full history.
-- ============================================

CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
  admission_tracker_id UUID REFERENCES admission_tracker(id) ON DELETE SET NULL,

  -- Insurance Identity
  insurer_name VARCHAR(200),
  tpa_name VARCHAR(200),
  submission_channel VARCHAR(20) NOT NULL DEFAULT 'tpa'
    CHECK (submission_channel IN ('tpa', 'direct')),
  portal_used VARCHAR(50),
  policy_number VARCHAR(100),
  claim_number VARCHAR(100),
  patient_card_photo_url TEXT,

  -- Financial Counseling Snapshot
  sum_insured NUMERIC(12,2),
  room_rent_eligibility NUMERIC(10,2),
  room_category_selected VARCHAR(20),
  actual_room_rent NUMERIC(10,2),
  proportional_deduction_pct NUMERIC(5,2),
  co_pay_pct NUMERIC(5,2),
  has_room_rent_waiver BOOLEAN DEFAULT false,

  -- Pre-Auth
  estimated_cost NUMERIC(12,2),
  pre_auth_submitted_at TIMESTAMPTZ,
  pre_auth_approved_at TIMESTAMPTZ,
  pre_auth_amount NUMERIC(12,2),
  pre_auth_status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (pre_auth_status IN (
      'not_started', 'submitted', 'queried', 'approved', 'denied', 'partial'
    )),
  pre_auth_tat_minutes INTEGER,

  -- Enhancement Tracking
  total_enhancements INTEGER DEFAULT 0,
  latest_enhancement_amount NUMERIC(12,2),
  cumulative_approved_amount NUMERIC(12,2),

  -- Final Settlement
  final_bill_amount NUMERIC(12,2),
  final_submitted_at TIMESTAMPTZ,
  final_approved_at TIMESTAMPTZ,
  final_approved_amount NUMERIC(12,2),
  final_settlement_tat_minutes INTEGER,
  hospital_discount NUMERIC(12,2),
  non_payable_deductions NUMERIC(12,2),
  patient_liability NUMERIC(12,2),

  -- Claim Lifecycle Status
  claim_status VARCHAR(30) NOT NULL DEFAULT 'counseling'
    CHECK (claim_status IN (
      'counseling',
      'pre_auth_pending',
      'pre_auth_queried',
      'pre_auth_approved',
      'pre_auth_denied',
      'enhancement_pending',
      'active',
      'final_submitted',
      'final_queried',
      'settled',
      'rejected',
      'disputed'
    )),

  -- Revenue Recovery (calculated on settlement)
  recovery_rate NUMERIC(5,2),
  revenue_leakage NUMERIC(12,2),
  leakage_reason TEXT,

  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_patient ON insurance_claims(patient_thread_id);
CREATE INDEX IF NOT EXISTS idx_claims_admission ON insurance_claims(admission_tracker_id)
  WHERE admission_tracker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(claim_status);
CREATE INDEX IF NOT EXISTS idx_claims_insurer ON insurance_claims(insurer_name)
  WHERE insurer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_tpa ON insurance_claims(tpa_name)
  WHERE tpa_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_created ON insurance_claims(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_active ON insurance_claims(claim_status, updated_at DESC)
  WHERE claim_status NOT IN ('settled', 'rejected');

-- ============================================
-- 2. CLAIM EVENTS
-- Immutable event log. Every status change,
-- submission, query, approval gets a row.
-- Powers timeline, TAT calculations, audit.
-- ============================================

CREATE TABLE IF NOT EXISTS claim_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent
  insurance_claim_id UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,

  -- Event
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN (
      'pre_auth_submitted', 'pre_auth_queried', 'pre_auth_query_responded',
      'pre_auth_approved', 'pre_auth_denied', 'pre_auth_partial',
      'enhancement_triggered', 'enhancement_doctor_notified',
      'enhancement_case_summary_submitted',
      'enhancement_submitted', 'enhancement_approved', 'enhancement_denied',
      'final_bill_prepared', 'final_submitted', 'final_queried',
      'final_query_responded', 'final_approved', 'final_rejected',
      'dispute_initiated', 'dispute_resolved',
      'counseling_completed', 'room_change',
      'follow_up_needed', 'follow_up_completed',
      'note_added', 'document_uploaded'
    )),

  -- Details
  description TEXT NOT NULL,
  amount NUMERIC(12,2),
  portal_reference VARCHAR(200),

  -- Documents
  document_urls TEXT[],

  -- Timing
  insurer_response_needed BOOLEAN DEFAULT false,
  insurer_response_deadline TIMESTAMPTZ,

  -- Who
  performed_by UUID REFERENCES profiles(id),
  performed_by_name VARCHAR(200),

  -- GetStream Integration
  getstream_message_id VARCHAR(100),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_events_claim ON claim_events(insurance_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_events_patient ON claim_events(patient_thread_id);
CREATE INDEX IF NOT EXISTS idx_claim_events_type ON claim_events(event_type);
CREATE INDEX IF NOT EXISTS idx_claim_events_created ON claim_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_events_pending ON claim_events(insurer_response_deadline)
  WHERE insurer_response_needed = true;

-- ============================================
-- 3. DISCHARGE MILESTONES
-- One per discharge attempt. Tracks the exact
-- timestamp chain from discharge order through
-- to patient departure. Mohan's #1 request.
-- ============================================

CREATE TABLE IF NOT EXISTS discharge_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
  admission_tracker_id UUID REFERENCES admission_tracker(id) ON DELETE SET NULL,
  insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE SET NULL,

  -- The Milestone Chain
  discharge_ordered_at TIMESTAMPTZ,
  discharge_ordered_by UUID REFERENCES profiles(id),

  pharmacy_clearance_at TIMESTAMPTZ,
  pharmacy_cleared_by UUID REFERENCES profiles(id),

  lab_clearance_at TIMESTAMPTZ,
  lab_cleared_by UUID REFERENCES profiles(id),

  discharge_summary_at TIMESTAMPTZ,
  discharge_summary_by UUID REFERENCES profiles(id),

  billing_closure_at TIMESTAMPTZ,
  billing_closed_by UUID REFERENCES profiles(id),

  final_bill_submitted_at TIMESTAMPTZ,
  final_bill_submitted_by UUID REFERENCES profiles(id),

  final_approval_at TIMESTAMPTZ,
  final_approval_logged_by UUID REFERENCES profiles(id),

  patient_settled_at TIMESTAMPTZ,
  patient_settled_by UUID REFERENCES profiles(id),

  patient_departed_at TIMESTAMPTZ,

  -- Calculated TATs (in minutes)
  tat_order_to_pharmacy INTEGER,
  tat_order_to_summary INTEGER,
  tat_summary_to_billing INTEGER,
  tat_billing_to_submission INTEGER,
  tat_submission_to_approval INTEGER,
  tat_order_to_departure INTEGER,

  -- Status
  is_complete BOOLEAN DEFAULT false,
  is_cancelled BOOLEAN DEFAULT false,
  cancellation_reason TEXT,

  -- Bottleneck Detection
  bottleneck_step VARCHAR(40),
  bottleneck_minutes INTEGER,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discharge_ms_patient ON discharge_milestones(patient_thread_id);
CREATE INDEX IF NOT EXISTS idx_discharge_ms_active ON discharge_milestones(is_complete, created_at DESC)
  WHERE is_complete = false AND is_cancelled = false;
CREATE INDEX IF NOT EXISTS idx_discharge_ms_created ON discharge_milestones(created_at DESC);

-- ============================================
-- 4. EXTEND ADMISSION TRACKER
-- Add billing-specific columns that bridge
-- to the new insurance_claims table.
-- ============================================

ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  insurance_claim_id UUID REFERENCES insurance_claims(id);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  insurer_name VARCHAR(200);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  submission_channel VARCHAR(20) DEFAULT 'tpa';
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  sum_insured NUMERIC(12,2);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  room_rent_eligibility NUMERIC(10,2);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  proportional_deduction_risk NUMERIC(5,2);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  running_bill_amount NUMERIC(12,2);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  cumulative_approved_amount NUMERIC(12,2);
ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS
  enhancement_alert_threshold NUMERIC(12,2) DEFAULT 50000;

-- ============================================
-- 5. AUTO-UPDATE TRIGGERS
-- Apply updated_at trigger to new tables.
-- ============================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'insurance_claims',
    'discharge_milestones'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================
-- 6. MIGRATION RECORD
-- ============================================

INSERT INTO _migrations (name) VALUES ('billing-integration-v1')
ON CONFLICT (name) DO NOTHING;
