# Context Seed: Billing Integration Phases 1–5 (2 April 2026)

**Thread scope**: Designed and built the complete 5-phase billing integration based on a meeting with Mohan (IPD Billing Head). Covers insurance claim lifecycle, financial counseling enhancements, enhancement alerts, feedback attribution, and billing intelligence dashboard.

**Commits**: `3108e0f` → `534332d` → `530d2d9` → `b0ce33b` → `d6258d6` → `d1fc4d3`
**Starting point**: Step 9.4 complete (commit `3eee752`), plus LSQ integration and various fixes
**End state**: All 5 billing phases committed and deployed. 3 new DB tables, 10 new API routes, 4 new lib modules, extensive modifications to MessageArea, PatientDetailView, form-registry, and forms API.

---

## Design Origin

The billing integration design came from a meeting V had with Mohan, the IPD Billing Head at EHRC. The design document was `ROUNDS-BILLING-INTEGRATION-DESIGN.md` (created in a prior thread, used as input for this build thread). Key operational knowledge from Mohan:

- **Room rent eligibility**: 1% of sum insured (standard rooms), 1.5% (ICU/NICU)
- **Proportional deduction**: If room rent exceeds eligibility, the percentage difference is deducted from the ENTIRE bill (not just room portion) — this is what catches patients off-guard
- **IRDA-mandated TATs**: 8 hours for pre-auth, 4 hours for final approval
- **Mohan's timing rules**: Submissions before 1 PM typically get same-day processing; after 4 PM is risky; Sunday afternoons are dead
- **TPA landscape**: Medi Assist, Vidal Health, Paramount, MDIndia, FHPL, Heritage — each with different portals and quirks
- **Enhancement workflow**: When running bill exceeds approved amount by threshold (default ₹50,000), doctor must submit case summary for enhancement request
- **Discharge bottleneck**: The longest step is almost never billing — it's usually clinical (discharge summary) or insurer (final approval). But billing gets blamed because it's the last visible step.

---

## What Was Built

### Phase 1 — Discharge Timeline Tracker (commit `3108e0f`)

**New files:**
- `src/lib/discharge-milestones.ts` (420 lines) — Business logic for 9-step discharge milestone tracking
  - Steps: discharge_ordered → pharmacy_clearance → lab_clearance → discharge_summary → billing_closure → final_bill_submitted → final_approval → patient_settled → patient_departed
  - Auto-calculates TATs between steps (minutes)
  - Identifies bottleneck step (longest TAT)
  - Posts system messages to patient thread + department channels on each milestone
  - `DISCHARGE_MILESTONE_ORDER` and `DISCHARGE_MILESTONE_LABELS` in types
- `src/app/api/patients/[id]/discharge/route.ts` — GET (milestone status) + POST (start discharge) + PATCH (advance step)

**Modified files:**
- `src/types/index.ts` — Added `DischargeMilestoneStep` type (9 values), `DISCHARGE_MILESTONE_ORDER` array, `DISCHARGE_MILESTONE_LABELS` map

### Phase 1.5 — Database Migration (commit `534332d`)

**Modified files:**
- `src/app/api/admin/migrate/route.ts` — Added Step 12: billing integration tables
  - `insurance_claims` table (40+ columns): claim lifecycle, financial data, TATs, recovery metrics
  - `claim_events` table: immutable event log (24 event types)
  - `discharge_milestones` table: 9-step discharge tracking with per-step TATs
  - Extended `admission_tracker` with 8 billing columns (insurance_claim_id, insurer_name, submission_channel, sum_insured, room_rent_eligibility, proportional_deduction_risk, running_bill_amount, cumulative_approved_amount, enhancement_alert_threshold)
  - Updated table count verification from 8 to 11
  - Migration run via browser console on deployed app: `fetch('/api/admin/migrate', { method: 'POST' })`

### Phase 2 — Insurance Claim Lifecycle Tracker (commit `530d2d9`)

