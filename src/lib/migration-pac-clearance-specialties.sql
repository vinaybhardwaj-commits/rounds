-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #5 (lookup + seed)
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 §6.3 (Comorbidity → Specialist mapping)
--
-- Lookup table for available pac_clearances.specialty codes.
-- sop_trigger_comorbidities is a TEXT[] of comorbidity flags — when a case's
-- intake form has any matching flag, the auto-suggest engine recommends this
-- clearance. Comorbidity flag taxonomy matches Marketing Handoff form's
-- comorbidities[] field (PCW.3 wires the field-mapping).
--
-- Idempotent. Rollback: DROP TABLE pac_clearance_specialties;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_clearance_specialties (
  code                       TEXT PRIMARY KEY,
  label                      TEXT NOT NULL,
  default_assignee_role      TEXT NOT NULL DEFAULT 'specialist',
  sop_trigger_comorbidities  TEXT[],
  active                     BOOLEAN NOT NULL DEFAULT TRUE,
  hospital_id                UUID REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_pac_clearance_specialties_active
  ON pac_clearance_specialties (active)
  WHERE active = TRUE;

COMMENT ON TABLE pac_clearance_specialties IS
  'PAC Coordinator Workspace v1 — lookup of clearance specialties. SOP §6.3 comorbidity-trigger arrays drive auto-suggest engine.';

INSERT INTO pac_clearance_specialties (code, label, default_assignee_role, sop_trigger_comorbidities) VALUES
  ('cardiology',       'Cardiology',       'specialist',
     ARRAY['cardiac_disease','recent_mi','angina','hypertension_uncontrolled','ecg_changes','heart_failure','arrhythmia','valvular_disease']),
  ('pulmonology',      'Pulmonology',      'specialist',
     ARRAY['asthma','copd','osa','recent_pneumonia','active_wheeze','spo2_low','urti_active','tuberculosis_history']),
  ('endocrinology',    'Endocrinology',    'specialist',
     ARRAY['diabetes_uncontrolled','hba1c_high','thyroid_uncontrolled','tsh_elevated','adrenal_insufficiency','pheochromocytoma']),
  ('nephrology',       'Nephrology',       'specialist',
     ARRAY['ckd','esrd','egfr_low','dialysis','renal_transplant']),
  ('neurology',        'Neurology',        'specialist',
     ARRAY['recent_cva','seizure_disorder','parkinsons','myasthenia','multiple_sclerosis']),
  ('gastroenterology', 'Gastroenterology', 'specialist',
     ARRAY['cirrhosis','liver_disease','gi_bleed_recent','inflammatory_bowel']),
  ('haematology',      'Haematology',      'specialist',
     ARRAY['anaemia_severe','coagulopathy','thrombocytopenia','anticoagulant_active','sickle_cell','haemophilia']),
  ('dental',           'Dental',           'specialist',
     ARRAY['dental_infection_active','prosthetic_valve','recent_dental_work']),
  ('orthopaedics',     'Orthopaedics',     'specialist',
     ARRAY['cervical_spine_instability','lumbar_disease_severe'])
ON CONFLICT (code) DO NOTHING;
