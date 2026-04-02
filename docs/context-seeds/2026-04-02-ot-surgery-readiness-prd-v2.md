# Context Seed: OT Surgery Readiness PRD v2

**Date**: 2 April 2026
**Scope**: Design and UX revision of the OT Surgery Readiness module
**PRD location**: `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md`
**Status**: PRD complete (v2), reviewed by V, ready for build
**Commits**: `b66bb61` (PRD v1), `0bc214d` (PRD v2 — UX revision)

---

## What Is This?

A comprehensive OT (operating theatre) scheduling and surgery readiness system for Rounds. Covers everything from posting a surgery to tracking 22 readiness items across 7 categories, equipment vendor workflows, PAC/ASA scoring, specialist clearances, and escalation.

**Why v2?** The v1 PRD had correct data models and APIs but failed a UI/UX adoptability review. V asked for a self-critique and the following 10 problems were identified and fixed:

1. Surgery Panel was a wall of text on mobile (22 items flat list)
2. "My OT Actions" buried in Tasks → sub-tab (4+ taps to find)
3. Posting form had 17+ required fields (abandonment risk)
4. OT Dashboard under `/admin/` but needed by all OT staff
5. Slash commands as primary workflow (power-user bias)
6. No smart defaults (users had to fill wound class, anaesthesia type manually)
7. Equipment detail shown to everyone (noise for non-SCM roles)
8. No bulk confirm for coordinators (21 individual confirms/day)
9. PAC confirmation nested 3 layers deep (dialog in panel in patient view)
10. No empty states or onboarding guidance

---

## 14 Design Decisions (D1–D14)

| # | Decision | Key Detail |
|---|----------|------------|
| D1 | Surgery in PatientDetailView + `/ot-schedule` as top-level route | NOT under /admin. Accessible to all authenticated users. |
| D2 | Dynamic specialist clearances post-PAC | Anaesthetist adds cardiology/nephrology/etc. as trackable items |
| D3 | Postable from any patient stage | Including leads/OPD — OT planning starts before admission |
| D4 | 4 new tables, NOT touching readiness_items | `surgery_postings`, `ot_readiness_items`, `ot_readiness_audit_log`, `ot_equipment_items` |
| D5 | ASA score during PAC confirmation | ASA III+ auto-triggers ICU bed + high-risk flag |
| D6 | Structured equipment + role-aware detail | SCM sees vendor/ETA; others see green/yellow/red dots |
| D7 | Single pharmacy item for v1 | Split later when workflow understood |
| D8 | Mobile: single scroll grouped by OT | Desktop: 3-column layout |
| D9 | Surgery posting is first-class entity | NOT a form_submission. Old `surgery_posting` form deprecated. |
| D10 | Progressive disclosure everywhere | Collapsed summary → expand for full checklist |
| D11 | Action-first "My OT Items" | Banner on Patients tab + sub-tab in Tasks. One-tap confirm. |
| D12 | 3-step posting wizard | 7 required fields. Smart procedure defaults. |
| D13 | PAC as standalone bottom sheet | Reachable from OT Items (1 tap), Surgery Panel, or slash command |
| D14 | Bulk confirm for coordinators | `/api/ot/readiness/bulk-confirm` endpoint |

---

## 4 New Database Tables

### `surgery_postings`
- Core entity: one row per posted surgery
- **Required fields at posting**: patient_name, procedure_name, procedure_side, primary_surgeon_name, anaesthesiologist_name, scheduled_date, ot_room
- **Progressive fields** (filled later): wound_class, anaesthesia_type, case_complexity, estimated_duration, scrub_nurse, circulating_nurse, ot_technician
- **Conditional flags**: implant_required, blood_required, is_insured → drive which readiness items are generated
- **PAC fields**: asa_score, asa_confirmed_by/at, pac_notes, is_high_risk
- **Status flow**: posted → confirmed → in_progress → completed | cancelled | postponed
- **Indexes**: scheduled_date, status (partial), ot_room+date, patient_thread_id

### `ot_readiness_items`
- Auto-generated from `OT_READINESS_TEMPLATE` (22 conditional items)
- Dynamic items added later (specialist clearances, equipment)
- **7 categories**: clinical, financial, logistics, nursing, team, specialist_clearance, equipment
- **Status**: pending, confirmed, not_applicable, flagged, blocked
- **Escalation**: due_by, escalated, escalation_level (0/1/2)
- **Unique constraint**: (surgery_posting_id, item_key)
- FK to surgery_postings (CASCADE)