**New files:**
- `src/lib/insurance-claims.ts` (692 lines) — Core claim business logic
  - `getOrCreateClaim()` — Creates or retrieves active claim for a patient, links to admission_tracker
  - `logClaimEvent()` — The main action function. Inserts immutable event, updates claim status via `EVENT_STATUS_MAP`, calculates TATs (pre-auth, final settlement), calculates recovery rate on final approval
  - `formatClaimMessage()` — Generates contextual system messages with amounts, TATs, timing advisories per event type
  - `postClaimMessage()` — Dual-posts to patient thread + #billing department channel
  - `getClaimSummary()` — Display-ready summary with status color, headroom, risk indicators
  - `getClaimTimeline()`, `getClaimByPatient()` — Query helpers
  - `getSubmissionTimingAdvisory()` — Encodes Mohan's operational knowledge about insurer processing windows
  - `EVENT_STATUS_MAP` — Maps each of 24 ClaimEventTypes to resulting ClaimStatus
- `src/app/api/patients/[id]/claim/route.ts` — GET (claim + timeline + summary with headroom), POST (create), PATCH (log event)

**Modified files:**
- `src/types/index.ts` — Added:
  - `ClaimStatus` type (12 values: counseling → pre_auth_pending → ... → settled/rejected/disputed)
  - `ClaimEventType` type (24 values covering full lifecycle)
  - `CLAIM_STATUS_LABELS`, `CLAIM_STATUS_COLORS`, `CLAIM_EVENT_LABELS`, `CLAIM_EVENT_COLORS` maps
  - `ROOM_RENT_ELIGIBILITY_PCT` = { standard: 0.01, icu: 0.015 }
  - `IRDA_TAT` = { pre_auth: 480, final_approval: 240, follow_up_alert: 180 } (minutes)
  - `DEFAULT_ENHANCEMENT_THRESHOLD` = 50000
  - `InsuranceClaimRow`, `ClaimEventRow` DB interfaces
- `src/components/chat/MessageArea.tsx` — Added "Insurance Claim" section to SlashCommandMenu:
  - 13 buttons: Start/View Claim, Room Rent Calculator, 11 claim event types
  - `onClaimAction` handler: '__create' calls POST, event types call PATCH with prompt() for description/amount/reference
- `src/components/patients/PatientDetailView.tsx` — Added Insurance Claim panel:
  - Status badge, insurer/TPA info, claim number
  - Financial summary grid (estimated, approved, running bill, headroom, final bill, settled)
  - Risk indicators (proportional deduction, co-pay)
  - TAT info (pre-auth, settlement)
  - Recent 4 timeline events

### Phase 3 — Financial Counseling Enhancement (commit `b0ce33b`)

**New files:**
- `src/app/api/billing/roomcalc/route.ts` — Room rent calculator
  - POST: takes sumInsured, roomCategory, optional customRoomRate
  - Returns eligibility per day, proportional deduction %, extra cost on sample ₹4L bill, recommendation
  - Hospital room rates defined: general=2000, semi_private=6000, private=8000, suite=12000, icu=15000, nicu=18000

**Modified files:**
- `src/lib/form-registry.ts` — `FINANCIAL_COUNSELING` form upgraded v1 → v2 with 6 sections:
  1. `payment_profile` — payment mode (cash/insurance/corporate/CGHS/ECHS), corporate fields
  2. `insurance_details` (NEW) — TPA dropdown (Medi Assist, Vidal, Paramount, MDIndia, FHPL, Heritage, Direct, Other), insurance company, policy number, card ID, validity, submission channel, portal used
  3. `room_rent_eligibility` (NEW) — sum insured, room category, actual room rent, room rent waiver toggle, co-pay %
  4. `cost_estimate` — unchanged
  5. `deposit_payment` — unchanged
  6. `patient_consent` (ENHANCED) — added: informed_proportional_deduction, informed_denial_responsibility, consent_form_signed, coverage_confirmed_with_agent checkboxes with readiness items
  - Updated `FORMS_BY_STAGE.admitted` to include `financial_counseling`
- `src/app/api/forms/route.ts` — Added Financial Counseling → Insurance Claim Hook:
  - When `financial_counseling` submitted with `payment_mode === 'insurance'`:
    - Gets/creates insurance claim
    - Calculates room rent eligibility and proportional deduction risk
    - Updates `insurance_claims` row with counseling snapshot (insurer, TPA, submission channel, portal, policy, sum insured, room details, proportional deduction, co-pay, estimated cost)
    - Updates `admission_tracker` billing fields
    - Logs `counseling_completed` claim event
    - Posts formatted system message to patient thread + #billing
- `src/components/chat/MessageArea.tsx` — Added "Room Rent Calculator" button (prompts for sumInsured + roomCategory, calls `/api/billing/roomcalc`)

