-- ============================================
-- WhatsApp Analysis Engine — Database Migration
-- Phase: WA.1 (Foundation)
-- Date: 6 April 2026
-- Tables: 7 new tables, 0 existing tables modified
-- ============================================

-- 1. wa_rubric — Live rubric (one row per department + one for global issues)
CREATE TABLE IF NOT EXISTS wa_rubric (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  global_issues JSONB,
  sender_authority JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. wa_analyses — One row per analysis run
CREATE TABLE IF NOT EXISTS wa_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  source_filename TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'whatsapp',
  source_group TEXT,
  channel_message_id TEXT,
  analysis_message_id TEXT,
  total_messages_parsed INTEGER NOT NULL DEFAULT 0,
  new_messages_processed INTEGER NOT NULL DEFAULT 0,
  duplicate_messages_skipped INTEGER NOT NULL DEFAULT 0,
  departments_with_data TEXT[] DEFAULT '{}',
  date_range_start DATE,
  date_range_end DATE,
  processing_time_ms INTEGER,
  llm_calls_made INTEGER DEFAULT 0,
  llm_tokens_used INTEGER DEFAULT 0,
  model_used TEXT DEFAULT 'qwen2.5:14b',
  status TEXT NOT NULL DEFAULT 'processing',
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wa_analyses_status ON wa_analyses(status);
CREATE INDEX IF NOT EXISTS idx_wa_analyses_created ON wa_analyses(created_at DESC);

-- 3. wa_rubric_versions — Audit trail of rubric changes
CREATE TABLE IF NOT EXISTS wa_rubric_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id UUID NOT NULL REFERENCES wa_rubric(id),
  version INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  change_detail JSONB NOT NULL,
  proposal_id UUID,
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_rubric_versions_rubric ON wa_rubric_versions(rubric_id);

-- 4. wa_rubric_proposals — LLM-suggested rubric improvements
CREATE TABLE IF NOT EXISTS wa_rubric_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES wa_analyses(id),
  rubric_id UUID NOT NULL REFERENCES wa_rubric(id),
  proposal_type TEXT NOT NULL,
  proposal_detail JSONB NOT NULL,
  evidence JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_rubric_proposals_status ON wa_rubric_proposals(status);
CREATE INDEX IF NOT EXISTS idx_wa_rubric_proposals_analysis ON wa_rubric_proposals(analysis_id);

-- 5. wa_extracted_points — Individual data points extracted
CREATE TABLE IF NOT EXISTS wa_extracted_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES wa_analyses(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value_text TEXT,
  value_numeric NUMERIC,
  data_date DATE NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source_group TEXT NOT NULL,
  source_sender TEXT NOT NULL,
  source_time TEXT NOT NULL,
  source_message_hash TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_extracted_dept_date ON wa_extracted_points(department_slug, data_date);
CREATE INDEX IF NOT EXISTS idx_wa_extracted_analysis ON wa_extracted_points(analysis_id);

-- 6. wa_global_flags — Red/amber issue flags per analysis
CREATE TABLE IF NOT EXISTS wa_global_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES wa_analyses(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL,
  issue_label TEXT NOT NULL,
  severity TEXT NOT NULL,
  details TEXT NOT NULL,
  data_date DATE NOT NULL,
  source_group TEXT NOT NULL,
  source_sender TEXT NOT NULL,
  source_time TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_global_flags_analysis ON wa_global_flags(analysis_id);
CREATE INDEX IF NOT EXISTS idx_wa_global_flags_severity ON wa_global_flags(severity);

-- 7. wa_message_hashes — Deduplication registry
CREATE TABLE IF NOT EXISTS wa_message_hashes (
  hash TEXT PRIMARY KEY,
  source_group TEXT NOT NULL,
  source_sender TEXT NOT NULL,
  message_timestamp TIMESTAMPTZ NOT NULL,
  first_analysis_id UUID NOT NULL REFERENCES wa_analyses(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_hashes_group ON wa_message_hashes(source_group);
CREATE INDEX IF NOT EXISTS idx_wa_hashes_timestamp ON wa_message_hashes(message_timestamp);

-- Auto-update updated_at trigger for wa_rubric
CREATE OR REPLACE FUNCTION update_wa_rubric_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wa_rubric_updated_at ON wa_rubric;
CREATE TRIGGER trg_wa_rubric_updated_at
  BEFORE UPDATE ON wa_rubric
  FOR EACH ROW
  EXECUTE FUNCTION update_wa_rubric_updated_at();
