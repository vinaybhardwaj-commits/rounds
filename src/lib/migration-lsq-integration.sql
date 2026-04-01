-- ============================================
-- Rounds: LeadSquared Integration Migration
-- Adds LSQ tracking fields to patient_threads
-- and creates sync log table.
-- Date: 1 April 2026
-- ============================================

-- ============================================
-- 1. ADD LSQ FIELDS TO PATIENT_THREADS
-- ============================================

-- LeadSquared lead ID for deduplication
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_lead_id VARCHAR(100);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_prospect_auto_id VARCHAR(20);

-- Contact info (from LSQ lead)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(30);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS email VARCHAR(200);

-- Demographics (from LSQ lead)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Address (from LSQ lead)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS zip VARCHAR(20);

-- Clinical (enriched from LSQ activities)
-- primary_diagnosis already exists in patient_threads
-- planned_procedure already exists in patient_threads
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS ailment VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS doctor_name VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS hospital_location VARCHAR(200);

-- Financial (from LSQ lead)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS surgery_order_value NUMERIC(12,2);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS financial_category VARCHAR(20);

-- Marketing attribution (from LSQ lead)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(500);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS signup_url TEXT;

-- LSQ metadata
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_owner_name VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_owner_email VARCHAR(200);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_lead_stage VARCHAR(50);
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_created_on TIMESTAMPTZ;
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_last_synced_at TIMESTAMPTZ;

-- Archive support (soft delete)
ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_threads_lsq_lead_id
  ON patient_threads(lsq_lead_id) WHERE lsq_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_phone
  ON patient_threads(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_threads_lsq_stage
  ON patient_threads(lsq_lead_stage) WHERE lsq_lead_stage IS NOT NULL;

-- ============================================
-- 2. LSQ SYNC LOG
-- Tracks each sync run for observability
-- and deduplication.
-- ============================================

CREATE TABLE IF NOT EXISTS lsq_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sync run info
  sync_type VARCHAR(20) NOT NULL
    CHECK (sync_type IN ('webhook', 'poll', 'manual')),
  trigger_stage VARCHAR(50),              -- 'OPD WIN', 'IPD WIN', etc.

  -- Results
  leads_found INTEGER NOT NULL DEFAULT 0,
  leads_created INTEGER NOT NULL DEFAULT 0,
  leads_updated INTEGER NOT NULL DEFAULT 0,
  leads_skipped INTEGER NOT NULL DEFAULT 0,
  errors JSONB,                           -- Array of error messages

  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lsq_sync_log_type ON lsq_sync_log(sync_type, started_at DESC);

-- ============================================
-- 3. LSQ ACTIVITY CACHE
-- Stores enriched activity data extracted
-- from LSQ activity history for each lead.
-- ============================================

CREATE TABLE IF NOT EXISTS lsq_activity_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
  lsq_lead_id VARCHAR(100) NOT NULL,

  -- Activity data
  activity_type VARCHAR(100),             -- EventName from LSQ
  activity_event_code INTEGER,
  activity_data JSONB,                    -- Raw Data array from LSQ
  activity_date TIMESTAMPTZ,

  -- Metadata
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lsq_activity_cache_patient ON lsq_activity_cache(patient_thread_id);
CREATE INDEX IF NOT EXISTS idx_lsq_activity_cache_lead ON lsq_activity_cache(lsq_lead_id);

-- ============================================
-- 4. LSQ API CALL LOG
-- Records every HTTP request/response to LSQ
-- for full traceability from the admin panel.
-- ============================================

CREATE TABLE IF NOT EXISTS lsq_api_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request
  endpoint VARCHAR(200) NOT NULL,
  method VARCHAR(10) NOT NULL DEFAULT 'GET',
  request_body JSONB,

  -- Response
  response_status INTEGER NOT NULL DEFAULT 0,
  response_body JSONB,
  error_message TEXT,

  -- Timing
  duration_ms INTEGER NOT NULL DEFAULT 0,

  -- Links
  sync_run_id UUID REFERENCES lsq_sync_log(id) ON DELETE SET NULL,
  lead_id VARCHAR(100),
  call_type VARCHAR(30) NOT NULL DEFAULT 'other'
    CHECK (call_type IN ('get_lead', 'search_leads', 'get_activities', 'webhook_receive', 'other')),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lsq_api_log_sync_run ON lsq_api_log(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_lsq_api_log_created ON lsq_api_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lsq_api_log_errors ON lsq_api_log(created_at DESC)
  WHERE response_status >= 400 OR error_message IS NOT NULL;

-- ============================================
-- MIGRATION RECORD
-- ============================================

INSERT INTO _migrations (name) VALUES ('lsq-integration-v1')
ON CONFLICT (name) DO NOTHING;