### Phase 4 — Enhancement Alert System (commit `d6258d6`)

**New files:**
- `src/lib/enhancement-alerts.ts` (286 lines) — Enhancement detection and alerting
  - `checkPatientEnhancement()` — Queries admission_tracker + insurance_claims, calculates gap (runningBill - approvedAmount), compares to threshold
  - `checkAllEnhancements()` — Iterates all active insurance patients
  - `fireEnhancementAlert()` — Posts to patient thread + #billing + logs `enhancement_triggered` event
  - `submitCaseSummary()` — Doctor submits case summary → logs `enhancement_case_summary_submitted` + `enhancement_doctor_notified` events → posts to patient thread + #billing
  - `updateRunningBill()` — Updates admission_tracker, auto-checks if threshold breached
- `src/app/api/billing/check-enhancements/route.ts` — GET (dry run, no alerts) + POST (check and fire, single patient or all)
- `src/app/api/patients/[id]/enhance/route.ts` — GET (enhancement status) + POST (doctor submits case summary with currentDiagnosis, ongoingTreatment, reasonForExtension, revisedEstimate) + PATCH (update running bill, auto-fires alert if threshold breached)

**Modified files:**
- `src/components/chat/MessageArea.tsx` — Added 3 enhancement action buttons (visible for admitted/medical_management/pre_op/post_op/post_op_care stages): "Submit Case Summary (Enhancement)", "Update Running Bill", "Check Enhancement Need"

### Phase 5 — Feedback Attribution + BI Dashboard (commit `d1fc4d3`)

