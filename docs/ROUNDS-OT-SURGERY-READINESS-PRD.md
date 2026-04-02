# Rounds OT Surgery Readiness — Build PRD

**Author**: V + Claude (collaborative design)
**Date**: 2 April 2026
**Status**: Ready for build
**Base document**: `Rounds-M8-OT-Surgery-Readiness-PRD.md` (V's original PRD)
**This document**: Reconciles the original PRD with the current Rounds architecture (Steps 0–9.4 + Billing Integration B.1–B.5) and design decisions made in conversation.

---

## 0. Design Decisions (Locked In)

These decisions were made before writing this PRD and must not be revisited during build.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Surgery info lives inside **PatientDetailView** (not separate /ot pages). OT Schedule dashboard is an **admin page**. | No new bottom tabs. OT staff confirm items from patient view or Tasks tab. Naveen/coordinators use admin dashboard. |
| D2 | **Dynamic specialist clearances** — anaesthetist can add clearance requests post-PAC, each becomes a trackable readiness item. | Real-world PAC often triggers 2-3 specialist clearances that need independent tracking. |
| D3 | Surgery postable from **any patient stage** including leads/OPD. patient_thread_id and IP number are optional. | OT planning starts early — equipment rental, PAC scheduling, and team coordination happen before admission. |
| D4 | **New OT-specific tables** (surgery_postings, ot_readiness_items, ot_readiness_audit_log). No collision with existing readiness_items table. | OT readiness is fundamentally different from form-based readiness — needs audit trail, escalation levels, dynamic items. |
| D5 | **ASA score recorded during PAC confirmation**. ASA III+ auto-triggers ICU bed item and high-risk flag. | Anaesthetist is the only person who should assign ASA. Score determines downstream readiness requirements. |
| D6 | **Structured equipment tracking** — each item (implant, rental equipment) has vendor, status, ETA. | Equipment unavailability is the #1 same-day cancellation cause. Free-text doesn't cut it. |
| D7 | **Single pharmacy readiness item** for now. Can break into phases later. | Pharmacy workflow isn't well-enough understood yet. Start simple, add granularity with data. |
| D8 | **Mobile OT dashboard**: single scrollable list grouped by OT room. Desktop: 3-column layout from original PRD. | Mobile-first for OT staff who are always on their feet. |

---

## 1. How This Integrates Across the App

This is the most important section. OT Surgery Readiness isn't a standalone module — it touches every part of Rounds.

### Patient Tab (PatientDetailView)
- **New "Surgery" panel** appears after the Insurance Claim panel (or before it, depending on patient stage)
- Shows: procedure, surgeon, date, OT room, readiness progress bar, and each readiness item with status
- "Post Surgery" button: opens the surgery posting form inline or via the Forms tab
- If multiple surgeries are posted for a patient (e.g., staged procedures), shows them in chronological order
- Readiness items have confirm/flag/block actions directly in this view — anaesthetist taps the patient, sees their PAC item, confirms it with ASA score right there

### Chat Tab (SlashCommandMenu)
- New "/" commands in patient thread channels:
  - `/post-surgery` — opens surgery posting form pre-filled with patient data
  - `/ot-status` — posts a system message with current readiness summary for this patient's upcoming surgery
  - `/confirm-readiness [item]` — quick-confirm a specific readiness item from chat
- System messages auto-posted to patient thread when:
  - Surgery is posted
  - Readiness items are confirmed, flagged, or blocked
  - Escalation fires
  - All items confirmed (surgery ready)
- System messages auto-posted to `#ot-schedule` cross-functional channel (new channel, needs seeding):
  - New surgery posted (rich card with readiness progress)
  - Readiness status changes
  - Escalation alerts
  - Daily digest (6 AM cron)

### Forms Tab
- `surgery_posting` form type gets a MAJOR upgrade — becomes the OT posting form
- Accessible from Forms tab like any other form
- Patient picker → Surgery Posting Form → auto-generates readiness checklist
- Form fills the `surgery_postings` table (NOT the `form_submissions` table — this is a first-class entity, not a generic form)

### Tasks Tab
- New sub-tab: **"OT Items"** alongside Briefing / Overdue / Escalations
- Shows all readiness items assigned to the current user's role, grouped by surgery date
- Anaesthetist sees PAC items. Billing sees billing clearance items. Supply chain sees equipment items.
- Tapping an item → opens the patient's surgery detail where they can confirm/flag/block
- Overdue OT items also appear in the existing "Overdue" sub-tab (unified overdue view)

### Admin Section
- **New page: `/admin/ot-schedule`** — the OT Schedule Dashboard
  - Desktop: 3-column layout (OT 1 | OT 2 | OT 3) with case cards
  - Mobile: single scrollable list grouped by OT room
  - Date navigation (prev/next/calendar)
  - Header stats: total cases, ready/partial/not-ready/blocked counts
  - Sequencing warnings (infected before clean in same OT)
  - "+ Post Surgery" button
- Accessible to: all authenticated users (not just admins — Naveen, IP coordinators, anaesthetists all need this)
- Link from Admin dashboard quick actions

---

## 2. Data Model

### 2.1 New Tables

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

  -- Surgery details
  procedure_name VARCHAR(500) NOT NULL,
  procedure_side VARCHAR(20) NOT NULL, -- 'Left', 'Right', 'Bilateral', 'N/A', 'Midline'
  case_type VARCHAR(20) NOT NULL DEFAULT 'Elective', -- 'Elective', 'Emergency', 'Day Care'
  wound_class VARCHAR(20) NOT NULL, -- 'Clean', 'Clean-Contaminated', 'Dirty', 'Infected'
  case_complexity VARCHAR(20), -- 'Minor', 'Moderate', 'Major', 'Super-Major'
  estimated_duration_minutes INTEGER,
  anaesthesia_type VARCHAR(20) NOT NULL, -- 'GA', 'SA', 'Regional', 'LA', 'Block', 'Sedation'

  -- PAC & ASA (populated when anaesthetist confirms PAC)
  asa_score INTEGER, -- 1-6 (ASA Physical Status Classification)
  asa_confirmed_by UUID REFERENCES profiles(id),
  asa_confirmed_at TIMESTAMPTZ,
  pac_notes TEXT, -- anaesthetist's PAC summary notes
  is_high_risk BOOLEAN DEFAULT false, -- auto-set when ASA >= 3

  -- Team
  primary_surgeon_name VARCHAR(255) NOT NULL,
  primary_surgeon_id UUID REFERENCES profiles(id), -- nullable: VCs may not have Rounds accounts
  assistant_surgeon_name VARCHAR(255),
  anaesthesiologist_name VARCHAR(255) NOT NULL,
  anaesthesiologist_id UUID REFERENCES profiles(id),
  scrub_nurse_name VARCHAR(255),
  circulating_nurse_name VARCHAR(255),
  ot_technician_name VARCHAR(255),

  -- Scheduling
  scheduled_date DATE NOT NULL,
  scheduled_time TIME, -- nullable for "on call" or TBD cases
  ot_room INTEGER NOT NULL, -- 1, 2, or 3
  slot_order INTEGER, -- ordering within the OT for the day

  -- Post-op planning
  post_op_destination VARCHAR(20) NOT NULL DEFAULT 'PACU', -- 'PACU', 'ICU', 'Ward'
  icu_bed_required BOOLEAN DEFAULT false,

  -- Status
  overall_readiness VARCHAR(20) NOT NULL DEFAULT 'not_ready',
    -- 'not_ready', 'partial', 'ready', 'blocked'
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
    -- 'posted', 'confirmed', 'in_progress', 'completed', 'cancelled', 'postponed'
  cancellation_reason TEXT,
  postponed_to DATE, -- if postponed, the new target date

  -- Metadata
  posted_by UUID NOT NULL REFERENCES profiles(id),
  posted_via VARCHAR(20) DEFAULT 'form', -- 'form', 'slash_command', 'api', 'migration'
  getstream_message_id VARCHAR(255), -- the message card in #ot-schedule
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sp_date ON surgery_postings(scheduled_date);
CREATE INDEX idx_sp_status ON surgery_postings(status) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_sp_ot_date ON surgery_postings(ot_room, scheduled_date);
CREATE INDEX idx_sp_patient ON surgery_postings(patient_thread_id);
```

#### `ot_readiness_items`

Auto-generated from template when surgery is posted. Dynamic items (specialist clearances, equipment) can be added later.

```sql
CREATE TABLE ot_readiness_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,

  -- Item definition
  item_key VARCHAR(80) NOT NULL, -- machine key, e.g., 'pac_cleared', 'clearance_cardiology', 'equip_carm_1'
  item_label VARCHAR(255) NOT NULL, -- human label
  item_category VARCHAR(30) NOT NULL,
    -- 'clinical', 'financial', 'logistics', 'nursing', 'team', 'specialist_clearance', 'equipment'
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_dynamic BOOLEAN DEFAULT false, -- true for items added after initial posting (clearances, equipment)

  -- Responsibility
  responsible_role VARCHAR(50) NOT NULL,
  responsible_user_id UUID REFERENCES profiles(id), -- specific person if assigned
  responsible_user_name VARCHAR(255), -- display name (for VCs without Rounds accounts)

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending', 'confirmed', 'not_applicable', 'flagged', 'blocked'
  status_detail VARCHAR(500), -- e.g., "INR 2.1 — needs correction", "Vendor ETA 6pm"

  -- Confirmation
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_by_name VARCHAR(255),
  confirmed_at TIMESTAMPTZ,
  confirmation_notes TEXT,

  -- For PAC confirmation specifically
  asa_score_given INTEGER, -- only on pac_cleared item

  -- Escalation
  due_by TIMESTAMPTZ,
  escalated BOOLEAN NOT NULL DEFAULT false,
  escalated_at TIMESTAMPTZ,
  escalated_to UUID REFERENCES profiles(id),
  escalation_level INTEGER DEFAULT 0, -- 0=none, 1=dept head, 2=GM

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
    -- 'created', 'confirmed', 'flagged', 'blocked', 'escalated', 'reset', 'marked_na', 'added'
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

#### `ot_equipment_items`

Structured tracking for implants, rental equipment, and special instruments.

```sql
CREATE TABLE ot_equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_posting_id UUID NOT NULL REFERENCES surgery_postings(id) ON DELETE CASCADE,
  readiness_item_id UUID REFERENCES ot_readiness_items(id), -- links to the parent readiness item

  -- Equipment details
  item_type VARCHAR(30) NOT NULL, -- 'implant', 'rental_equipment', 'special_instrument', 'consumable'
  item_name VARCHAR(255) NOT NULL, -- e.g., "Smith & Nephew BHR Size 50", "C-Arm", "Harmonic Scalpel"
  item_description TEXT, -- additional details (size, model, specifications)
  quantity INTEGER DEFAULT 1,

  -- Vendor / source
  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(255), -- phone or email
  is_rental BOOLEAN DEFAULT false,
  rental_cost_estimate NUMERIC(10,2),

  -- Tracking
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

### 2.2 Readiness Checklist Template

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
  due_offset_hours: number; // hours before scheduled surgery time
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
  // physician_clearance NOT auto-generated — added dynamically by anaesthetist post-PAC
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
  // implant_available — auto-generated only if implant_required
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

### 2.3 Dynamic Item Types

These are NOT auto-generated from template. They are added by users after the posting is created.

#### Specialist Clearances (added by anaesthetist post-PAC)
When the anaesthetist confirms PAC and determines specialist clearances are needed, they add items like:
- `clearance_cardiology` — "Cardiology Clearance (Aortic Stenosis Grade II)"
- `clearance_nephrology` — "Nephrology Clearance (CKD Stage 3)"
- `clearance_pulmonology` — "Pulmonology Clearance (COPD)"

Each gets `item_category: 'specialist_clearance'`, `is_dynamic: true`, a `due_offset_hours` of 12, and the responsible_role set to the relevant specialty.

#### Equipment Items (added by IP coordinator, OT coordinator, or supply chain)
When equipment is identified as needed, users add structured equipment via the `ot_equipment_items` table. Each equipment item links to a parent readiness item:
- `equip_carm_1` — "C-Arm (Rental)" → tracks vendor, delivery status, ETA
- `equip_implant_thr_1` — "Smith & Nephew BHR Femoral Size 50" → tracks availability, verification

### 2.4 ASA Score Flow

1. Surgery is posted. `pac_cleared` readiness item is auto-generated (unless LA case).
2. Anaesthetist does PAC (outside Rounds for now — in person or via KareXpert).
3. Anaesthetist opens the patient in Rounds → Surgery panel → taps "Confirm PAC".
4. Confirmation dialog asks for:
   - **ASA Score** (required, select 1-6)
   - **PAC Notes** (text, e.g., "Fit for GA. Normal investigations. No comorbidities.")
   - **Specialist clearances needed?** (toggle)
     - If yes: add one or more clearance requests (specialty + reason)
5. On confirm:
   - `pac_cleared` item → status = 'confirmed', asa_score_given = N
   - `surgery_postings.asa_score` = N, `asa_confirmed_by`, `asa_confirmed_at` set
   - If ASA >= 3: `surgery_postings.is_high_risk` = true
   - If ASA >= 3 AND `icu_bed_required` was false: auto-create `icu_bed_booked` readiness item
   - For each specialist clearance requested: create dynamic readiness item
   - Post system message to patient thread: "✅ PAC Cleared by Dr. Manukumar — ASA II. No specialist clearances needed."
   - Or: "✅ PAC Cleared by Dr. Manukumar — ASA III (High Risk). Cardiology clearance requested."

### 2.5 Readiness Status Computation

Same as original PRD:
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

## 3. API Routes

### 3.1 Surgery Posting CRUD

```
POST   /api/ot/postings              — Create posting + auto-generate readiness items
GET    /api/ot/postings              — List (filterable: date, ot_room, status, surgeon, patient_thread_id)
GET    /api/ot/postings/[id]         — Get posting + all readiness items + equipment items
PATCH  /api/ot/postings/[id]         — Update details (re-evaluate conditional readiness items)
DELETE /api/ot/postings/[id]         — Soft cancel (status → 'cancelled')
```

**Side effects on POST:**
1. Generate readiness items from `OT_READINESS_TEMPLATE` (conditional logic applied)
2. Compute `due_by` for each item: `scheduled_date + scheduled_time - due_offset_hours`
3. If `patient_thread_id` is null and there's a matching patient by UHID: link it
4. If `patient_thread_id` is null and no match: optionally auto-create patient thread
5. Post rich card message to `#ot-schedule` GetStream channel
6. If patient thread exists: post system message to patient thread
7. Recompute `overall_readiness`

### 3.2 Readiness Item Actions

```
PATCH  /api/ot/readiness/[item_id]   — Confirm, flag, block, mark N/A, or reset
POST   /api/ot/readiness/add         — Add dynamic item (specialist clearance or equipment)
GET    /api/ot/readiness/mine        — My pending items across all surgeries (role-filtered)
```

**PATCH side effects:**
1. Write to `ot_readiness_audit_log`
2. Recompute `overall_readiness` on parent `surgery_postings`
3. If PAC confirmation: update ASA fields, trigger dynamic items
4. Post system message to patient thread (if exists) and `#ot-schedule`
5. If flagged/blocked: push notify posting creator + OT coordinator
6. If all confirmed (ready): push notify OT coordinator + surgeon

**POST /api/ot/readiness/add** body:
```typescript
{
  surgery_posting_id: string;
  item_type: 'specialist_clearance' | 'equipment';
  // For specialist clearances:
  specialty?: string; // 'cardiology', 'nephrology', etc.
  reason?: string;    // 'AS Grade II', 'CKD Stage 3', etc.
  // For equipment:
  equipment?: {
    item_type: 'implant' | 'rental_equipment' | 'special_instrument' | 'consumable';
    item_name: string;
    vendor_name?: string;
    is_rental?: boolean;
    quantity?: number;
  };
}
```

### 3.3 Equipment Tracking

```
PATCH  /api/ot/equipment/[id]        — Update equipment status (vendor_confirmed, in_transit, delivered, etc.)
```

### 3.4 OT Schedule Dashboard

```
GET    /api/ot/schedule               — Daily schedule (default: today)
  ?date=YYYY-MM-DD
  ?range=week
  ?ot_room=1|2|3
GET    /api/ot/schedule/stats         — Summary stats for dashboard header
```

### 3.5 Escalation & Cron

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

## 4. UI Changes

### 4.1 PatientDetailView — Surgery Panel

New panel between Discharge Progress and Insurance Claim panels. Shows for any patient with an active surgery posting.

```
UPCOMING SURGERY ─────────────────────────
  B/L TKR — Dr. Harish Puranik
  Fri 4 Apr 2026, 07:00 — OT 1
  Clean | SA | Moderate | ASA II

  Readiness ████████░░ 14/18                    ● Partial
  ─────────────────────────────────────────
  CLINICAL
    ✅ PAC Cleared (ASA II) — Dr. Manukumar, 2 Apr 14:30
    ✅ Investigations Complete — Dr. Manukumar, 2 Apr 14:30
    ⏳ Surgical Consent — assigned to Dr. Harish [due in 6h]
    ⏳ Surgical Site Marking — assigned to Dr. Harish [due in 2h]

  SPECIALIST CLEARANCES
    ✅ Cardiology (AS Grade II) — Dr. Reddy, 3 Apr 10:00
    ⏳ Nephrology (CKD Stage 3) — pending [due in 8h]

  FINANCIAL
    ✅ Billing Clearance — Mohan, 2 Apr 11:00
    ✅ Deposit Confirmed — Mohan, 2 Apr 11:00

  LOGISTICS
    ⏳ CSSD Instruments — Naveen [due in 4h]
    ✅ OT Equipment — Naveen, 3 Apr 16:00
    🚫 Implant — FLAGGED: "Size 6 not available. Size 5 confirmed."
    ⏳ Consumables — Naveen [due in 4h]
    ✅ Pharmacy Ready — Pharmacy, 3 Apr 15:00

  EQUIPMENT TRACKING
    Smith & Nephew BHR Size 50 ── vendor_confirmed ── ETA: 3 Apr 18:00
    C-Arm (Rental) ── delivered ── Verified by Naveen

  NURSING
    ⏳ Patient NBM — nursing [due in 2h]
    ...

  TEAM
    ✅ Surgeon Confirmed — Tamanna, 2 Apr 16:00
    ✅ Anaesthetist Confirmed — Tamanna, 2 Apr 16:00
    ⏳ OT Team Assigned — Naveen [due in 4h]
  ─────────────────────────────────────────
  [Confirm PAC] [Add Clearance] [Add Equipment] [Edit Posting]
```

Action buttons are role-gated:
- "Confirm PAC" visible only to anaesthesiologists (when PAC is pending)
- "Add Clearance" visible only to anaesthesiologists
- "Add Equipment" visible to IP coordinators, OT coordinators, supply chain
- "Edit Posting" visible to posting creator, OT coordinator, GM

Individual readiness items have tap-to-confirm: when the responsible person taps a pending item, a confirmation dialog opens.

### 4.2 Admin OT Schedule Dashboard (`/admin/ot-schedule`)

**Desktop (3-column):**
```
┌──────────────────────────────────────────────────────────┐
│  OT Schedule — [< Prev] Wed, 2 Apr 2026 [Next >] [📅]   │
│  7 cases │ ●3 Ready │ ●2 Partial │ ●1 Not Ready │ ●1 Blocked │
│                                              [+ Post Surgery] │
├──────────────────┬──────────────────┬──────────────────┤
│    OT 1 (3)      │    OT 2 (2)      │    OT 3 (2)      │
│  case cards...   │  case cards...   │  case cards...   │
└──────────────────┴──────────────────┴──────────────────┘
│ ⚠ OT 1: Infected case (Slot 3) before Clean (Slot 4)    │
└──────────────────────────────────────────────────────────┘
```

**Mobile (single scroll):**
```
OT Schedule — Wed, 2 Apr 2026
7 cases │ ●3 ●2 ●1 ●1              [+ Post]

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
- Time + readiness dot (green/orange/red/red-pulse)
- Procedure name + side
- Primary surgeon
- Wound class badge + anaesthesia type + ASA badge (if confirmed)
- High-risk indicator (🔴 if ASA ≥ 3)
- Progress bar: confirmed / total active items
- Tap → opens PatientDetailView if patient_thread_id exists, else opens posting detail

### 4.3 Tasks Tab — OT Items Sub-tab

New sub-tab in TasksView: **Briefing | OT Items | Overdue | Escalations**

Shows readiness items assigned to the current user's role, grouped by surgery date:

```
── Tomorrow, 4 Apr 2026 ──────────
  B/L TKR — Dr. Harish — OT 1, 07:00
    ⏳ PAC Completed & Clearance Given     [Confirm]

  Lap Chole — Dr. Sajeet — OT 2, 09:00
    ⏳ PAC Completed & Clearance Given     [Confirm]

── Sat, 5 Apr 2026 ──────────
  THR — Dr. Avinash — OT 3, 08:00
    ⏳ Investigations Complete              [Confirm]
```

### 4.4 SlashCommandMenu Additions

In patient thread channels, new commands under "Surgery" section:

| Command | Action |
|---------|--------|
| Post Surgery | Opens surgery posting form pre-filled with patient data |
| OT Status | Posts readiness summary as system message |
| Confirm PAC | Opens PAC confirmation dialog (anaesthetists only) |
| Add Specialist Clearance | Add a clearance request (anaesthetists only) |
| Add Equipment | Add equipment item to the surgery |

---

## 5. GetStream Integration

### 5.1 New Channel: `ot-schedule`
- **Type**: `cross-functional`
- **Channel ID**: `ot-schedule`
- **Members**: IP coordinators, OT coordinator (Naveen), all anaesthesiologists, nursing leads, billing leads (Mohan), supply chain (Yogendra), GM (V)
- Must be seeded via `/api/admin/getstream/seed-channels` (add to existing seed list)

### 5.2 System Messages

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

---

## 6. Seed Data

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

## 7. Build Phases

### Phase OT.1 — Database + Core API
- Migration: 4 new tables (surgery_postings, ot_readiness_items, ot_readiness_audit_log, ot_equipment_items) + triggers + indexes
- `src/lib/ot/readiness-template.ts` — template + conditional logic
- `src/lib/ot/readiness-status.ts` — status computation + color maps
- `src/lib/ot/surgery-postings.ts` — core business logic (create, update, cancel, readiness recompute)
- API routes: `/api/ot/postings` (CRUD), `/api/ot/readiness` (confirm/flag/add), `/api/ot/equipment` (update)
- Seed `#ot-schedule` GetStream channel
- Types in `src/types/index.ts`

### Phase OT.2 — PatientDetailView Surgery Panel
- Surgery panel component in PatientDetailView
- Readiness item list with tap-to-confirm
- PAC confirmation dialog with ASA score + specialist clearance flow
- Equipment tracking display
- Add Equipment / Add Clearance modals
- System messages to patient thread on all actions

### Phase OT.3 — OT Schedule Dashboard + Tasks Integration
- `/admin/ot-schedule` page (responsive: 3-column desktop, single-scroll mobile)
- Case cards with readiness progress bars
- Date navigation, stats header, sequencing warnings
- Tasks tab: new "OT Items" sub-tab
- System messages to `#ot-schedule` channel

### Phase OT.4 — Chat Integration + Escalation
- SlashCommandMenu: surgery commands (Post Surgery, OT Status, Confirm PAC, Add Clearance, Add Equipment)
- Escalation cron endpoint
- Daily digest cron
- Stale posting cleanup cron

### Phase OT.5 — Polish + Equipment Vendor Workflow
- Equipment status tracking UI (vendor confirmed → in transit → delivered → verified)
- Push notifications for readiness item assignments
- Surgery posting form autocomplete (procedures, surgeons, anaesthetists)
- Wound class sequencing validation on save

---

## 8. Permissions

| Action | Roles Allowed |
|--------|--------------|
| Create surgery posting | ip_coordinator, ot_coordinator, super_admin, department_head |
| Edit surgery posting | posting creator, ot_coordinator, super_admin |
| Cancel / postpone | posting creator, ot_coordinator, super_admin |
| Confirm readiness item | user matching item's responsible_role |
| Flag / block item | any authenticated user |
| Mark item N/A | posting creator, ot_coordinator, super_admin |
| Add specialist clearance | anaesthesiologist |
| Add equipment item | ip_coordinator, ot_coordinator, supply_chain |
| Update equipment status | supply_chain, ot_coordinator |
| Confirm PAC (with ASA) | anaesthesiologist |
| View OT schedule | all authenticated users |
| Trigger manual escalation | ot_coordinator, ip_coordinator, super_admin |

---

## 9. Cron Jobs

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Escalation check | Every 30 min, 06:00–20:00 IST | `POST /api/ot/escalation/check` |
| Daily digest | 06:00 IST | `POST /api/ot/schedule/digest` |
| Stale cleanup | 22:00 IST | `POST /api/ot/postings/cleanup` |

---

## 10. Connection to Existing Billing Integration

The `billing_clearance` readiness item connects to the billing system built in Phases B.1–B.5:
- When billing staff confirms the readiness item, they can reference the insurance claim status
- If the patient has an active insurance claim in `insurance_claims`, the readiness item can auto-check: is pre-auth approved? If yes, auto-suggest confirmation.
- The billing clearance confirmation can include the approved amount and any co-pay/deduction info
- This is a DISPLAY connection, not a hard dependency. Billing readiness is still manually confirmed — the system just shows the claim status alongside the item to help the billing person decide.

---

## 11. Future Integrations (Not in this build)

- **PAC import from external system**: API endpoint to receive PAC data from the anaesthesia system and auto-confirm the `pac_cleared` readiness item with ASA score
- **KareXpert integration**: Pull investigation results to auto-check `investigations_complete`
- **OT utilization analytics**: Cases per OT, turnaround time, cancellation rates, readiness TAT
- **Surgeon scheduling**: Calendar-based availability management
- **WHO Safety Checklist**: Intra-operative checklist (separate module, runs after this)