### `ot_readiness_audit_log`
- Immutable log of every status change
- Actions: created, confirmed, flagged, blocked, escalated, reset, marked_na, added, bulk_confirmed
- FK to both readiness item and surgery posting

### `ot_equipment_items`
- Structured tracking for implants, rental equipment, special instruments, consumables
- **Status progression**: requested → vendor_confirmed → in_transit → delivered → in_ot → verified → returned
- Vendor details: name, contact, rental flag, cost estimate, delivery ETA
- FK to surgery_postings (CASCADE) + parent ot_readiness_items

---

## Procedure Defaults System

`src/lib/ot/procedure-defaults.ts` maps 26 common EHRC procedures to auto-suggested:
- wound_class, anaesthesia_type, post_op_destination, estimated_duration_minutes
- typically_requires_blood, typically_requires_implant

Examples: "Lap Chole" → Clean, GA, PACU, 60min, no blood, no implant. "B/L TKR" → Clean, SA, ICU, 210min, blood yes, implant yes.

`getProcedureDefaults(name)` does exact match then fuzzy substring match.

---

## 15 API Endpoints (5 groups)

### Surgery Posting CRUD (5):
- `POST /api/ot/postings` — Create + auto-generate readiness items + apply procedure defaults
- `GET /api/ot/postings` — List (filterable: date, ot_room, status, surgeon, patient_thread_id)
- `GET /api/ot/postings/[id]` — Get posting + all readiness items + equipment
- `PATCH /api/ot/postings/[id]` — Update (re-evaluate conditional items)
- `DELETE /api/ot/postings/[id]` — Soft cancel

### Readiness Item Actions (5):
- `PATCH /api/ot/readiness/[item_id]` — Confirm, flag, block, mark N/A, reset
- `POST /api/ot/readiness/add` — Add dynamic item (clearance or equipment)
- `GET /api/ot/readiness/mine` — My pending items (role-filtered)
- `GET /api/ot/readiness/mine?count_only=true` — Count for banner badge
- `POST /api/ot/readiness/bulk-confirm` — Bulk confirm (coordinators)
- `GET /api/ot/readiness/overdue` — Overdue OT items

### Equipment (1):
- `PATCH /api/ot/equipment/[id]` — Update equipment status

### OT Schedule Dashboard (2):
- `GET /api/ot/schedule` — Daily schedule (?date, ?range=week, ?ot_room)
- `GET /api/ot/schedule/stats` — Summary stats for header

### Escalation & Cron (3):
- `POST /api/ot/escalation/check` — Cron: check overdue, escalate
- `POST /api/ot/schedule/digest` — Cron: 6 AM daily summary to #ot-schedule
- `POST /api/ot/postings/cleanup` — Cron: stale posting cleanup at 10 PM

---

## New Files to Create (by build phase)

### Phase OT.1 — Database + Core API + Procedure Defaults
```
src/lib/ot/procedure-defaults.ts       — Procedure→defaults mapping + fuzzy matcher
src/lib/ot/readiness-template.ts       — 22-item conditional template
src/lib/ot/readiness-status.ts         — Status computation + color maps
src/lib/ot/surgery-postings.ts         — Core business logic (create, update, cancel, recompute)
src/app/api/ot/postings/route.ts       — POST + GET (list)
src/app/api/ot/postings/[id]/route.ts  — GET + PATCH + DELETE
src/app/api/ot/readiness/[item_id]/route.ts — PATCH (confirm/flag/block)
src/app/api/ot/readiness/add/route.ts  — POST (dynamic items)
src/app/api/ot/readiness/mine/route.ts — GET (my items)
src/app/api/ot/readiness/bulk-confirm/route.ts — POST
src/app/api/ot/readiness/overdue/route.ts — GET
src/app/api/ot/equipment/[id]/route.ts — PATCH
src/app/api/ot/schedule/route.ts       — GET (daily schedule)
src/app/api/ot/schedule/stats/route.ts — GET (stats)
src/app/api/ot/escalation/check/route.ts — POST (cron)
src/app/api/ot/schedule/digest/route.ts — POST (cron)
src/app/api/ot/postings/cleanup/route.ts — POST (cron)
```

