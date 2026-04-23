-- =============================================================================
-- Sprint 1 Day 2 — PAC condition library + per-case condition cards
-- =============================================================================
-- Includes 12-row seed derived from EHRC PreOp Assessment SOP V5 §6.3
-- "Comorbidities- criteria for optimum control and Day Of Surgery Cut Off".
--
-- The PRD reference to "15 conditions" was approximate; the SOP §6.3 table
-- contains exactly 12 comorbidities. We seed those 12 faithfully. Additional
-- cards can be added later via admin UI (super_admin only, per decision 13 in
-- PRD §10).
--
-- Tables:
--   • pac_condition_library  — universal catalog (no hospital_id per PRD §3.3)
--   • condition_cards        — per-case instances; library_code XOR custom_label
--
-- Decision D8 (Conditions Approach 3): structured library of cards + optional
-- per-card free-text note. Custom cards only via explicit "Custom" option.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. pac_condition_library — the catalog
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pac_condition_library (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable semantic code used by condition_cards to link back (case-insensitive
  -- snake_case, e.g. 'bp_optimization', 'smoking_cessation').
  code                TEXT NOT NULL UNIQUE,
  label               TEXT NOT NULL,
  description         TEXT,
  -- Role most commonly responsible for driving this card to done (hint for UI).
  default_owner_role  TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcl_active_order
  ON pac_condition_library(is_active, sort_order)
  WHERE is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 2. condition_cards — per-case instances
-- -----------------------------------------------------------------------------
-- Each card is EITHER linked to a library entry (library_code) OR is a custom
-- one-off (custom_label). Enforced via CHECK below.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS condition_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES surgical_cases(id) ON DELETE CASCADE,
  -- FK by code (not id) so library rows can be safely reseeded without
  -- breaking historic cards, as long as the code stays stable.
  library_code        TEXT REFERENCES pac_condition_library(code),
  custom_label        TEXT,
  -- Exactly one of (library_code, custom_label) must be set.
  CONSTRAINT cc_library_xor_custom CHECK (
    (library_code IS NOT NULL AND custom_label IS NULL) OR
    (library_code IS NULL     AND custom_label IS NOT NULL)
  ),
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'done', 'waived')),
  note                TEXT,
  owner_profile_id    UUID REFERENCES profiles(id),
  completed_at        TIMESTAMPTZ,
  completed_by        UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_case_status
  ON condition_cards(case_id, status);

CREATE INDEX IF NOT EXISTS idx_cc_library
  ON condition_cards(library_code)
  WHERE library_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Seed — 12 comorbidities from SOP V5 §6.3
-- -----------------------------------------------------------------------------
-- default_owner_role is a hint for which specialist/role typically drives the
-- card to done. Not an enforced FK; free-text so it can evolve as role model
-- matures. Sort_order follows the SOP table order (§6.3) to keep the UI
-- consistent with what clinicians already scan in print.
-- -----------------------------------------------------------------------------
INSERT INTO pac_condition_library (code, label, description, default_owner_role, sort_order)
VALUES
  ('diabetes', 'Diabetes',
   'HbA1c<8% and RBS<180 for optimum control. If HbA1c>8%, physician/endocrinology referral. RBS>216 triggers VRIII + escalation on day of surgery.',
   'physician', 10),
  ('hypertension', 'Hypertension',
   'BP optimisation documented. Physician review. ECG + 2D Echo if not done in 6 months. ASA2: BP<150/100. ASA3: BP>150/90 on 2 readings → defer. Continue antihypertensives with sip of water.',
   'physician', 20),
  ('cardiac_disease', 'Cardiac disease / new ECG changes',
   'Cardiology consultation mandatory. Documented clearance with risk stratification. 2D Echo within 6 months. Dobutamine stress echo for major procedures per cardiologist. Recent MI/CVA <1 month: ASA 4. EF <25%: ASA 4.',
   'cardiologist', 30),
  ('renal_impairment', 'Renal impairment',
   'Nephrology consultation. Fluid management plan. Electrolyte correction. eGFR<60 flag. eGFR<30 mandatory nephrology referral. K+ range 3.0–6.0 mmol/L. ESRD: ASA 3 minimum.',
   'nephrologist', 40),
  ('hypothyroidism', 'Hypothyroidism',
   'TFT mandatory. Physician review if TSH elevated. ASA2: TSH<5. ASA3: TSH>5 → optimise before elective surgery.',
   'physician', 50),
  ('obesity', 'Obesity',
   'Airway assessment (Mallampati, neck circumference). OSA screening if BMI>35. Positioning plan documented. BMI>30: ASA 2 min. BMI>35 + OSA: ASA 3. GLP-1 agonist users: 8–10 hr NPO.',
   'anaesthetist', 60),
  ('anaemia', 'Anaemia',
   'Identify cause. Iron studies. Transfusion if Hb critically low. Surgeon + anaesthetist joint decision on timing. Hb<8 g/dL: ASA 3 → defer elective, optimise/transfuse. Hb<7 g/dL: transfuse before proceeding.',
   'physician', 70),
  ('respiratory_disease', 'Respiratory disease (asthma / COPD / OSA)',
   'Pulmonology referral if active/unstable. ABG for ASA 3. CT Thorax plain if recent pneumonia or ongoing wheeze. SpO2<94% further investigation. SpO2<90% mandatory ABG, consider deferral. Active wheeze/URTI: ASA 3, may defer.',
   'pulmonologist', 80),
  ('active_infection', 'Active infection / Fever >38°C',
   'Source identification. Cultures sent. Antibiotic plan. Joint surgeon-anaesthetist decision. Resolved >1 week: ASA 2. Ongoing: ASA 3, may defer. Elective: defer until afebrile 48 hrs.',
   'rmo', 90),
  ('anticoagulant_therapy', 'Anticoagulant / antiplatelet therapy',
   'Haematology / physician guidance on bridging / cessation. INR/PT documented. Neuraxial safety assessment mandatory. ASA3 if not stopped → defer. INR>1.5: defer major. INR>1.4: defer neuraxial.',
   'haematologist', 100),
  ('smoking_alcohol', 'Smoking / Alcohol',
   'Document habit and cessation status. Counsel on perioperative risk. ASA 2: cessation ≥3 days (both). ASA 3: not stopped.',
   'rmo', 110),
  ('coagulopathy', 'Coagulopathy / bleeding disorder',
   'Haematology referral. Detailed coagulation workup. Factor replacement plan if needed. Platelets<50×10⁹/L: defer, transfuse. Platelets<80×10⁹/L: defer epidural.',
   'haematologist', 120)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO _migrations (name)
SELECT 'sprint1-condition-library'
WHERE NOT EXISTS (
  SELECT 1 FROM _migrations WHERE name = 'sprint1-condition-library'
);
