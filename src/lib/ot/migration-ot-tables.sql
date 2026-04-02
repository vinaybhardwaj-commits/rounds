-- OT Surgery Readiness — Migration
-- 4 new tables: surgery_postings, ot_readiness_items, ot_readiness_audit_log, ot_equipment_items
-- Execute via /api/admin/migrate (one statement at a time)

-- 1. surgery_postings
CREATE TABLE IF NOT EXISTS surgery_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name VARCHAR(255) NOT NULL,
  patient_thread_id UUID REFERENCES patient_threads(id),
  uhid VARCHAR(50),
  ip_number VARCHAR(50),
  age INTEGER,
  gender VARCHAR(10),
  procedure_name VARCHAR(500) NOT NULL,
  procedure_side VARCHAR(20) NOT NULL,
  case_type VARCHAR(20) NOT NULL DEFAULT 'Elective',
  wound_class VARCHAR(20),
  case_complexity VARCHAR(20),
  estimated_duration_minutes INTEGER,
  anaesthesia_type VARCHAR(20),
  implant_required BOOLEAN DEFAULT false,
  blood_required BOOLEAN DEFAULT false,
  is_insured BOOLEAN DEFAULT false,
  asa_score INTEGER,
  asa_confirmed_by UUID REFERENCES profiles(id),
  asa_confirmed_at TIMESTAMPTZ,
  pac_notes TEXT,
  is_high_risk BOOLEAN DEFAULT false,
  primary_surgeon_name VARCHAR(255) NOT NULL,
  primary_surgeon_id UUID REFERENCES profiles(id),
  assistant_surgeon_name VARCHAR(255),
  anaesthesiologist_name VARCHAR(255) NOT NULL,
  anaesthesiologist_id UUID REFERENCES profiles(id),
  scrub_nurse_name VARCHAR(255),
  circulating_nurse_name VARCHAR(255),
  ot_technician_name VARCHAR(255),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  ot_room INTEGER NOT NULL,
  slot_order INTEGER,
  post_op_destination VARCHAR(20) NOT NULL DEFAULT 'PACU',
  icu_bed_required BOOLEAN DEFAULT false,
  overall_readiness VARCHAR(20) NOT NULL DEFAULT 'not_ready',
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  cancellation_reason TEXT,
  postponed_to DATE,
  posted_by UUID NOT NULL REFERENCES profiles(id),
  posted_via VARCHAR(20) DEFAULT 'wizard',
  getstream_message_id VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ot_readiness_items
CREATE TABLE IF NOT EXISTS ot_readiness_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,
  item_key VARCHAR(80) NOT NULL,
  item_label VARCHAR(255) NOT NULL,
  item_category VARCHAR(30) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_dynamic BOOLEAN DEFAULT false,
  responsible_role VARCHAR(50) NOT NULL,
  responsible_user_id UUID REFERENCES profiles(id),
  responsible_user_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  status_detail VARCHAR(500),
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_by_name VARCHAR(255),
  confirmed_at TIMESTAMPTZ,
  confirmation_notes TEXT,
  asa_score_given INTEGER,
  due_by TIMESTAMPTZ,
  escalated BOOLEAN NOT NULL DEFAULT false,
  escalated_at TIMESTAMPTZ,
  escalated_to UUID REFERENCES profiles(id),
  escalation_level INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(surgery_posting_id, item_key)
);

-- 3. ot_readiness_audit_log
CREATE TABLE IF NOT EXISTS ot_readiness_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  readiness_item_id UUID NOT NULL REFERENCES ot_readiness_items(id),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id),
  action VARCHAR(30) NOT NULL,
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  detail TEXT,
  performed_by UUID NOT NULL REFERENCES profiles(id),
  performed_by_name VARCHAR(255),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. ot_equipment_items
CREATE TABLE IF NOT EXISTS ot_equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,
  readiness_item_id UUID REFERENCES ot_readiness_items(id),
  item_type VARCHAR(30) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT,
  quantity INTEGER DEFAULT 1,
  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(255),
  is_rental BOOLEAN DEFAULT false,
  rental_cost_estimate NUMERIC(10,2),
  status VARCHAR(30) NOT NULL DEFAULT 'requested',
  delivery_eta TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  status_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
