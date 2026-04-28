-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #4 (lookup + seed)
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 §6.2 (ASA-driven workup grid)
--
-- Lookup table for available pac_orders.order_type codes.
-- sop_default_for_asa is an INT[] of ASA classes (1-5) for which this order
-- is auto-suggested per SOP §6.2. Auto-suggest engine in PCW.2 reads this.
--
-- Idempotent — INSERT ... ON CONFLICT DO NOTHING for seed rows.
-- Rollback: DROP TABLE pac_order_types;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_order_types (
  code                  TEXT PRIMARY KEY,
  label                 TEXT NOT NULL,
  category              TEXT,
  sop_default_for_asa   INT[],
  sop_default_for_mode  TEXT[],
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  hospital_id           UUID REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_pac_order_types_active
  ON pac_order_types (active, category)
  WHERE active = TRUE;

COMMENT ON TABLE pac_order_types IS
  'PAC Coordinator Workspace v1 — lookup of order types. SOP §6.2 ASA defaults baked into sop_default_for_asa array.';

-- =============================================================================
-- Seed rows — SOP §6.2 ASA grid encoded.
-- ASA 1 baseline: CBC, RFT, TSH, RBS/HbA1c, Coag, Serology, ECG (regional/spinal)
--                 + Chest XR PA (GA only)
-- ASA 2 adds:    Lipid profile, Urine R/M, 2D ECHO
-- ASA 3 adds:    ABG (+ optional dobutamine stress, CT thorax for major)
-- =============================================================================

INSERT INTO pac_order_types (code, label, category, sop_default_for_asa, sop_default_for_mode) VALUES
  ('cbc',                'Complete Blood Count (CBC)',                     'haematology', ARRAY[1,2,3], NULL),
  ('coag_pt_aptt_inr',   'Coagulation (PT/aPTT/INR)',                      'haematology', ARRAY[1,2,3], NULL),
  ('gxm',                'Group & Cross-Match (GXM)',                      'haematology', ARRAY[1,2,3], NULL),
  ('d_dimer',            'D-Dimer',                                        'haematology', NULL,         NULL),
  ('rft',                'Renal Function Test (RFT - BUN/Cr/Na/K)',        'biochem',     ARRAY[1,2,3], NULL),
  ('lft',                'Liver Function Test (LFT)',                      'biochem',     ARRAY[1,2,3], NULL),
  ('lipid_profile',      'Lipid Profile',                                  'biochem',     ARRAY[2,3],   NULL),
  ('abg',                'Arterial Blood Gas (ABG)',                       'biochem',     ARRAY[3],     NULL),
  ('urine_rm',           'Urine Routine + Microscopy',                     'biochem',     ARRAY[2,3],   NULL),
  ('electrolytes_extra', 'Extended Electrolytes (Ca/Mg/Cl)',               'biochem',     NULL,         NULL),
  ('tft',                'Thyroid Function (TSH)',                         'endocrine',   ARRAY[1,2,3], NULL),
  ('rbs',                'Random Blood Sugar (RBS)',                       'endocrine',   ARRAY[1,2,3], NULL),
  ('hba1c',              'Glycated Haemoglobin (HbA1c)',                   'endocrine',   ARRAY[1,2,3], NULL),
  ('fbs',                'Fasting Blood Sugar (FBS)',                      'endocrine',   NULL,         NULL),
  ('serology_bundle',    'Serology Bundle (HBsAg / anti-HCV / HIV rapid)', 'serology',    ARRAY[1,2,3], NULL),
  ('ecg',                'Electrocardiogram (ECG)',                        'cardiology',  ARRAY[1,2,3], NULL),
  ('echo_2d',            '2D Echocardiogram',                              'cardiology',  ARRAY[2,3],   NULL),
  ('stress_echo',        'Dobutamine Stress Echo',                         'cardiology',  ARRAY[3],     NULL),
  ('chest_xr_pa',        'Chest X-Ray (PA view)',                          'imaging',     ARRAY[1,2,3], ARRAY['general_anaesthesia']),
  ('ct_thorax_plain',    'CT Thorax (plain)',                              'imaging',     ARRAY[3],     NULL),
  ('usg_abdomen',        'USG Abdomen',                                    'imaging',     NULL,         NULL),
  ('pregnancy_test',     'Pregnancy Test (beta-hCG)',                      'other',       NULL,         NULL),
  ('covid_pcr',          'COVID PCR',                                      'other',       NULL,         NULL),
  ('blood_group_verify', 'Blood Group Verification (transfer-independent)', 'haematology', NULL, NULL),
  ('cardio_consult',     'Cardiology Consultation Referral',               'other',       NULL,         NULL),
  ('pulm_consult',       'Pulmonology Consultation Referral',              'other',       NULL,         NULL),
  ('endo_consult',       'Endocrinology Consultation Referral',            'other',       NULL,         NULL),
  ('nephro_consult',     'Nephrology Consultation Referral',               'other',       NULL,         NULL),
  ('haem_consult',       'Haematology Consultation Referral',              'other',       NULL,         NULL),
  ('dental_clearance',   'Dental Clearance',                               'other',       NULL,         NULL)
ON CONFLICT (code) DO NOTHING;
