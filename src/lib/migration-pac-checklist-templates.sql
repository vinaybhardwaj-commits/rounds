-- =============================================================================
-- PAC Coordinator Workspace v1 — PCW.0 migration #6 (lookup + seed)
-- PRD: Daily Dash EHRC/PAC-COORDINATOR-WORKSPACE-PRD.md (v1.0 LOCKED 29 Apr 2026)
-- SOP: EHRC/SOP/OT/001 v5.0 §9 (Documentation Requirements) + §6.4 (NPO)
--
-- Mode-specific checklist templates (D8). One row per mode. items_json is an
-- array of { id, label, required, gating_condition?, sop_ref? }. PCW.3 wires
-- workspace creation to seed pac_workspace_progress.checklist_state from the
-- matching template.
--
-- gating_condition values:
--   "day_of_surgery"  — checkbox grayed out until planned_surgery_date == TODAY
--   null              — always checkable
--
-- Idempotent. Rollback: DROP TABLE pac_checklist_templates;
-- =============================================================================

CREATE TABLE IF NOT EXISTS pac_checklist_templates (
  code         TEXT PRIMARY KEY,
  pac_mode     TEXT NOT NULL CHECK (pac_mode IN (
                 'in_person_opd', 'bedside', 'telephonic', 'paper_screening'
               )),
  items_json   JSONB NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  hospital_id  UUID REFERENCES hospitals(id)
);

CREATE INDEX IF NOT EXISTS idx_pac_checklist_templates_active
  ON pac_checklist_templates (pac_mode, active)
  WHERE active = TRUE;

COMMENT ON TABLE pac_checklist_templates IS
  'PAC Coordinator Workspace v1 — mode-specific checklist templates. SOP §9 documentation requirements + §6.4 NPO baked in.';

-- =============================================================================
-- Seed: 4 templates, one per PAC mode.
-- =============================================================================

INSERT INTO pac_checklist_templates (code, pac_mode, items_json) VALUES
('in_person_opd_v1', 'in_person_opd', '[
  {"id":"allergy_history",        "label":"Allergy history confirmed",                              "required":true},
  {"id":"current_medications",    "label":"Current medications captured",                           "required":true},
  {"id":"consent_generated",      "label":"Consent form generated",                                 "required":true,  "sop_ref":"§9 Pre-Op Verification"},
  {"id":"baseline_vitals",        "label":"Baseline vitals (BP, HR, SpO2, temp)",                   "required":true},
  {"id":"height_weight_bmi",      "label":"Height / weight / BMI documented",                       "required":true},
  {"id":"asa_classification",     "label":"ASA classification documented (anaesthetist)",           "required":true,  "sop_ref":"§6.2"},
  {"id":"airway_mallampati",      "label":"Airway exam (Mallampati grade) (anaesthetist)",          "required":true,  "sop_ref":"§9 PAC"},
  {"id":"counselled_anaesthesia", "label":"Counselled patient on anaesthesia mode",                 "required":true},
  {"id":"npo_time_set",           "label":"NPO time set per SOP §6.4",                              "required":true,  "sop_ref":"§6.4"},
  {"id":"hair_shaved",            "label":"Hair shaved at site",                                    "required":false, "gating_condition":"day_of_surgery"},
  {"id":"preop_meds_dispensed",   "label":"Pre-op meds dispensed",                                  "required":false},
  {"id":"fasting_verified_dos",   "label":"Fasting verified day-of-surgery",                        "required":true,  "gating_condition":"day_of_surgery", "sop_ref":"§6.4"}
]'::jsonb),

('bedside_v1', 'bedside', '[
  {"id":"allergy_history",        "label":"Allergy history confirmed",                              "required":true},
  {"id":"current_medications",    "label":"Current medications captured",                           "required":true},
  {"id":"consent_generated",      "label":"Consent form signed at bedside",                         "required":true},
  {"id":"baseline_vitals",        "label":"Baseline vitals (BP, HR, SpO2, temp)",                   "required":true},
  {"id":"asa_classification",     "label":"ASA classification documented (anaesthetist)",           "required":true,  "sop_ref":"§6.2"},
  {"id":"airway_mallampati",      "label":"Airway exam (Mallampati grade) (anaesthetist)",          "required":true},
  {"id":"bed_allotted",           "label":"Bed allotted",                                           "required":true},
  {"id":"ward_nurse_handover",    "label":"Ward nurse handover received",                           "required":true},
  {"id":"charts_at_bedside",      "label":"Patient chart + reports at bedside",                     "required":true},
  {"id":"iv_cannula_18g",         "label":"IV cannula 18G (major cases) / 20G (minor)",             "required":false, "sop_ref":"§9 Pre-Op Verification"}
]'::jsonb),

('telephonic_v1', 'telephonic', '[
  {"id":"identity_verified",      "label":"Patient identity verified by phone",                     "required":true},
  {"id":"reports_received",       "label":"Reports received digitally",                             "required":true},
  {"id":"allergies_verbal",       "label":"Allergies confirmed verbally",                           "required":true},
  {"id":"medications_verbal",     "label":"Medications confirmed verbally",                         "required":true},
  {"id":"consent_at_admission",   "label":"Consent will be signed at admission",                    "required":true},
  {"id":"npo_instructions",       "label":"NPO instructions given per SOP §6.4",                    "required":true,  "sop_ref":"§6.4"},
  {"id":"reporting_time",         "label":"Reporting time confirmed",                               "required":true},
  {"id":"escalation_contact",     "label":"Escalation contact noted",                               "required":false}
]'::jsonb),

('paper_screening_v1', 'paper_screening', '[
  {"id":"screening_form",         "label":"Screening form completed",                               "required":true},
  {"id":"identity_verified",      "label":"Patient identity verified",                              "required":true},
  {"id":"allergies_verified",     "label":"Allergies confirmed",                                    "required":true},
  {"id":"medications_verified",   "label":"Medications confirmed",                                  "required":true},
  {"id":"npo_instructions",       "label":"NPO instructions given per SOP §6.4",                    "required":true,  "sop_ref":"§6.4"},
  {"id":"anaesthetist_signoff",   "label":"Anaesthetist signoff received",                          "required":true,  "sop_ref":"§4.3"}
]'::jsonb)

ON CONFLICT (code) DO NOTHING;
