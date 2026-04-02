# Rounds OT Surgery Readiness — Build PRD v2

**Author**: V + Claude (collaborative design)
**Date**: 2 April 2026 (v2: UX revision)
**Status**: Ready for build
**Base document**: `Rounds-M8-OT-Surgery-Readiness-PRD.md` (V's original PRD)
**This document**: Reconciles the original PRD with the current Rounds architecture (Steps 0–9.4 + Billing Integration B.1–B.5), design decisions made in conversation, and a full UX/adoptability review.

---

## 0. Design Decisions (Locked In)

These decisions were made before writing this PRD and must not be revisited during build.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Surgery info lives inside **PatientDetailView** (not separate /ot pages). OT Schedule dashboard is a **top-level route** at `/ot-schedule` (not under /admin). | No new bottom tabs. OT staff access the dashboard via a link on the Admin page AND a persistent entry point on the Patients tab when they have pending OT items. The dashboard is the OT team's daily home screen — burying it under /admin sends the wrong signal. |
| D2 | **Dynamic specialist clearances** — anaesthetist can add clearance requests post-PAC, each becomes a trackable readiness item. | Real-world PAC often triggers 2-3 specialist clearances that need independent tracking. |
| D3 | Surgery postable from **any patient stage** including leads/OPD. patient_thread_id and IP number are optional. | OT planning starts early — equipment rental, PAC scheduling, and team coordination happen before admission. |
| D4 | **New OT-specific tables** (surgery_postings, ot_readiness_items, ot_readiness_audit_log, ot_equipment_items). No collision with existing readiness_items table. | OT readiness is fundamentally different from form-based readiness — needs audit trail, escalation levels, dynamic items. The existing `readiness_items` table has a hard FK to `form_submissions` and different status values. |
| D5 | **ASA score recorded during PAC confirmation**. ASA III+ auto-triggers ICU bed item and high-risk flag. | Anaesthetist is the only person who should assign ASA. Score determines downstream readiness requirements. |
| D6 | **Structured equipment tracking** — each item (implant, rental equipment) has vendor, status, ETA. **Role-aware detail levels** — non-SCM roles see simplified status (Available / In Transit / Pending / Problem), SCM/OT coordinator see full vendor + ETA detail. | Equipment unavailability is the #1 same-day cancellation cause. Free-text doesn't cut it. But the surgeon doesn't need to see vendor contact details. |
| D7 | **Single pharmacy readiness item** for now. Can break into phases later. | Pharmacy workflow isn't well-enough understood yet. Start simple, add granularity with data. |
| D8 | **Mobile OT dashboard**: single scrollable list grouped by OT room. Desktop: 3-column layout. | Mobile-first for OT staff who are always on their feet. |
| D9 | **Surgery posting form is a first-class entity** (writes to `surgery_postings` table), NOT a generic form_submissions record. The existing `surgery_posting` form type in `FORMS_BY_STAGE` at `pre_op` is replaced by a direct action — "Post Surgery" button/slash command that opens a dedicated wizard. | Surgery postings need structured fields (OT room, slot order, team assignment, readiness generation) that don't fit the generic FormSchema → FormRenderer pipeline. The old form type is deprecated in favor of the first-class entity. |
| D10 | **Progressive disclosure everywhere** — Surgery Panel collapses by default, readiness categories are accordions, equipment detail is role-gated. | The #1 UX failure mode is showing 22 items in a flat list on mobile. Non-tech-savvy staff need to see their task count, not the entire checklist. |
| D11 | **Action-first "My OT Items"** — pending OT readiness items for the current user surface as a prominent banner/card on the Patients tab AND as a new sub-tab in Tasks. One-tap confirm without navigating to the patient. | The most important daily question is "what do I need to do?" — this must be answerable in < 2 taps. |
| D12 | **Posting form is a 3-step wizard** with smart procedure defaults. Only 7 fields required; everything else is progressive. | 17+ fields in one form causes abandonment. Most fields can be filled later or auto-suggested from the procedure. |
| D13 | **PAC confirmation is a standalone bottom sheet** invocable from OT Items action queue, not nested inside PatientDetailView. | Anaesthetists do 5-10 PACs per day. The flow must be reachable in 1 tap and completable in 15 seconds. |
| D14 | **Bulk confirm for coordinators** — OT coordinator can confirm all their pending items for a surgery in one action. | Naveen manages 5-7 cases/day × 3-4 items each = 15-28 individual confirms. Bulk action reduces this to 5-7. |

---

## 1. UX Principles

These principles govern ALL UI decisions in this module.

### 1.1 Action-First, Not Information-First

Every screen answers "what do I need to do RIGHT NOW?" before "what's the full picture?" The full picture is available via progressive disclosure (expand, drill down), but the default view is the action queue.

### 1.2 One-Tap Confirm

The most common action in this system is confirming a readiness item. This must never require more than: see item → tap Confirm → done. No navigation to another page, no scrolling through unrelated items.

### 1.3 Role-Aware Views

Different roles see different levels of detail on the same data:
- **Surgeon**: procedure, date, overall readiness status, their own pending items (consent, site marking)
- **Anaesthetist**: PAC status, ASA, their clearance requests, investigations
- **OT Coordinator (Naveen)**: full checklist, equipment detail, sequencing, bulk actions
- **Supply Chain**: equipment items with vendor/ETA detail, delivery status updates
- **Billing**: billing clearance item, insurance claim status cross-reference
- **Nursing**: their nursing items only (NBM, pre-med, part prep, checklist)
- **IP Coordinator**: team confirmation, scheduling, posting creation

### 1.4 Progressive Disclosure

Default views are collapsed/summarized. Full detail is one tap away. This applies to:
- Surgery Panel in PatientDetailView (summary card → expanded checklist)
- Equipment items (simplified dot → full vendor detail for SCM)
- OT Dashboard case cards (summary → patient detail)
- Readiness categories (accordion sections)

### 1.5 Smart Defaults

The system pre-fills what it can infer:
- Procedure → wound class, anaesthesia type, post-op destination, estimated duration
- ASA ≥ 3 → ICU bed required
- Insurance patient → billing clearance items
- Procedure requiring blood → blood products item

### 1.6 Empty State Messaging

Every view that can be empty has helpful empty state text:
- OT Items (no pending): "No surgery items need your action right now. Items appear here when a case is posted that involves your team."
- Surgery Panel (no posting): "No surgery posted for this patient. [Post Surgery]"
- OT Dashboard (no cases today): "No cases scheduled for today. [Post Surgery] or [View Tomorrow]"

### 1.7 Contextual Onboarding

First-time users see subtle "?" tooltips on unfamiliar elements:
- "This item is assigned to you because you're in the Anaesthesia department"
- "Tap to confirm this item is ready. You can also flag it if there's a problem."
- "Items turn green when confirmed. Orange means partially ready. Red means blocked."

---

## 2. How This Integrates Across the App

OT Surgery Readiness touches every part of Rounds. This section maps every integration point and explicitly calls out what is NOT modified.

### 2.1 Patient Tab (PatientDetailView)

**What changes:**
- **New "Surgery" panel** added after the Insurance Claim panel (or before it, depending on which data exists). Follows the existing conditional render pattern: `{surgeryPosting && <SurgeryPanel ... />}`.
- Panel has **two states**:
  - **Collapsed (default)**: Summary card showing procedure, surgeon, date, readiness donut chart, and a personal action line: "You have 2 items to confirm" (or "All your items confirmed ✓" or nothing if no items for this role).
  - **Expanded**: Full categorized checklist with accordion sections. Tap the summary card to expand.

**What does NOT change:**
- `DetailTab` type stays `'overview' | 'files'` — no new tab needed
- Stage Progress Bar, Patient Info Card, Discharge Progress, Insurance Claim panels — all untouched
- Inline edit endpoints (`/api/patients/{id}/fields`, `/api/patients/{id}/stage`) — untouched
- `VALID_TRANSITIONS` object — untouched
- Data fetch pattern — we ADD a new fetch (`/api/ot/postings?patient_thread_id=X`) alongside existing fetches

**New action buttons (role-gated, inside expanded Surgery Panel):**
- "Confirm PAC" — anaesthesiologists only, when PAC is pending → opens PAC bottom sheet
- "Add Clearance" — anaesthesiologists only → inline add form
- "Add Equipment" — IP coordinators, OT coordinators, supply chain → inline add form
- "Edit Posting" — posting creator, OT coordinator, GM → opens posting edit

**Individual item actions:**
- Each pending item has a tap-to-confirm action. For the responsible person, tapping opens a minimal confirm dialog (notes optional). Others see the item as read-only.

### 2.2 Patients Tab — OT Action Banner

**What changes:**
- When the logged-in user has pending OT readiness items, a **banner card** appears at the TOP of the patient list (above the first patient): "🔵 You have 3 OT items to confirm → [View]"
- Tapping "View" navigates to Tasks tab → OT Items sub-tab
- Banner fetches from `/api/ot/readiness/mine?count_only=true`

**What does NOT change:**
- Patient list rendering, search, filters — all untouched
- Patient card layout — untouched
- Tab switching mechanism — untouched (uses existing `handleTabChange`)

### 2.3 Chat Tab (SlashCommandMenu)

**What changes:**
- New "Surgery" section in SlashCommandMenu, visible in patient thread channels:
  - `Post Surgery` — opens surgery posting wizard pre-filled with patient data
  - `OT Status` — posts a system message with current readiness summary
  - `Confirm PAC` — opens PAC bottom sheet (anaesthesiologists only)
  - `Add Specialist Clearance` — opens clearance add form (anaesthesiologists only)
  - `Add Equipment` — opens equipment add form
- System messages auto-posted to patient thread on:
  - Surgery posted, readiness items confirmed/flagged/blocked, escalation fires, all items confirmed
- System messages auto-posted to `#ot-schedule` channel (new `cross-functional` channel, seeded via existing seed endpoint)

**What does NOT change:**
- Existing slash command sections (Forms, Stage Transitions, Discharge Steps, Insurance Claims, Archive) — all untouched
- `FORMS_BY_STAGE` mapping — untouched (we deprecate the old `surgery_posting` form type by removing it from the `pre_op` array and adding a note, but we do NOT break the form registry)
- SlashCommandMenu component interface — we add a new `onSurgeryAction` callback prop alongside existing `onSelectForm`, `onAdvanceStage`, etc.
- Channel data shape — `channel.data.patient_thread_id` continues to work as before

**Deprecation of old surgery_posting form:**
- Remove `'surgery_posting'` from `FORMS_BY_STAGE.pre_op` array
- Keep the FormSchema definition in form-registry.ts (for backwards compatibility with any existing submissions)
- The "Post Surgery" slash command replaces it, routing to the new wizard instead of the old form renderer

### 2.4 Forms Tab

**What does NOT change:**
- FormSchema → FormRenderer → form_submissions pipeline — completely untouched
- All 13 existing form types — untouched
- `FORMS_BY_STAGE` mapping (except removing `surgery_posting` from `pre_op`)
- `validateFormData()`, `computeCompletionScore()`, `getAllFields()` — untouched

**What changes:**
- Nothing in the Forms tab itself. Surgery posting is NOT a form anymore — it's a first-class entity accessed via Patient Detail, Slash Commands, or OT Dashboard.

### 2.5 Tasks Tab (TasksView)

**What changes:**
- New sub-tab: **"OT Items"** added to `TaskTab` type: `'briefing' | 'ot_items' | 'overdue' | 'escalations'`
- OT Items sub-tab shows readiness items assigned to the current user's role, grouped by surgery date
- **Action-first design**: each item shows patient name, procedure, item label, and a **prominent Confirm button** right on the card — no navigation needed for simple confirmations
- Flagging opens a reason input inline
- For OT coordinators: **"Confirm All"** button per surgery (bulk confirm all their pending items)
- Overdue OT items ALSO appear in the existing "Overdue" sub-tab (unified overdue view) — fetched from `/api/ot/readiness/overdue` and merged with existing `/api/readiness/overdue` results

**What does NOT change:**
- Existing `readiness_items` table queries — untouched
- Existing Overdue sub-tab rendering — we MERGE OT overdue items into the same list, visually distinguished by an "OT" badge
- Briefing sub-tab — untouched
- Escalations sub-tab — we merge OT escalations into the same view
- `onNavigateToPatient` callback — continues to work; OT items that have a `patient_thread_id` navigate to patient detail
- Badge count on Tasks tab — we ADD OT overdue count to the existing badge number

### 2.6 Admin Section

**What changes:**
- New quick-action link on admin dashboard: "OT Schedule →" pointing to `/ot-schedule`
- New page at **`/ot-schedule`** (top-level route, NOT under /admin)
  - Uses `AdminLayout` wrapper for consistent styling but accessible to ALL authenticated users (not admin-gated)
  - Desktop: 3-column layout (OT 1 | OT 2 | OT 3)
  - Mobile: single scrollable list grouped by OT room
  - Date navigation, stats header, sequencing warnings, "+ Post Surgery" button

**What does NOT change:**
- All existing admin pages (`/admin/admissions`, `/admin/departments`, etc.) — untouched
- Admin access control pattern (`isAdmin` check) — untouched for existing pages
- AdminLayout component — untouched (reused)

### 2.7 Billing Integration Connection

**What changes:**
- The `billing_clearance` readiness item shows the patient's insurance claim status alongside it (if an active claim exists in `insurance_claims`). This is a READ-ONLY cross-reference — billing staff see "Pre-auth approved: ₹3.5L" next to their clearance item to help them decide.

**What does NOT change:**
- `insurance_claims`, `claim_events`, `discharge_milestones` tables — untouched
- `logClaimEvent()`, `EVENT_STATUS_MAP` — untouched
- All billing API endpoints — untouched
- `billing-metrics.ts` — untouched

---

## 3. Data Model

### 3.1 New Tables

#### `surgery_postings`

One row per posted surgery. This is the core entity.

```sql
CREATE TABLE surgery_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Patient (all optional except patient_name — supports early-stage posting)
  patient_name VARCHAR(255) NOT NULL,
  patient_thread_id UUID REFERENCES patient_threads(id), -- nullable: may not exist yet
  uhid VARCHAR(50),
  ip_number VARCHAR(50),
  age INTEGER,
  gender VARCHAR(10), -- 'M', 'F', 'Other'

  -- Surgery details (REQUIRED at posting: procedure_name, procedure_side, primary_surgeon_name, anaesthesiologist_name, scheduled_date, ot_room)
  procedure_name VARCHAR(500) NOT NULL,
  procedure_side VARCHAR(20) NOT NULL, -- 'Left', 'Right', 'Bilateral', 'N/A', 'Midline'
  case_type VARCHAR(20) NOT NULL DEFAULT 'Elective', -- 'Elective', 'Emergency', 'Day Care'
  wound_class VARCHAR(20), -- 'Clean', 'Clean-Contaminated', 'Dirty', 'Infected' — nullable, can be filled later or auto-suggested
  case_complexity VARCHAR(20), -- 'Minor', 'Moderate', 'Major', 'Super-Major'
  estimated_duration_minutes INTEGER,
  anaesthesia_type VARCHAR(20), -- 'GA', 'SA', 'Regional', 'LA', 'Block', 'Sedation' — nullable, auto-suggested from procedure

  -- Flags that drive conditional readiness items
  implant_required BOOLEAN DEFAULT false,
  blood_required BOOLEAN DEFAULT false,
  is_insured BOOLEAN DEFAULT false, -- drives billing clearance items

  -- PAC & ASA (populated when anaesthetist confirms PAC)
  asa_score INTEGER, -- 1-6 (ASA Physical Status Classification)
  asa_confirmed_by UUID REFERENCES profiles(id),
  asa_confirmed_at TIMESTAMPTZ,
  pac_notes TEXT,
  is_high_risk BOOLEAN DEFAULT false, -- auto-set when ASA >= 3

  -- Team (REQUIRED: primary_surgeon_name, anaesthesiologist_name. Everything else progressive.)
  primary_surgeon_name VARCHAR(255) NOT NULL,
  primary_surgeon_id UUID REFERENCES profiles(id),
  assistant_surgeon_name VARCHAR(255),
  anaesthesiologist_name VARCHAR(255) NOT NULL,
  anaesthesiologist_id UUID REFERENCES profiles(id),
  scrub_nurse_name VARCHAR(255), -- filled later by OT coordinator
  circulating_nurse_name VARCHAR(255), -- filled later by OT coordinator
  ot_technician_name VARCHAR(255), -- filled later by OT coordinator

  -- Scheduling (REQUIRED: scheduled_date, ot_room)
  scheduled_date DATE NOT NULL,
  scheduled_time TIME, -- nullable for "on call" or TBD cases
  ot_room INTEGER NOT NULL, -- 1, 2, or 3
  slot_order INTEGER, -- ordering within the OT for the day

  -- Post-op planning (auto-suggested from procedure defaults)
  post_op_destination VARCHAR(20) NOT NULL DEFAULT 'PACU', -- 'PACU', 'ICU', 'Ward'
  icu_bed_required BOOLEAN DEFAULT false,

  -- Status
  overall_readiness VARCHAR(20) NOT NULL DEFAULT 'not_ready',
    -- 'not_ready', 'partial', 'ready', 'blocked'
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
    -- 'posted', 'confirmed', 'in_progress', 'completed', 'cancelled', 'postponed'
  cancellation_reason TEXT,
  postponed_to DATE,

  -- Metadata
  posted_by UUID NOT NULL REFERENCES profiles(id),
  posted_via VARCHAR(20) DEFAULT 'form', -- 'wizard', 'slash_command', 'api', 'migration'
  getstream_message_id VARCHAR(255),
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sp_date ON surgery_postings(scheduled_date);
CREATE INDEX idx_sp_status ON surgery_postings(status) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_sp_ot_date ON surgery_postings(ot_room, scheduled_date);
CREATE INDEX idx_sp_patient ON surgery_postings(patient_thread_id);
```

**Key changes from v1**: `wound_class` and `anaesthesia_type` are now nullable (filled later or auto-suggested). Added `implant_required`, `blood_required`, `is_insured` flags that drive conditional readiness items. Scrub nurse, circulating nurse, OT tech are explicitly progressive-fill fields.

#### `ot_readiness_items`

Auto-generated from template when surgery is posted. Dynamic items (specialist clearances, equipment) can be added later.

```sql
CREATE TABLE ot_readiness_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,

  -- Item definition
  item_key VARCHAR(80) NOT NULL,
  item_label VARCHAR(255) NOT NULL,
  item_category VARCHAR(30) NOT NULL,
    -- 'clinical', 'financial', 'logistics', 'nursing', 'team', 'specialist_clearance', 'equipment'
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_dynamic BOOLEAN DEFAULT false,

  -- Responsibility
  responsible_role VARCHAR(50) NOT NULL,
  responsible_user_id UUID REFERENCES profiles(id),
  responsible_user_name VARCHAR(255),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending', 'confirmed', 'not_applicable', 'flagged', 'blocked'
  status_detail VARCHAR(500),

  -- Confirmation
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_by_name VARCHAR(255),
  confirmed_at TIMESTAMPTZ,
  confirmation_notes TEXT,

  -- For PAC confirmation specifically
  asa_score_given INTEGER,

  -- Escalation
  due_by TIMESTAMPTZ,
  escalated BOOLEAN NOT NULL DEFAULT false,
  escalated_at TIMESTAMPTZ,
  escalated_to UUID REFERENCES profiles(id),
  escalation_level INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(surgery_posting_id, item_key)
);

CREATE INDEX idx_ori_surgery ON ot_readiness_items(surgery_posting_id);
CREATE INDEX idx_ori_status ON ot_readiness_items(status) WHERE status = 'pending';
CREATE INDEX idx_ori_responsible ON ot_readiness_items(responsible_user_id);
CREATE INDEX idx_ori_due ON ot_readiness_items(due_by) WHERE status = 'pending';
CREATE INDEX idx_ori_role ON ot_readiness_items(responsible_role, status);
```

#### `ot_readiness_audit_log`

Immutable log of every status change.

```sql
CREATE TABLE ot_readiness_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  readiness_item_id UUID NOT NULL REFERENCES ot_readiness_items(id),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id),

  action VARCHAR(30) NOT NULL,
    -- 'created', 'confirmed', 'flagged', 'blocked', 'escalated', 'reset', 'marked_na', 'added', 'bulk_confirmed'
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  detail TEXT,

  performed_by UUID NOT NULL REFERENCES profiles(id),
  performed_by_name VARCHAR(255),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oral_surgery ON ot_readiness_audit_log(surgery_posting_id);
CREATE INDEX idx_oral_item ON ot_readiness_audit_log(readiness_item_id);
```

**Key change from v1**: Added `'bulk_confirmed'` action type.

#### `ot_equipment_items`

Structured tracking for implants, rental equipment, and special instruments.

```sql
CREATE TABLE ot_equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,
  readiness_item_id UUID REFERENCES ot_readiness_items(id),

  item_type VARCHAR(30) NOT NULL, -- 'implant', 'rental_equipment', 'special_instrument', 'consumable'
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT,
  quantity INTEGER DEFAULT 1,

  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(255),
  is_rental BOOLEAN DEFAULT false,
  rental_cost_estimate NUMERIC(10,2),

  status VARCHAR(30) NOT NULL DEFAULT 'requested',
    -- 'requested', 'vendor_confirmed', 'in_transit', 'delivered', 'in_ot', 'verified', 'returned'
  delivery_eta TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  status_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oei_surgery ON ot_equipment_items(surgery_posting_id);
CREATE INDEX idx_oei_status ON ot_equipment_items(status) WHERE status NOT IN ('verified', 'returned');
```

### 3.2 Procedure Defaults (Smart Suggestions)

When a user selects a procedure in the posting wizard, the system suggests defaults for wound class, anaesthesia type, post-op destination, and estimated duration. User can override any suggestion.

```typescript
// src/lib/ot/procedure-defaults.ts

interface ProcedureDefaults {
  wound_class: string;
  anaesthesia_type: string;
  post_op_destination: string;
  estimated_duration_minutes: number;
  typically_requires_blood: boolean;
  typically_requires_implant: boolean;
}

export const PROCEDURE_DEFAULTS: Record<string, ProcedureDefaults> = {
  'Unilateral TKR':          { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 120, typically_requires_blood: true, typically_requires_implant: true },
  'Bilateral TKR':           { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'ICU', estimated_duration_minutes: 210, typically_requires_blood: true, typically_requires_implant: true },
  'Total Hip Replacement':   { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 150, typically_requires_blood: true, typically_requires_implant: true },
  'Arthroscopic ACL Reconstruction': { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: true },
  'Implant Removal':         { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'ORIF':                    { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 120, typically_requires_blood: true, typically_requires_implant: true },
  'DHS Fixation':            { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 90, typically_requires_blood: true, typically_requires_implant: true },
  'Laparoscopic Cholecystectomy': { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Lap B/L Inguinal Hernia + Mesh Repair': { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: true },
  'Lap Appendicectomy':      { wound_class: 'Clean-Contaminated', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'ERCP':                    { wound_class: 'Clean-Contaminated', anaesthesia_type: 'Sedation', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'Sebaceous Cyst Excision':  { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Lipoma Excision':          { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Laser Haemorrhoidectomy':  { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Fissurectomy':             { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Fistulectomy':             { wound_class: 'Dirty', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'Circumcision':             { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Stapler Circumcision':     { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 20, typically_requires_blood: false, typically_requires_implant: false },
  'TURP':                     { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 60, typically_requires_blood: true, typically_requires_implant: false },
  'URS + RIRS':               { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Septoplasty':              { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Adenotonsillectomy':       { wound_class: 'Clean-Contaminated', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'FESS':                     { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: false },
  'B/L EVLT':                 { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: false },
  'Craniotomy':               { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'ICU', estimated_duration_minutes: 240, typically_requires_blood: true, typically_requires_implant: false },
  'Decompression + Fixation': { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'ICU', estimated_duration_minutes: 180, typically_requires_blood: true, typically_requires_implant: true },
};

// Fallback for procedures not in the map — no suggestions, all manual
export function getProcedureDefaults(procedureName: string): Partial<ProcedureDefaults> | null {
  // Exact match first
  if (PROCEDURE_DEFAULTS[procedureName]) return PROCEDURE_DEFAULTS[procedureName];
  // Fuzzy match: check if the procedure name contains a known key
  for (const [key, defaults] of Object.entries(PROCEDURE_DEFAULTS)) {
    if (procedureName.toLowerCase().includes(key.toLowerCase())) return defaults;
  }
  return null;
}
```

### 3.3 Readiness Checklist Template

Auto-generated when a surgery is posted. Conditional items based on posting data.

```typescript
// src/lib/ot/readiness-template.ts

interface ReadinessTemplate {
  item_key: string;
  item_label: string;
  item_category: 'clinical' | 'financial' | 'logistics' | 'nursing' | 'team';
  responsible_role: string;
  sort_order: number;
  condition?: (posting: SurgeryPosting) => boolean;
  due_offset_hours: number;
}

export const OT_READINESS_TEMPLATE: ReadinessTemplate[] = [
  // === CLINICAL ===
  {
    item_key: 'pac_cleared',
    item_label: 'PAC Completed & Clearance Given',
    item_category: 'clinical',
    responsible_role: 'anaesthesiologist',
    sort_order: 1,
    condition: (p) => p.anaesthesia_type !== 'LA',
    due_offset_hours: 12,
  },
  {
    item_key: 'investigations_complete',
    item_label: 'All Pre-Op Investigations Complete & Reviewed',
    item_category: 'clinical',
    responsible_role: 'anaesthesiologist',
    sort_order: 2,
    due_offset_hours: 12,
  },
  {
    item_key: 'surgical_consent',
    item_label: 'Surgical Consent Signed',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 4,
    due_offset_hours: 4,
  },
  {
    item_key: 'high_risk_consent',
    item_label: 'High-Risk Consent Signed',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 5,
    condition: (p) => p.case_complexity === 'Major' || p.case_complexity === 'Super-Major',
    due_offset_hours: 4,
  },
  {
    item_key: 'site_marking',
    item_label: 'Surgical Site Marked',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 6,
    condition: (p) => p.procedure_side !== 'N/A' && p.procedure_side !== 'Midline',
    due_offset_hours: 2,
  },

  // === FINANCIAL ===
  {
    item_key: 'billing_clearance',
    item_label: 'Billing / Pre-Auth Clearance Confirmed',
    item_category: 'financial',
    responsible_role: 'billing',
    sort_order: 10,
    condition: (p) => p.is_insured === true,
    due_offset_hours: 12,
  },
  {
    item_key: 'deposit_confirmed',
    item_label: 'Deposit Collected / Waiver Approved',
    item_category: 'financial',
    responsible_role: 'billing',
    sort_order: 11,
    due_offset_hours: 12,
  },

  // === LOGISTICS ===
  {
    item_key: 'cssd_instruments',
    item_label: 'CSSD Instruments Ready',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 20,
    due_offset_hours: 4,
  },
  {
    item_key: 'ot_equipment_ready',
    item_label: 'OT Equipment Ready (C-Arm, MindRay, Scope, etc.)',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 21,
    due_offset_hours: 4,
  },
  {
    item_key: 'implant_available',
    item_label: 'Implant Available & Verified in OT',
    item_category: 'logistics',
    responsible_role: 'supply_chain',
    sort_order: 22,
    condition: (p) => p.implant_required === true,
    due_offset_hours: 12,
  },
  {
    item_key: 'consumables_available',
    item_label: 'Consumables Available',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 23,
    due_offset_hours: 4,
  },
  {
    item_key: 'blood_available',
    item_label: 'Blood Products Available',
    item_category: 'logistics',
    responsible_role: 'lab',
    sort_order: 24,
    condition: (p) => p.blood_required === true,
    due_offset_hours: 4,
  },
  {
    item_key: 'pharmacy_ready',
    item_label: 'Pharmacy Ready (Pre-Op + OT Medications)',
    item_category: 'logistics',
    responsible_role: 'pharmacy',
    sort_order: 25,
    due_offset_hours: 4,
  },

  // === NURSING ===
  {
    item_key: 'patient_nbm',
    item_label: 'Patient NBM Confirmed',
    item_category: 'nursing',
    responsible_role: 'nursing',
    sort_order: 30,
    due_offset_hours: 2,
  },
  {
    item_key: 'pre_medication',
    item_label: 'Pre-Medication Administered',
    item_category: 'nursing',
    responsible_role: 'nursing',
    sort_order: 31,
    due_offset_hours: 2,
  },
  {
    item_key: 'part_preparation',
    item_label: 'Part Preparation Completed',
    item_category: 'nursing',
    responsible_role: 'nursing',
    sort_order: 32,
    due_offset_hours: 2,
  },
  {
    item_key: 'nursing_preop_checklist',
    item_label: 'Pre-Operative Nursing Checklist Done',
    item_category: 'nursing',
    responsible_role: 'nursing',
    sort_order: 33,
    due_offset_hours: 2,
  },
  {
    item_key: 'icu_bed_booked',
    item_label: 'ICU Bed Booked & Confirmed',
    item_category: 'nursing',
    responsible_role: 'ip_coordinator',
    sort_order: 34,
    condition: (p) => p.icu_bed_required === true,
    due_offset_hours: 4,
  },

  // === TEAM ===
  {
    item_key: 'surgeon_confirmed',
    item_label: 'Surgeon Availability Confirmed',
    item_category: 'team',
    responsible_role: 'ip_coordinator',
    sort_order: 40,
    due_offset_hours: 12,
  },
  {
    item_key: 'anaesthetist_confirmed',
    item_label: 'Anaesthesiologist Availability Confirmed',
    item_category: 'team',
    responsible_role: 'ip_coordinator',
    sort_order: 41,
    due_offset_hours: 12,
  },
  {
    item_key: 'ot_team_assigned',
    item_label: 'OT Team Assigned (Scrub + Circulating + Tech)',
    item_category: 'team',
    responsible_role: 'ot_coordinator',
    sort_order: 42,
    due_offset_hours: 4,
  },
];
```

### 3.4 Dynamic Item Types

These are NOT auto-generated from template. Added by users after the posting is created.

**Specialist Clearances** (added by anaesthetist post-PAC):
- `clearance_cardiology` — "Cardiology Clearance (Aortic Stenosis Grade II)"
- `clearance_nephrology` — "Nephrology Clearance (CKD Stage 3)"
- Each gets `item_category: 'specialist_clearance'`, `is_dynamic: true`, `due_offset_hours: 12`

**Equipment Items** (added by IP coordinator, OT coordinator, or supply chain):
- Each equipment item in `ot_equipment_items` links to a parent readiness item in `ot_readiness_items`
- `equip_carm_1` — "C-Arm (Rental)" → tracks vendor, delivery status, ETA
- `equip_implant_thr_1` — "Smith & Nephew BHR Femoral Size 50" → tracks availability, verification

### 3.5 ASA Score Flow

1. Surgery is posted. `pac_cleared` readiness item is auto-generated (unless LA case).
2. Anaesthetist does PAC (outside Rounds for now — in person or via KareXpert).
3. Anaesthetist opens Rounds → sees "PAC: B/L TKR — Dr. Harish" in their **OT Items action queue** (Tasks tab) → taps → **PAC bottom sheet** opens.
4. Bottom sheet asks for:
   - **ASA Score** (required, large tap targets: 1 through 6)
   - **PAC Notes** (text, e.g., "Fit for GA. Normal investigations. No comorbidities.")
   - **Specialist clearances needed?** (toggle)
     - If yes: "+ Add Clearance" button → inline row with specialty dropdown + reason text field. Can add multiple.
5. On confirm:
   - `pac_cleared` item → status = 'confirmed', asa_score_given = N
   - `surgery_postings.asa_score` = N, `asa_confirmed_by`, `asa_confirmed_at` set
   - If ASA >= 3: `surgery_postings.is_high_risk` = true
   - If ASA >= 3 AND `icu_bed_required` was false: auto-create `icu_bed_booked` readiness item
   - For each specialist clearance requested: create dynamic readiness item
   - Post system message to patient thread (if exists) and `#ot-schedule`

**Key UX change from v1**: The PAC bottom sheet is reachable from OT Items (1 tap), from the Surgery Panel in PatientDetailView (Confirm PAC button), and from the `/confirm-pac` slash command. All three routes open the same bottom sheet component. The anaesthetist's most common path is: open app → Tasks tab → OT Items → tap PAC item → bottom sheet → confirm. Total: 3 taps.

### 3.6 Readiness Status Computation

```typescript
function computeOverallReadiness(items: OtReadinessItem[]): OverallReadiness {
  const active = items.filter(i => i.status !== 'not_applicable');
  if (active.some(i => i.status === 'blocked')) return 'blocked';
  if (active.some(i => i.status === 'flagged')) return 'not_ready';
  if (active.some(i => i.status === 'pending')) return 'partial';
  if (active.every(i => i.status === 'confirmed' || i.status === 'not_applicable')) return 'ready';
  return 'not_ready';
}
```

---

## 4. API Routes

### 4.1 Surgery Posting CRUD

```
POST   /api/ot/postings              — Create posting + auto-generate readiness items
GET    /api/ot/postings              — List (filterable: date, ot_room, status, surgeon, patient_thread_id)
GET    /api/ot/postings/[id]         — Get posting + all readiness items + equipment items
PATCH  /api/ot/postings/[id]         — Update details (re-evaluate conditional readiness items)
DELETE /api/ot/postings/[id]         — Soft cancel (status → 'cancelled')
```

**Side effects on POST:**
1. Generate readiness items from `OT_READINESS_TEMPLATE` (conditional logic applied)
2. Apply procedure defaults if available (wound_class, anaesthesia_type, etc.)
3. Compute `due_by` for each item: `scheduled_date + scheduled_time - due_offset_hours`
4. If `patient_thread_id` is null and there's a matching patient by UHID: link it
5. Post rich card message to `#ot-schedule` GetStream channel
6. If patient thread exists: post system message to patient thread
7. Recompute `overall_readiness`

### 4.2 Readiness Item Actions

```
PATCH  /api/ot/readiness/[item_id]   — Confirm, flag, block, mark N/A, or reset
POST   /api/ot/readiness/add         — Add dynamic item (specialist clearance or equipment)
GET    /api/ot/readiness/mine        — My pending items across all surgeries (role-filtered)
GET    /api/ot/readiness/mine?count_only=true — Count only (for banner badge)
POST   /api/ot/readiness/bulk-confirm — Bulk confirm multiple items (for coordinators)
GET    /api/ot/readiness/overdue     — Overdue OT items (merged into Tasks overdue view)
```

**PATCH side effects:**
1. Write to `ot_readiness_audit_log`
2. Recompute `overall_readiness` on parent `surgery_postings`
3. If PAC confirmation: update ASA fields, trigger dynamic items
4. Post system message to patient thread (if exists) and `#ot-schedule`
5. If flagged/blocked: push notify posting creator + OT coordinator
6. If all confirmed (ready): push notify OT coordinator + surgeon

**POST /api/ot/readiness/bulk-confirm:**
```typescript
{
  surgery_posting_id: string;
  item_ids: string[]; // items to confirm
  notes?: string;     // shared confirmation note
}
```
- Validates all items belong to the same surgery and the caller's role matches
- Writes individual audit log entries with action = `'bulk_confirmed'`
- Single recompute of overall_readiness after all updates
- Single system message: "✅ Naveen confirmed 4 logistics items for B/L TKR"

### 4.3 Equipment Tracking

```
PATCH  /api/ot/equipment/[id]        — Update equipment status
```

### 4.4 OT Schedule Dashboard

```
GET    /api/ot/schedule               — Daily schedule (default: today)
  ?date=YYYY-MM-DD
  ?range=week
  ?ot_room=1|2|3
GET    /api/ot/schedule/stats         — Summary stats for dashboard header
```

### 4.5 Escalation & Cron

```
POST   /api/ot/escalation/check      — Cron: check overdue readiness items, escalate
POST   /api/ot/schedule/digest       — Cron: post daily OT summary to #ot-schedule at 6 AM
POST   /api/ot/postings/cleanup      — Cron: mark past-date unconfirmed postings as cancelled
```

**Escalation logic:**
- Level 0 → Level 1: item past `due_by` → escalate to department head
- Level 1 → Level 2: item past `due_by + 2 hours` → escalate to GM
- Write audit log, push notify, post to `#ot-schedule`
- Set `surgery_postings.overall_readiness = 'blocked'` if any item at level 2

---

## 5. UI Specifications

### 5.1 Surgery Posting Wizard (3-Step Mobile-First)

Replaces the old single-form approach. Each step fits on one mobile screen without scrolling.

**Step 1: Patient + Procedure**
```
┌─────────────────────────────────┐
│  Post Surgery                   │
│                                 │
│  Patient *                      │
│  [Search by name/UHID...    🔍] │
│  (auto-fills from patient context if launched from patient view) │
│                                 │
│  Procedure *                    │
│  [Search / select...        🔍] │
│  (autocomplete from COMMON_PROCEDURES + free text) │
│                                 │
│  Side *                         │
│  [Left] [Right] [Bilateral] [N/A] [Midline] │
│  (tap-to-select chips)          │
│                                 │
│  Case Type                      │
│  [Elective ✓] [Emergency] [Day Care] │
│                                 │
│  ── Auto-suggested (editable) ──│
│  Wound Class: Clean             │
│  Anaesthesia: SA                │
│  Duration: ~120 min             │
│  Requires Blood: Yes            │
│  Requires Implant: Yes          │
│                                 │
│              [Next →]           │
└─────────────────────────────────┘
```

When the user selects a procedure, auto-suggested fields appear below with pre-filled values from `PROCEDURE_DEFAULTS`. Each has a small edit icon. Unknown procedures show these fields empty.

**Step 2: Team + Schedule**
```
┌─────────────────────────────────┐
│  Post Surgery (2/3)             │
│                                 │
│  Primary Surgeon *              │
│  [Search / select...        🔍] │
│  (autocomplete from KNOWN_SURGEONS) │
│                                 │
│  Anaesthesiologist *            │
│  [Search / select...        🔍] │
│  (autocomplete from KNOWN_ANAESTHESIOLOGISTS) │
│                                 │
│  Date *          OT Room *      │
│  [📅 4 Apr 2026] [OT 1 ▾]      │
│                                 │
│  Time (optional)                │
│  [07:00 ▾]                      │
│                                 │
│  ── Fill later (optional) ──────│
│  Assistant Surgeon              │
│  Scrub Nurse                    │
│  Circulating Nurse              │
│  OT Technician                  │
│  (collapsed by default, expand to fill) │
│                                 │
│      [← Back]    [Next →]      │
└─────────────────────────────────┘
```

**Step 3: Review + Post**
```
┌─────────────────────────────────┐
│  Post Surgery (3/3)             │
│                                 │
│  B/L TKR — Left                 │
│  Dr. Harish Puranik             │
│  Fri 4 Apr 2026, 07:00 — OT 1  │
│  Clean | SA | ~120min           │
│  Blood: Yes | Implant: Yes      │
│                                 │
│  Anaesthesia: Dr. Manukumar     │
│                                 │
│  Post-Op: ICU (auto-suggested)  │
│                                 │
│  This will generate 16 readiness│
│  items based on your selections.│
│                                 │
│  Notes (optional)               │
│  [                          ]   │
│                                 │
│      [← Back]  [Post Surgery ✓] │
└─────────────────────────────────┘
```

### 5.2 PatientDetailView — Surgery Panel

**Collapsed State (default):**
```
┌─────────────────────────────────┐
│  UPCOMING SURGERY           [▾] │
│  ┌───────────────────────────┐  │
│  │ 🟡  B/L TKR — Dr. Harish │  │
│  │     Fri 4 Apr, 07:00 OT1 │  │
│  │                           │  │
│  │  [DONUT] 14/18 ready      │  │
│  │                           │  │
│  │  ⚡ You: 2 items to confirm│  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The donut chart uses 4 colors: green (confirmed), orange (pending), red (flagged/blocked), grey (N/A). The "You: 2 items to confirm" line only appears when the logged-in user has pending items. Tapping anywhere on the card expands.

**Expanded State:**
```
┌─────────────────────────────────┐
│  UPCOMING SURGERY           [▴] │
│  B/L TKR — Dr. Harish Puranik  │
│  Fri 4 Apr 2026, 07:00 — OT 1  │
│  Clean | SA | Moderate | ASA II │
│  [DONUT] 14/18    ● Partial     │
│                                 │
│  ▼ CLINICAL (3/5)               │
│    ✅ PAC Cleared (ASA II)      │
│       Dr. Manukumar, 2 Apr 14:30│
│    ✅ Investigations Complete    │
│    ⏳ Surgical Consent      [✓] │
│       Dr. Harish · due in 6h    │
│    ⏳ Site Marking           [✓] │
│       Dr. Harish · due in 2h    │
│    ✅ High-Risk Consent         │
│                                 │
│  ▼ SPECIALIST CLEARANCES (1/2)  │
│    ✅ Cardiology (AS Grade II)  │
│    ⏳ Nephrology (CKD 3)    [✓] │
│       pending · due in 8h       │
│                                 │
│  ▶ FINANCIAL (2/2) ✅           │
│  ▶ LOGISTICS (4/6)              │
│  ▶ NURSING (0/4)                │
│  ▶ TEAM (2/3)                   │
│                                 │
│  ── EQUIPMENT ──────────────────│
│  BHR Size 50    🟡 In Transit   │
│  C-Arm (Rental) 🟢 Delivered    │
│  (SCM users see: vendor, ETA,   │
│   contact. Others see dots only) │
│                                 │
│  [Confirm PAC] [+ Clearance]    │
│  [+ Equipment] [Edit Posting]   │
└─────────────────────────────────┘
```

Key UX details:
- Categories with ALL items confirmed show as collapsed with ✅ — no need to expand
- Categories with pending items for the CURRENT user auto-expand on load
- The `[✓]` button appears only on items assigned to the current user's role
- Tapping `[✓]` opens a minimal confirm dialog: "Confirm [item name]?" + optional notes + [Cancel] [Confirm]
- Non-responsible users see the item but no action button
- Equipment section shows simplified status dots for non-SCM roles

### 5.3 OT Schedule Dashboard (`/ot-schedule`)

**Desktop (3-column):**
```
┌──────────────────────────────────────────────────────┐
│  OT Schedule — [< Prev] Wed, 2 Apr 2026 [Next >] [📅]│
│  7 cases │ ●3 Ready │ ●2 Partial │ ●1 Not Ready │ ●1 Blocked │
│                                            [+ Post Surgery] │
├──────────────────┬──────────────────┬──────────────────┤
│    OT 1 (3)      │    OT 2 (2)      │    OT 3 (2)      │
│  [case card]     │  [case card]     │  [case card]     │
│  [case card]     │  [case card]     │                  │
│  [case card]     │                  │                  │
├──────────────────┴──────────────────┴──────────────────┤
│ ⚠ OT 1: Infected case (Slot 3) before Clean (Slot 4)  │
└──────────────────────────────────────────────────────┘
```

**Mobile (single scroll):**
```
OT Schedule — Wed, 2 Apr 2026
7 cases │ ●3 ●2 ●1 ●1            [+ Post]

── OT 1 (3 cases) ────────────────
[case card 1]
[case card 2]
[case card 3]

── OT 2 (2 cases) ────────────────
[case card 4]
[case card 5]

── OT 3 (2 cases) ────────────────
[case card 6]
[case card 7]

⚠ OT 1: Infected before Clean — resequence
```

**Case card:**
- Time + readiness dot (green/amber/red/pulsing-red for blocked)
- Procedure name + side
- Primary surgeon
- Wound class badge + anaesthesia type + ASA badge (if confirmed)
- High-risk indicator (🔴 if ASA ≥ 3)
- Compact donut: confirmed / total active items
- Tap → opens PatientDetailView if patient_thread_id exists, else inline expand

**Empty state:**
"No cases scheduled for [date]. [+ Post Surgery] or [View Tomorrow →]"

### 5.4 Tasks Tab — OT Items Sub-tab

New sub-tab in TasksView: **Briefing | OT Items | Overdue | Escalations**

`TaskTab` type becomes: `'briefing' | 'ot_items' | 'overdue' | 'escalations'`

**Action-first layout:**
```
── Tomorrow, 4 Apr 2026 ─────────────

B/L TKR — Dr. Harish — OT 1, 07:00
┌─────────────────────────────────┐
│ ⏳ PAC Completed & Clearance    │
│                      [Confirm ✓]│
└─────────────────────────────────┘

Lap Chole — Dr. Sajeet — OT 2, 09:00
┌─────────────────────────────────┐
│ ⏳ PAC Completed & Clearance    │
│                      [Confirm ✓]│
└─────────────────────────────────┘

── Sat, 5 Apr 2026 ──────────────

THR — Dr. Avinash — OT 3, 08:00
┌─────────────────────────────────┐
│ ⏳ Investigations Complete      │
│                      [Confirm ✓]│
└─────────────────────────────────┘
```

Each card has:
- Minimum context: patient/procedure, surgeon, OT/time
- Item label
- **Large [Confirm ✓] button** right on the card — one tap to confirm
- Swipe left to Flag (reveals reason input)
- For OT coordinators: a **"Confirm All Mine"** button per surgery group

**Empty state:**
"No surgery items need your action right now. Items appear here when a case is posted that involves your team."

### 5.5 Patients Tab — OT Action Banner

When the user has pending OT items, a banner appears at the TOP of the patient list:

```
┌─────────────────────────────────┐
│ 🔵 3 OT items need your action  │
│                        [View →] │
└─────────────────────────────────┘
```

Tapping "View" switches to Tasks tab → OT Items sub-tab. Banner disappears when count = 0.

### 5.6 PAC Confirmation Bottom Sheet

Standalone component, invocable from multiple entry points:

```
┌─────────────────────────────────┐
│  Confirm PAC                    │
│  B/L TKR — Pt: Ramesh Kumar    │
│  Dr. Harish Puranik — OT 1     │
│  Fri 4 Apr 2026, 07:00         │
│─────────────────────────────────│
│                                 │
│  ASA Score *                    │
│  [1] [2] [3] [4] [5] [6]       │
│  (large tap targets, ASA III+   │
│   highlights in red with        │
│   "High Risk" label)            │
│                                 │
│  PAC Notes                      │
│  [Fit for SA. Normal inv...]    │
│                                 │
│  Specialist Clearances Needed?  │
│  [No ✓] [Yes]                   │
│                                 │
│  (if Yes:)                      │
│  ┌─────────────────────────┐    │
│  │ Cardiology ▾ | AS Gr II │ ✕  │
│  └─────────────────────────┘    │
│  [+ Add Another Clearance]      │
│                                 │
│          [Cancel] [Confirm PAC] │
└─────────────────────────────────┘
```

### 5.7 SlashCommandMenu Additions

In patient thread channels, new "Surgery" section:

| Command | Action |
|---------|--------|
| Post Surgery | Opens surgery posting wizard pre-filled with patient data |
| OT Status | Posts readiness summary as system message |
| Confirm PAC | Opens PAC bottom sheet (anaesthesiologists only) |
| Add Specialist Clearance | Opens clearance add form (anaesthesiologists only) |
| Add Equipment | Opens equipment add form |

These are **secondary entry points** — every action is also reachable via tappable buttons in the Surgery Panel or OT Items view. Slash commands are shortcuts for power users, not the primary workflow.

---

## 6. GetStream Integration

### 6.1 New Channel: `#ot-schedule`
- **Type**: `cross-functional` (existing channel type — NO new type created)
- **Channel ID**: `ot-schedule`
- **Members**: IP coordinators, OT coordinator (Naveen), all anaesthesiologists, nursing leads, billing leads (Mohan), supply chain (Yogendra), GM (V)
- Seeded via existing `/api/admin/getstream/seed-channels` (add to seed list)

### 6.2 System Messages

**On surgery posting:**
```
🔵 NEW SURGERY POSTED
B/L TKR — Dr. Harish Puranik — OT 1
Fri 4 Apr 2026, 07:00 | Clean | SA
Readiness: 0/18 items confirmed
Posted by Tamanna
```

**On PAC confirmation:**
```
✅ PAC Cleared — Dr. Manukumar
ASA II | Fit for SA
Specialist clearances: Cardiology (AS Grade II)
B/L TKR — Dr. Harish — OT 1, Fri 4 Apr 07:00
```

**On readiness status change to "ready":**
```
🟢 SURGERY READY — All items confirmed
B/L TKR — Dr. Harish — OT 1, Fri 4 Apr 07:00
18/18 items green ✅
```

**On escalation:**
```
🔴 ESCALATION: Implant not confirmed
B/L TKR — Dr. Harish — OT 1, Fri 4 Apr 07:00
Item: "Implant Available & Verified" — 2h overdue
Escalated to: Yogendra (Supply Chain Head)
```

**On bulk confirm:**
```
✅ Naveen confirmed 4 logistics items
B/L TKR — Dr. Harish — OT 1, Fri 4 Apr 07:00
CSSD Instruments ✓ | OT Equipment ✓ | Consumables ✓ | OT Team Assigned ✓
```

---

## 7. Seed Data

### Known Surgeons
```typescript
export const KNOWN_SURGEONS = [
  { name: 'Dr. Poornima Parasuraman', specialty: 'General Surgery' },
  { name: 'Dr. Sajeet Nayar', specialty: 'General Surgery' },
  { name: 'Dr. Anil Mehta', specialty: 'General Surgery' },
  { name: 'Dr. Harish Puranik', specialty: 'Orthopaedics' },
  { name: 'Dr. Prajwal', specialty: 'Orthopaedics' },
  { name: 'Dr. Avinash', specialty: 'Orthopaedics' },
  { name: 'Dr. Karthik', specialty: 'Orthopaedics / Neurosurgery' },
  { name: 'Dr. Rakesh', specialty: 'Orthopaedics' },
  { name: 'Dr. Prabhudev Solanki', specialty: 'General Surgery' },
  { name: 'Dr. Animesh Banerjee', specialty: 'ENT' },
  { name: 'Dr. Uday Ravi', specialty: 'Urology / Proctology' },
  { name: 'Dr. Vishal Naik', specialty: 'Urology' },
  { name: 'Dr. Harsh', specialty: 'Vascular Surgery' },
  { name: 'Dr. Prem', specialty: 'Urology' },
  { name: 'Dr. Amaresh', specialty: 'Neurosurgery' },
  { name: 'Dr. Priyanka', specialty: 'General Surgery' },
  { name: 'Dr. Sujay', specialty: 'General Surgery / Proctology' },
];

export const KNOWN_ANAESTHESIOLOGISTS = [
  { name: 'Dr. Manukumar', role: 'Head of Anaesthesia' },
  { name: 'Dr. Jeevashri', role: 'Anaesthesiologist' },
  { name: 'Dr. Shilpa', role: 'Intensivist / Anaesthesiologist' },
  { name: 'Dr. Shashank', role: 'Anaesthesiologist' },
  { name: 'Dr. Trishi', role: 'Anaesthesiologist' },
];

export const COMMON_PROCEDURES = [
  'Unilateral TKR', 'Bilateral TKR', 'Total Hip Replacement',
  'Arthroscopic ACL Reconstruction', 'Implant Removal',
  'Deformity Correction', 'ORIF', 'DHS Fixation',
  'Laparoscopic Cholecystectomy', 'Lap B/L Inguinal Hernia + Mesh Repair',
  'Lap Appendicectomy', 'ERCP', 'Laparoscopic Fundoplication',
  'Sebaceous Cyst Excision', 'Lipoma Excision',
  'Laser Haemorrhoidectomy', 'Fissurectomy', 'Fistulectomy',
  'Laser Sphincterotomy', 'EUA + Haemorrhoidectomy',
  'Circumcision', 'Stapler Circumcision', 'TURP', 'URS + RIRS',
  'Septoplasty', 'Adenotonsillectomy', 'FESS',
  'B/L EVLT', 'Varicose Vein Surgery',
  'Craniotomy', 'Decompression + Fixation',
];
```

---

## 8. Build Phases

### Phase OT.1 — Database + Core API + Procedure Defaults
- Migration: 4 new tables + triggers + indexes
- `src/lib/ot/procedure-defaults.ts` — smart suggestion engine
- `src/lib/ot/readiness-template.ts` — template + conditional logic
- `src/lib/ot/readiness-status.ts` — status computation + color maps
- `src/lib/ot/surgery-postings.ts` — core business logic
- API routes: `/api/ot/postings` (CRUD), `/api/ot/readiness` (confirm/flag/add/mine/bulk-confirm/overdue), `/api/ot/equipment` (update)
- Seed `#ot-schedule` GetStream channel (cross-functional type)
- Types in `src/types/index.ts`
- Deprecate `surgery_posting` from `FORMS_BY_STAGE.pre_op`

### Phase OT.2 — PatientDetailView Surgery Panel + PAC Bottom Sheet
- Surgery panel component (collapsed + expanded states)
- Readiness donut chart component (reusable)
- Accordion category sections with role-aware auto-expand
- Tap-to-confirm inline dialogs
- PAC confirmation bottom sheet (standalone component)
- Role-gated action buttons
- Role-aware equipment display (simplified vs. full detail)
- System messages to patient thread on all actions

### Phase OT.3 — OT Schedule Dashboard + Tasks Integration + Action Banner
- `/ot-schedule` page (responsive: 3-column desktop, single-scroll mobile)
- Case cards with readiness donut charts
- Date navigation, stats header, sequencing warnings
- Empty state messaging
- Surgery posting wizard (3-step, mobile-first)
- Tasks tab: new "OT Items" sub-tab with action-first cards
- Bulk confirm for coordinators
- Patients tab: OT action banner
- Merge OT overdue items into existing Overdue sub-tab
- Badge count integration (add OT overdue to existing Tasks badge)

### Phase OT.4 — Chat Integration + Escalation + Onboarding
- SlashCommandMenu: surgery section (Post Surgery, OT Status, Confirm PAC, Add Clearance, Add Equipment)
- System messages to `#ot-schedule` channel
- Escalation cron endpoint
- Daily digest cron
- Stale posting cleanup cron
- Contextual "?" tooltips on first use
- Empty state messages throughout

### Phase OT.5 — Polish + Equipment Vendor Workflow
- Equipment status tracking UI for SCM users (full vendor detail)
- Push notifications for readiness item assignments
- Surgery posting wizard autocomplete polish (fuzzy matching)
- Wound class sequencing validation on save (warn if infected before clean)
- OT dashboard: drag-to-reorder case slots (desktop only)

---

## 9. Permissions

| Action | Roles Allowed |
|--------|--------------|
| Create surgery posting | ip_coordinator, ot_coordinator, super_admin, department_head |
| Edit surgery posting | posting creator, ot_coordinator, super_admin |
| Cancel / postpone | posting creator, ot_coordinator, super_admin |
| Confirm readiness item | user matching item's responsible_role |
| Bulk confirm items | user matching items' responsible_role (all items must be same role) |
| Flag / block item | any authenticated user |
| Mark item N/A | posting creator, ot_coordinator, super_admin |
| Add specialist clearance | anaesthesiologist |
| Add equipment item | ip_coordinator, ot_coordinator, supply_chain |
| Update equipment status | supply_chain, ot_coordinator |
| Confirm PAC (with ASA) | anaesthesiologist |
| View OT schedule | all authenticated users |
| Trigger manual escalation | ot_coordinator, ip_coordinator, super_admin |

---

## 10. Cron Jobs

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Escalation check | Every 30 min, 06:00–20:00 IST | `POST /api/ot/escalation/check` |
| Daily digest | 06:00 IST | `POST /api/ot/schedule/digest` |
| Stale cleanup | 22:00 IST | `POST /api/ot/postings/cleanup` |

---

## 11. Existing System Impact Checklist

This section explicitly confirms what is NOT touched by this build.

| System | Impact | Details |
|--------|--------|---------|
| AppShell tabs | **NONE** | No new bottom tabs. `TabId` union unchanged. |
| AppShell history state | **NONE** | `{ tab, patientId, _rounds: true }` format untouched. |
| PatientDetailView tabs | **NONE** | `DetailTab` stays `'overview' \| 'files'`. Surgery panel is a new section within overview. |
| Existing panels (Discharge, Insurance) | **NONE** | Conditional render pattern preserved. Surgery panel added alongside. |
| Inline edit endpoints | **NONE** | `/api/patients/{id}/fields`, `/stage`, `/pac-status`, `/discharge` all untouched. |
| `readiness_items` table | **NONE** | OT uses separate `ot_readiness_items` table. No FK conflicts, no shared queries. |
| `form_submissions` table | **NONE** | Surgery posting is NOT a form submission. No new form types added. |
| FormSchema / FormRenderer | **NONE** | No changes to validation, rendering, or completion scoring. |
| `FORMS_BY_STAGE` | **MINOR** | Remove `'surgery_posting'` from `pre_op` array. Schema definition kept for backwards compat. |
| `VALID_TRANSITIONS` | **NONE** | Stage transition logic untouched. |
| TasksView existing sub-tabs | **NONE** | Briefing, Overdue, Escalations continue to work. OT Items is additive. OT overdue MERGED into existing Overdue. |
| Tasks badge count | **ADDITIVE** | OT overdue count ADDED to existing count. Existing count logic untouched. |
| SlashCommandMenu | **ADDITIVE** | New "Surgery" section added. Existing sections (Forms, Stage, Discharge, Insurance, Archive) untouched. New `onSurgeryAction` callback added alongside existing callbacks. |
| GetStream channel types | **NONE** | All 5 types untouched. `#ot-schedule` uses existing `cross-functional` type. |
| GetStream system bot | **NONE** | Reuses existing `rounds-system` bot for OT system messages. |
| Billing integration | **READ-ONLY** | OT billing clearance item reads `insurance_claims` status. No writes to billing tables. |
| Admin pages | **ADDITIVE** | Quick-action link added to admin dashboard. All existing pages untouched. |
| Auth / permissions | **NONE** | Uses existing `getCurrentUser()` + role check pattern. No new auth mechanisms. |

---

## 12. Connection to Existing Billing Integration

The `billing_clearance` readiness item connects to the billing system built in Phases B.1–B.5:
- When billing staff view the item, it shows the patient's insurance claim status alongside (if active claim exists)
- If pre-auth is approved in `insurance_claims`, the item shows "Pre-auth approved: ₹X" as helper text
- This is a DISPLAY connection, not a hard dependency. Billing readiness is still manually confirmed.
- No writes to `insurance_claims`, `claim_events`, or `discharge_milestones`.

---

## 13. Future Integrations (Not in this build)

- **PAC import from external system**: API endpoint to receive PAC data and auto-confirm
- **KareXpert integration**: Pull investigation results to auto-check `investigations_complete`
- **OT utilization analytics**: Cases per OT, turnaround time, cancellation rates, readiness TAT
- **Surgeon scheduling**: Calendar-based availability management
- **WHO Safety Checklist**: Intra-operative checklist (separate module, runs after this)
- **Pharmacy phase split**: Break pharmacy into pre-op/intra-op/post-op when workflow is understood