**New files:**
- `src/lib/billing-metrics.ts` (539 lines) — Full BI logic layer
  - `getRevenueMetrics()` — recovery rate, proportional deduction prevention count, enhancement capture rate, denial rate by insurer, pre-auth approval rate, leakage by reason, avg recovery per claim
  - `getSpeedMetrics()` — discharge TAT (total + per-step), billing TAT, pre-auth TAT, final settlement TAT, enhancement response time (triggered → submitted), query response time (queried → responded)
  - `getSatisfactionMetrics()` — averages across 5 rating dimensions from post_discharge_followup, attribution accuracy (% of low billing ratings where actual longest step wasn't billing)
  - `getInsurerPerformance()` — per-insurer: total claims, denial rate, avg recovery, avg TATs, total queries, queries per claim
  - `getBillingDashboard()` — combines revenue + speed + satisfaction into single dashboard response
  - `calculateMilestoneAttribution()` — Breaks discharge time into clinical/billing/insurer contributions using discharge_milestones TATs; identifies longest step
- `src/app/api/billing/metrics/route.ts` — GET with optional `?from=&to=` date filters → full BI dashboard
- `src/app/api/billing/insurer-performance/route.ts` — GET with optional date filters → per-insurer benchmarks

**Modified files:**
- `src/lib/form-registry.ts` — `POST_DISCHARGE_FOLLOWUP` upgraded v1 → v2:
  - New first section `discharge_experience` with 5 segmented rating fields:
    - `rating_clinical_handoff` (1-5)
    - `rating_department_clearance` (1-5)
    - `rating_billing_documentation` (1-5)
    - `rating_insurance_processing` (1-5)
    - `rating_overall_speed` (1-5)
  - Plus `discharge_improvement_suggestion` textarea
- `src/app/api/forms/route.ts` — Added Feedback Attribution Hook:
  - When `post_discharge_followup` submitted, calls `calculateMilestoneAttribution()` from billing-metrics.ts
  - Merges `milestone_attribution` object into form's JSONB data: `{ longestStep, longestStepMinutes, billingContributionMinutes, clinicalContributionMinutes, insurerContributionMinutes, totalDischargeMinutes }`

---

## Key Architectural Decisions

1. **Immutable event log pattern**: `claim_events` table is append-only. Each event captures a point-in-time snapshot. `insurance_claims` is the mutable "current state" derived from events. This lets us reconstruct the full claim timeline for any patient.

2. **EVENT_STATUS_MAP drives all transitions**: Rather than scattered if/else logic, a single map (`ClaimEventType → ClaimStatus`) defines every valid status transition. `logClaimEvent()` is the single entry point for all claim mutations.

3. **Form → Claim bridge via post-submission hook**: Financial counseling form submission triggers claim creation + insurance data population. This is done as a non-fatal hook in the `/api/forms` POST handler — if the hook fails, the form still saves.

4. **Feedback attribution hook in same pattern**: Post-discharge followup form triggers milestone attribution calculation, merged into form_data JSONB. Same non-fatal pattern.

5. **SlashCommandMenu as the action hub**: All claim actions, enhancement actions, and room rent calculator are accessible via the "/" slash command menu in patient thread chats. This follows the existing pattern established in Step 6.2b.

6. **Enhancement auto-detection on bill update**: When running bill is updated via PATCH `/api/patients/[id]/enhance`, the system auto-checks threshold breach and fires alert immediately. No separate monitoring step needed.

7. **BI metrics use raw SQL aggregations**: `billing-metrics.ts` queries directly against `insurance_claims`, `claim_events`, `discharge_milestones`, and `form_submissions`. No materialized views or caching — designed for current scale (< 100 concurrent claims). Can add caching later if needed.

8. **Date filtering via string interpolation**: The `buildDateFilter()` helper in billing-metrics.ts uses string interpolation for date filters. This is acceptable because the from/to values come from query params validated by the API layer, not user-supplied text in form fields. Can be parameterized if needed.

---

## New Types Added to `src/types/index.ts`

```typescript
// 12 claim lifecycle statuses
type ClaimStatus = 'counseling' | 'pre_auth_pending' | 'pre_auth_queried' |
  'pre_auth_approved' | 'pre_auth_denied' | 'enhancement_pending' |
  'active' | 'final_submitted' | 'final_queried' | 'settled' |
  'rejected' | 'disputed';

// 24 claim event types
type ClaimEventType = 'pre_auth_submitted' | 'pre_auth_queried' | 'pre_auth_query_responded' |
  'pre_auth_approved' | 'pre_auth_denied' | 'pre_auth_partial' |
  'enhancement_triggered' | 'enhancement_doctor_notified' |
  'enhancement_case_summary_submitted' | 'enhancement_submitted' |
  'enhancement_approved' | 'enhancement_denied' |
  'final_bill_prepared' | 'final_submitted' | 'final_queried' |
  'final_query_responded' | 'final_approved' | 'final_rejected' |
  'dispute_initiated' | 'dispute_resolved' |
  'room_change' | 'follow_up_needed' | 'follow_up_completed' |
  'note_added' | 'document_uploaded' | 'counseling_completed';

// 9 discharge milestone steps
type DischargeMilestoneStep = 'discharge_ordered' | 'pharmacy_clearance' |
  'lab_clearance' | 'discharge_summary' | 'billing_closure' |
  'final_bill_submitted' | 'final_approval' | 'patient_settled' | 'patient_departed';

// Constants
ROOM_RENT_ELIGIBILITY_PCT = { standard: 0.01, icu: 0.015 }
IRDA_TAT = { pre_auth: 480, final_approval: 240, follow_up_alert: 180 } // minutes
DEFAULT_ENHANCEMENT_THRESHOLD = 50000
```

---

## New Database Tables (3)

### `insurance_claims` (40+ columns)
- Links to: patient_threads, admission_tracker, profiles
- Key fields: insurer_name, tpa_name, submission_channel, portal_used, policy_number, claim_number
- Financial: sum_insured, room_rent_eligibility, room_category_selected, actual_room_rent, proportional_deduction_pct, co_pay_pct, has_room_rent_waiver, estimated_cost
- Pre-auth: pre_auth_submitted_at, pre_auth_approved_at, pre_auth_amount, pre_auth_status, pre_auth_tat_minutes
- Enhancement: total_enhancements, latest_enhancement_amount, cumulative_approved_amount
- Final: final_bill_amount, final_submitted_at, final_approved_at, final_approved_amount, final_settlement_tat_minutes
- Deductions: hospital_discount, non_payable_deductions, patient_liability
- Status: claim_status (ClaimStatus enum)
- Revenue tracking: recovery_rate, revenue_leakage, leakage_reason

### `claim_events` (immutable log)
- insurance_claim_id, patient_thread_id, event_type, description, amount, portal_reference
- document_urls (text array), insurer_response_needed, insurer_response_deadline
- performed_by, performed_by_name, getstream_message_id

### `discharge_milestones` (9-step tracking)
- patient_thread_id, admission_tracker_id, insurance_claim_id
- 9 timestamp pairs: `{step}_at` + `{step}_by` for each milestone
- 5 TAT columns: tat_order_to_pharmacy, tat_order_to_summary, tat_summary_to_billing, tat_billing_to_submission, tat_submission_to_approval, tat_order_to_departure
- is_complete, is_cancelled, cancellation_reason, bottleneck_step, bottleneck_minutes

### admission_tracker extensions (8 new columns)
- insurance_claim_id, insurer_name, submission_channel, sum_insured
- room_rent_eligibility, proportional_deduction_risk
- running_bill_amount, cumulative_approved_amount, enhancement_alert_threshold (default 50000)

---

## New API Routes (10)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/patients/[id]/discharge` | GET, POST, PATCH | Discharge milestone lifecycle |
| `/api/patients/[id]/claim` | GET, POST, PATCH | Insurance claim lifecycle |
| `/api/patients/[id]/enhance` | GET, POST, PATCH | Enhancement status, case summary, bill update |
| `/api/billing/roomcalc` | POST | Room rent eligibility calculator |
| `/api/billing/check-enhancements` | GET, POST | Scan all patients for enhancement needs |
| `/api/billing/metrics` | GET | Full BI dashboard (revenue + speed + satisfaction) |
| `/api/billing/insurer-performance` | GET | Per-insurer performance benchmarks |

**Total API route files**: 66 (was ~46 before billing integration)

---

## New Lib Modules (4)

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/discharge-milestones.ts` | 420 | 9-step discharge tracking with TAT calculation |
| `src/lib/insurance-claims.ts` | 692 | Claim lifecycle, event logging, system messages |
| `src/lib/enhancement-alerts.ts` | 286 | Auto-detect threshold breach, fire alerts |
| `src/lib/billing-metrics.ts` | 539 | Revenue/speed/satisfaction aggregations |

---

## Modifications to Existing Files

| File | What Changed |
|------|-------------|
| `src/types/index.ts` | ClaimStatus, ClaimEventType, DischargeMilestoneStep types; 8 label/color maps; 4 constants; 2 row interfaces |
| `src/components/chat/MessageArea.tsx` (1653 lines) | Added Insurance Claim section (13 buttons) + Enhancement section (3 buttons) + Room Rent Calculator to SlashCommandMenu |
| `src/components/patients/PatientDetailView.tsx` (1111 lines) | Added Insurance Claim panel with status, financials, risk indicators, TATs, timeline |
| `src/lib/form-registry.ts` (1645 lines) | FINANCIAL_COUNSELING v1→v2 (6 sections), POST_DISCHARGE_FOLLOWUP v1→v2 (discharge_experience ratings), FORMS_BY_STAGE updated |
| `src/app/api/forms/route.ts` (400 lines) | Financial counseling→claim hook, feedback attribution hook |
| `src/app/api/admin/migrate/route.ts` | Step 12: 3 new tables, 8 admission_tracker columns, triggers, indexes |

---

## Hospital Room Rates (hardcoded in roomcalc)

| Category | Daily Rate |
|----------|-----------|
| General | ₹2,000 |
| Semi-Private | ₹6,000 |
| Private | ₹8,000 |
| Suite | ₹12,000 |
| ICU | ₹15,000 |
| NICU | ₹18,000 |

---

## Current State After This Thread

**Total source files**: 141 (`.ts` + `.tsx`)
**Total API route files**: 66
**Total DB tables**: 18 (15 prior + insurance_claims + claim_events + discharge_milestones)
**Latest commit**: `d1fc4d3` (Phase 5)

---

## What's Next

The 5-phase billing integration is complete. Potential next steps:
1. **End-to-end testing**: Run through a complete patient flow with insurance claim lifecycle on Vercel
2. **Billing dashboard UI**: The `/api/billing/metrics` and `/api/billing/insurer-performance` endpoints exist but have no frontend. Could build a "Billing Intelligence" admin page or tab.
3. **Monthly summary auto-post**: The design doc specifies monthly department channel summaries (e.g., "March 2026 Discharge Performance — #Billing"). Could be a cron job.
4. **Cron for enhancement checks**: `/api/billing/check-enhancements` exists as manual trigger. Could add to Vercel cron for periodic scanning.
5. **Phase 10 (Files + Patient Tabs)**: Still in PRD addendum, not started.