### Phase OT.2 — PatientDetailView Surgery Panel + PAC Bottom Sheet
```
src/components/ot/SurgeryPanel.tsx         — Collapsed + expanded surgery panel
src/components/ot/ReadinessDonut.tsx        — Donut chart (reusable)
src/components/ot/ReadinessAccordion.tsx    — Category accordion with role-aware expand
src/components/ot/PACBottomSheet.tsx        — Standalone PAC confirmation
src/components/ot/AddClearanceForm.tsx      — Inline specialist clearance add
src/components/ot/AddEquipmentForm.tsx      — Inline equipment add
src/components/ot/EquipmentStatusBadge.tsx  — Role-aware simplified/full status
```

### Phase OT.3 — Dashboard + Tasks + Banner + Wizard
```
src/app/ot-schedule/page.tsx               — Top-level OT dashboard
src/components/ot/OTDashboard.tsx           — Responsive 3-col/single-scroll
src/components/ot/CaseCard.tsx              — Case card with readiness donut
src/components/ot/SurgeryWizard.tsx         — 3-step posting wizard
src/components/ot/OTActionBanner.tsx        — Banner for Patients tab
src/components/tasks/OTItemsTab.tsx         — Action-first OT items sub-tab
```

### Phase OT.4 — Chat + Escalation + Onboarding
- SlashCommandMenu updates (new Surgery section)
- Cron endpoint implementations
- Tooltip/onboarding components

### Phase OT.5 — Polish
- Equipment vendor detail UI for SCM
- Push notifications for assignments
- Drag-to-reorder (desktop OT dashboard)

---

## Existing System Impact Summary

| System | Impact |
|--------|--------|
| AppShell tabs (5) | NONE — no new bottom tabs |
| PatientDetailView | ADDITIVE — new Surgery panel alongside existing |
| readiness_items table | NONE — OT uses separate ot_readiness_items |
| form_submissions table | NONE — surgery posting is first-class entity |
| FORMS_BY_STAGE | MINOR — remove `surgery_posting` from `pre_op` |
| TasksView sub-tabs | ADDITIVE — new `ot_items` sub-tab |
| SlashCommandMenu | ADDITIVE — new Surgery section |
| GetStream channel types | NONE — `#ot-schedule` uses existing `cross-functional` |
| Billing integration | READ-ONLY cross-reference for billing clearance item |
| All admin pages | NONE — quick-action link added to admin dashboard |

---

## Key Architectural Patterns to Follow

1. **Surgery posting is NOT a form** — writes to `surgery_postings`, not `form_submissions`
2. **Readiness items are NOT `readiness_items`** — uses `ot_readiness_items` (different table, different FK, different statuses including `blocked`)
3. **All readiness mutations write audit log** — `ot_readiness_audit_log` is the immutable trail
4. **System messages use existing `sendSystemMessage()`** — same bot, same pattern
5. **`#ot-schedule` is a `cross-functional` channel** — no new channel type created
6. **Role-gating uses existing `getCurrentUser()` + role check** — no new auth mechanism
7. **PAC bottom sheet is a reusable component** — invocable from 3 entry points
8. **Equipment status is role-aware** — display logic, not data model separation
9. **Overdue OT items merge into existing Tasks badge count** — additive to existing `/api/readiness/overdue`

---

## Seed Data

- 17 surgeons (KNOWN_SURGEONS) with specialties
- 5 anaesthesiologists (KNOWN_ANAESTHESIOLOGISTS) with roles
- 30 common procedures (COMMON_PROCEDURES)
- 26 procedure defaults with wound class, anaesthesia, duration, blood/implant flags
- `#ot-schedule` GetStream channel seeded via existing seed endpoint

---

## Cron Jobs

| Job | Schedule | Endpoint |
|-----|----------|----------|
| OT Escalation check | Every 30 min, 06:00–20:00 IST | `POST /api/ot/escalation/check` |
| OT Daily digest | 06:00 IST | `POST /api/ot/schedule/digest` |
| Stale posting cleanup | 22:00 IST | `POST /api/ot/postings/cleanup` |
