# Rounds — Thread Carryover Context Seed

**Purpose**: Paste this at the start of a new thread to restore full build context for continuing Rounds development. This captures everything a new session needs to pick up where we left off.

**Last updated**: 2 April 2026
**Current state**: Steps 0–9.4 + Billing Integration (Phases 1–5) ALL COMPLETE. OT Surgery Readiness PRD v2 complete, ready for build (OT.1–OT.5). Phase 10 (Files + Patient Tabs) specified in PRD addendum, not yet built.

---

## 1. What Is Rounds?

Rounds is an AI-organized hospital communication and patient workflow platform for Even Hospital Race Course Road (EHRC). It replaces both WhatsApp (staff messaging) and Slack (cross-department coordination) with structured patient-journey tracking, native forms at every handoff point, and phased AI integration.

**User**: V (Vinay Bhardwaj) — Hospital Product Manager & GM at EHRC, neurologist by training, now in an operations-heavy role. Prefers clarifying questions first, everything clickable with drill-down, Indian number notation (Cr/L/K).

---

## 2. Architecture

**Stack**: Next.js 14 (App Router) + Neon Serverless Postgres + GetStream Chat + Vercel

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + Tailwind CSS 3 | Custom chat UI, no stream-chat-react |
| Messaging | GetStream Chat (`stream-chat` v9.38) | 5 channel types, 25 seeded channels (→26 after OT build) |
| Database | Neon PostgreSQL (`@neondatabase/serverless`) | 21 tables (→25 after OT migration), HTTP driver (no multi-statement) |
| Auth | Custom JWT (`jose` v6 + `bcryptjs`) | Email + 4-digit PIN, NOT NextAuth/OAuth |
| Hosting | Vercel (project: `rounds-sqxh`) | Auto-deploy from `main` branch |
| AI | Local Ollama via Cloudflare Tunnel | `openai` npm SDK → `LLM_BASE_URL` |

**Repo**: https://github.com/vinaybhardwaj-commits/rounds
**Live URL**: https://rounds-sqxh.vercel.app
**GitHub PAT** (expires 28 Apr 2026): See Cowork auto-memory — not committed to repo

---

## 3. Critical Patterns — Read Before Writing Any Code

### JWT Payload
```typescript
// CRITICAL: The field is `profileId`, NOT `id`
type JWTPayload = { profileId: string; email: string; role: string; status: string }
```
Every route that calls `getCurrentUser()` from `src/lib/auth.ts` gets this shape. Do NOT destructure as `id`.

### Neon HTTP Driver Limitation
The `@neondatabase/serverless` HTTP driver **cannot execute multi-statement SQL**. Never send `CREATE TABLE ...; CREATE INDEX ...;` in one call. Each statement must be a separate `sql()` invocation.

### GetStream Token Bridge
Custom JWT → server generates GetStream token → client connects via WebSocket:
```
Login → /api/auth/login (returns stream_token) → ChatProvider connects StreamChat client
```

### AppShell Pattern (Step 6.2 + 6.2b)
The app entry point is `AppShell`, NOT `ChatPage`. AppShell has a two-layer architecture:
- **AppShell** (outer): wraps `ChatProvider`, provides context
- **AppShellInner** (inner): consumes `useChatContext` for unread badge counts, manages tabs + patient detail view

**ChatShell is ALWAYS mounted** (uses CSS `hidden` class) to keep GetStream WebSocket alive across tab switches. Never conditionally render ChatShell.

```
page.tsx → AppShell → ChatProvider → AppShellInner
                                      ├── PatientDetailView   (when selectedPatientId set)
                                      ├── PatientsView        (default tab)
                                      ├── ChatShell           (always mounted, hidden when inactive)
                                      ├── FormsView           (standalone form-centric module)
                                      ├── TasksView           (with Briefing/Overdue/Escalations tabs)
                                      ├── ProfileView
                                      └── BottomTabBar        (5 tabs, badges: unread chat + overdue tasks)
```

### LLM Integration Pattern
All AI calls go through `src/lib/llm.ts` which creates a shared OpenAI client pointed at Ollama via Cloudflare Tunnel:
```typescript
import llm, { MODEL_PRIMARY } from './llm';
const response = await llm.chat.completions.create({ model: MODEL_PRIMARY, ... });
```
- `LLM_BASE_URL` env var controls the endpoint (defaults to `http://localhost:11434/v1`)
- Two models: `qwen2.5:14b` (complex), `llama3.1:8b` (fast)
- All AI functions in `src/lib/ai.ts` return typed interfaces and cache results in `ai_analysis` table

### ChatShell uses h-full, NOT h-screen
ChatShell lives inside AppShell's flex layout. It must use `h-full` to fill its container. Using `h-screen` would cause it to overflow past the bottom tab bar.

### Insurance Claims — EVENT_STATUS_MAP Pattern
All claim status transitions are driven by a single `EVENT_STATUS_MAP` in `src/lib/insurance-claims.ts`. The function `logClaimEvent()` is the ONLY entry point for mutating insurance claims — it inserts an immutable event row, looks up the new status from the map, and updates the claim in one transaction.

### Form Post-Submission Hooks
`/api/forms` POST has two non-fatal hooks after form submission:
1. **Financial counseling → claim bridge**: When `financial_counseling` + `payment_mode === 'insurance'`, creates/updates insurance claim with room rent eligibility, proportional deduction risk, and billing fields.
2. **Feedback attribution**: When `post_discharge_followup` is submitted, calls `calculateMilestoneAttribution()` and merges attribution data into the form's JSONB.
Both hooks are try/catch wrapped — form submission succeeds even if the hook fails.

### Billing Business Constants
```typescript
ROOM_RENT_ELIGIBILITY_PCT = { standard: 0.01, icu: 0.015 } // 1% / 1.5% of sum insured
IRDA_TAT = { pre_auth: 480, final_approval: 240, follow_up_alert: 180 } // minutes
DEFAULT_ENHANCEMENT_THRESHOLD = 50000 // ₹50K gap triggers alert
```

### OT Surgery Readiness — Key Patterns (PRD complete, build pending)
- **Surgery posting is a first-class entity** — writes to `surgery_postings` table, NOT `form_submissions`. The old `surgery_posting` form type is deprecated.
- **OT readiness items are separate from `readiness_items`** — uses `ot_readiness_items` (different table, different FK to `surgery_postings`, different statuses including `blocked`, has audit log).
- **`#ot-schedule` channel uses existing `cross-functional` type** — no new GetStream channel type.
- **Progressive disclosure** — Surgery Panel collapsed by default, readiness categories are accordions, equipment detail is role-gated.
- **Action-first pattern** — OT Items sub-tab in Tasks shows items with one-tap Confirm buttons. Banner on Patients tab when user has pending items.
- **3-step posting wizard** — Patient+Procedure → Team+Schedule → Review+Post. Only 7 required fields. Smart defaults from `PROCEDURE_DEFAULTS` map.
- **PAC bottom sheet** — standalone component invocable from OT Items (1 tap), Surgery Panel button, or slash command. All three → same component.
- **Bulk confirm** — `/api/ot/readiness/bulk-confirm` endpoint. Audit log action = `'bulk_confirmed'`. Single status recompute after all updates.
- **Role-aware equipment display** — SCM/OT coordinator see full vendor+ETA detail. Others see green/yellow/red status dots. Display logic, not data model separation.
- **Full PRD**: `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md`
- **Context seed**: `docs/context-seeds/2026-04-02-ot-surgery-readiness-prd-v2.md`

### Auto-Deploy
Push to `main` → Vercel auto-builds and deploys. No manual deployment needed. Build takes ~60 seconds.

### Git Push Auth
Remote must be set with PAT:
```bash
git remote set-url origin https://x-access-token:<PAT>@github.com/vinaybhardwaj-commits/rounds.git
```

---

## 4. Env Vars (set in Vercel dashboard)

| Variable | Value/Notes | Status |
|----------|------------|--------|
| `POSTGRES_URL` | Neon connection string | ✅ Set |
| `JWT_SECRET` | HMAC signing key | ✅ Set |
| `NEXT_PUBLIC_GETSTREAM_API_KEY` | `ekbhy4vctj9g` | ✅ Set |
| `GETSTREAM_API_SECRET` | GetStream server-side secret | ✅ Set |
| `CRON_SECRET` | Auth for `/api/escalation/cron` | ✅ Set |
| `LLM_BASE_URL` | Cloudflare Tunnel URL for Ollama (`https://llm.yourdomain.com/v1`) | ⏳ Needs tunnel setup |
| `LLM_API_KEY` | Placeholder (`ollama`) | ⏳ Needs setting |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key | ⏳ Needs setting |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key | ⏳ Needs setting |
| `NEXTAUTH_URL` | **Legacy** — not functional. Clean up eventually. | 🧹 |

---

## 5. Database Schema (21 tables → 25 after OT migration)

### Original 8 tables (Steps 0–1):
- `profiles` — staff accounts (id UUID, email, full_name, role, status, department_id, PIN hash)
- `departments` — 19 EHRC departments (id, name, slug, head_profile_id) — added Marketing & Administration in Step 9
- `login_pins` — PIN hashes linked to profiles
- `user_sessions` — JWT session tracking
- `pending_approvals` — signup approval queue
- `api_keys` — API key management
- `audit_log` — action audit trail
- `_migrations` — migration version tracking

### v5 tables (Step 3.1 — 6 tables):
- `patient_threads` — patient → Rounds lifecycle link, **11 stages**: opd, pre_admission, admitted, pre_op, surgery, post_op, discharge, post_discharge, medical_management, post_op_care, long_term_followup. Also has `pac_status` column (telemed_pac_pending, inpatient_pac_pending, telemed_pac_passed, inpatient_pac_passed)
- `form_submissions` — JSONB form data, 13 form types, version tracking, completion_score, ai_gap_report
- `readiness_items` — individual checklist items (per form), status: pending/confirmed/flagged/na, escalation_level, sla_deadline
- `escalation_log` — escalation events with 4-level chain, resolved flag, notes
- `admission_tracker` — 42-column enriched admission record covering full Patient Journey v2
- `duty_roster` — shift-based duty with override support, resolves "who's on duty now?"

### Step 7-8 tables (2 tables):
- `push_subscriptions` — web push subscription data (profile_id, endpoint, subscription_json)
- `ai_analysis` — cached AI analysis results (analysis_type, source_id, source_type, result JSONB, model, token_count)

### Step 9 tables (1 table):
- `patient_changelog` — immutable change audit trail per patient (patient_thread_id, changed_by, field_name, old_value, new_value, change_type, metadata JSONB). 3 indexes: patient_thread_id, changed_by, created_at DESC

### Billing Integration tables (3 tables, added 2 Apr 2026):
- `insurance_claims` — 40+ column claim lifecycle tracking: insurer/TPA, room rent eligibility, proportional deduction, pre-auth/enhancement/final amounts + TATs, recovery rate, revenue leakage. Linked to patient_threads + admission_tracker.
- `claim_events` — immutable event log with 24 event types (ClaimEventType). Each event has type, description, amount, portal_reference, document_urls, performer info. Append-only — claim_status on insurance_claims is the derived "current state".
- `discharge_milestones` — 9-step discharge tracking: discharge_ordered → pharmacy_clearance → lab_clearance → discharge_summary → billing_closure → final_bill_submitted → final_approval → patient_settled → patient_departed. Per-step timestamps + TAT columns + bottleneck identification.
- `admission_tracker` extended with 8 billing columns: insurance_claim_id, insurer_name, submission_channel, sum_insured, room_rent_eligibility, proportional_deduction_risk, running_bill_amount, cumulative_approved_amount, enhancement_alert_threshold (default ₹50K)

### OT Surgery Readiness tables (4 tables, PRD complete, migration pending):
- `surgery_postings` — one row per posted surgery. Required: patient_name, procedure_name, procedure_side, primary_surgeon_name, anaesthesiologist_name, scheduled_date, ot_room. Progressive: wound_class, anaesthesia_type, scrub_nurse, etc. Flags: implant_required, blood_required, is_insured → drive conditional readiness items. PAC: asa_score, is_high_risk. Status: posted → confirmed → in_progress → completed | cancelled | postponed.
- `ot_readiness_items` — auto-generated from 22-item conditional template. 7 categories: clinical, financial, logistics, nursing, team, specialist_clearance, equipment. Status: pending/confirmed/not_applicable/flagged/blocked. Escalation: due_by, escalation_level 0/1/2. UNIQUE(surgery_posting_id, item_key). FK to surgery_postings CASCADE.
- `ot_readiness_audit_log` — immutable log of every status change. Actions: created, confirmed, flagged, blocked, escalated, reset, marked_na, added, bulk_confirmed.
- `ot_equipment_items` — structured tracking for implants, rental equipment, special instruments, consumables. Status: requested → vendor_confirmed → in_transit → delivered → in_ot → verified → returned. Vendor details, ETA, rental cost. FK to surgery_postings CASCADE + parent ot_readiness_items.

### 13 Form Types:
marketing_cc_handoff, admission_advice, financial_counseling (v2: 6 sections with TPA/room rent/deduction data), ot_billing_clearance, admission_checklist, surgery_posting, pre_op_nursing_checklist, who_safety_checklist, nursing_shift_handoff, discharge_readiness, post_discharge_followup (v2: 5 segmented discharge ratings), daily_department_update, pac_clearance

---

## 6. GetStream Configuration

- **Org**: EHRC | **App ID**: 1563440 | **Region**: US Ohio
- **API Key** (public): `ekbhy4vctj9g`
- **5 Channel Types**: department, cross-functional, patient-thread, direct, ops-broadcast
- **25 Seeded Channels** (→26 after OT build): 19 department + 5 cross-functional (ops-daily-huddle, admission-coordination, discharge-coordination, surgery-coordination, emergency-escalation) + 1 broadcast (hospital-broadcast). OT build adds: `#ot-schedule` (cross-functional type).
- **Auto-join on login**: Users auto-added to `hospital-broadcast` + their department channel
- **Patient channels**: `pt-{first8chars-of-uuid}`, auto-created with members on patient thread creation

---

## 7. API Routes (66 route files total → ~82 after OT build)

### Auth (5 routes):
- `POST /api/auth/login` — email+PIN → JWT cookie + GetStream token + auto-join channels
- `POST /api/auth/signup` — create profile (pending approval), blocks duplicate signups with status-specific messages
- `POST /api/auth/logout` — clear session cookie
- `GET /api/auth/me` — return current user from JWT
- `GET /api/auth/stream-token` — generate fresh GetStream user token

### Admin (6 routes):
- `GET/PATCH /api/admin/approvals` — list pending, approve/reject
- `POST /api/admin/getstream/setup` — one-time: create 5 channel types + system bot
- `POST /api/admin/getstream/seed-channels` — seed 25 channels (idempotent)
- `POST /api/admin/migrate` — execute v5 DB migration (idempotent)
- `GET /api/admin/changelog` — list all non-archived patients for changelog view
- `GET /api/admin/changelog/[patientId]` — merged timeline (DB changelog + form submissions + GetStream messages) for fishbone view

### Data (4 routes):
- `GET /api/departments` — list all departments
- `GET /api/profiles` — list profiles with filters
- `POST /api/profiles/import` — CSV bulk import
- `POST /api/webhooks/getstream` — GetStream event webhook

### Patient Workflow (16+ routes):
- `GET/POST /api/patients` — list (stage+dept filters, include_archived param) / create patient thread (auto-creates GetStream channel)
- `GET/PATCH /api/patients/[id]` — get (with form history) / partial update
- `PATCH /api/patients/[id]/stage` — stage transition with validation, channel update, member auto-add, changelog logging
- `PATCH /api/patients/[id]/fields` — inline field editing (uhid, ip_number, consulting_doctor, department_id) with changelog logging
- `PATCH /api/patients/[id]/pac-status` — PAC status update with changelog logging
- `GET/POST/PATCH /api/patients/[id]/claim` — insurance claim lifecycle (get+timeline+summary / create / log event)
- `GET/POST/PATCH /api/patients/[id]/discharge` — discharge milestones (status / start / advance step)
- `GET/POST/PATCH /api/patients/[id]/enhance` — enhancement (status / doctor case summary / update running bill)
- `GET/POST /api/forms` — list / submit form (server validation, readiness auto-gen, dual chat posting, financial counseling→claim hook, feedback attribution hook)
- `GET /api/forms/[id]` — get form + readiness items + aggregate
- `GET /api/readiness/[formId]` — readiness items for a form
- `PATCH /api/readiness/items/[itemId]` — confirm/flag readiness item
- `GET /api/readiness/overdue` — all overdue readiness items (used by TasksView badge)
- `GET /api/admission-tracker` + `POST` — list active admissions / create new admission

### Billing (4 routes):
- `POST /api/billing/roomcalc` — room rent eligibility calculator (sumInsured, roomCategory → eligibility, deduction %, recommendation)
- `GET/POST /api/billing/check-enhancements` — scan all patients for threshold breach (GET=dry run, POST=fire alerts)
- `GET /api/billing/metrics` — full BI dashboard (revenue, speed, satisfaction) with `?from=&to=` date filters
- `GET /api/billing/insurer-performance` — per-insurer benchmarks with date filters

### OT Surgery Readiness (16 routes — PRD complete, build pending):
- `POST/GET /api/ot/postings` — create (+ auto-generate readiness items + apply procedure defaults) / list
- `GET/PATCH/DELETE /api/ot/postings/[id]` — get (+items+equipment) / update / soft cancel
- `PATCH /api/ot/readiness/[item_id]` — confirm, flag, block, mark N/A, reset
- `POST /api/ot/readiness/add` — add dynamic item (specialist clearance or equipment)
- `GET /api/ot/readiness/mine` — my pending items (role-filtered, supports `?count_only=true`)
- `POST /api/ot/readiness/bulk-confirm` — bulk confirm multiple items (coordinators)
- `GET /api/ot/readiness/overdue` — overdue OT items (merged into Tasks overdue view)
- `PATCH /api/ot/equipment/[id]` — update equipment status
- `GET /api/ot/schedule` — daily schedule (?date, ?range=week, ?ot_room)
- `GET /api/ot/schedule/stats` — summary stats for dashboard header
- `POST /api/ot/escalation/check` — cron: check overdue, escalate
- `POST /api/ot/schedule/digest` — cron: 6 AM daily summary
- `POST /api/ot/postings/cleanup` — cron: stale posting cleanup

### Duty Roster (4 routes):
- `GET/POST /api/duty-roster` — list / create (admin-only)
- `DELETE /api/duty-roster/[id]` — remove entry (admin-only)
- `GET /api/duty-roster/resolve?department_id=X&role=Y` — resolve current on-duty
- `POST /api/duty-roster/handoff` — send shift handoff message to department channel

### Escalation (2 routes):
- `POST /api/escalation/cron` — automated 4-level escalation runner (CRON_SECRET or super_admin)
- `GET/PATCH /api/escalation/log` — list escalations (filter by resolved/source_type) / resolve with notes

### Push Notifications (3 routes):
- `GET /api/push/vapid-key` — return public VAPID key for client subscription
- `POST /api/push/subscribe` — store push subscription for current user
- `POST /api/push/send` — send push notification (admin-only)

### AI (3 routes):
- `POST /api/ai/gap-analysis` — analyze form submission for gaps and risks
- `GET /api/ai/briefing` — generate daily morning briefing
- `POST /api/ai/predict` — predict patient outcomes (LOS, discharge readiness, escalation risk)

---

## 8. UI Structure

### Main App (after login):
```
AppShell (outer, wraps ChatProvider)
└── AppShellInner (inner, consumes useChatContext for badges)
    ├── PatientDetailView (when selectedPatientId set)
    │   ├── Stage progress bar (11 stages)
    │   ├── "Advance Stage" button
    │   ├── Inline editable fields (UHID, IP Number, Doctor, Department)
    │   ├── PAC Status selector (4 states)
    │   ├── Form history with GapAnalysisCard links
    │   ├── Insurance Claim panel (status, financials grid, risk indicators, TATs, timeline)
    │   ├── Surgery Panel [OT — build pending] (collapsed summary + expanded accordion, readiness donut, role-gated actions, PAC bottom sheet)
    │   ├── Discharge Progress panel (9-step milestone tracker)
    │   ├── PredictionCard (AI: LOS, discharge readiness, risk)
    │   └── "Open Channel" link
    ├── Patients Tab (default) — PatientsView.tsx
    │   ├── OT Action Banner [OT — build pending] ("3 OT items need your action" → links to Tasks > OT Items)
    │   ├── Search bar
    │   ├── Stage filter pills (scrollable)
    │   ├── Patient cards (stage-colored left border)
    │   └── FAB → Create Patient modal
    ├── Chat Tab — ChatShell.tsx (always mounted)
    │   ├── ChannelSidebar (category-grouped)
    │   └── MessageArea (reactions, files, threads, form cards, slash commands, actionable system messages)
    ├── Forms Tab — FormsView.tsx (standalone form-centric module)
    │   ├── Form list (13 types, searchable, grouped by stage)
    │   ├── Patient picker (searchable by name/UHID/IP/department)
    │   ├── Form fill (FormRenderer + stage mismatch warning)
    │   └── Success screen (Submit Another / View Submitted)
    ├── Tasks Tab — TasksView.tsx
    │   ├── Briefing sub-tab (AI daily briefing — default)
    │   ├── OT Items sub-tab [OT — build pending] (action-first cards, one-tap confirm, bulk confirm for coordinators)
    │   ├── Overdue Items sub-tab (+ merged OT overdue items)
    │   └── Escalations sub-tab (+ merged OT escalations)
    ├── Me Tab — ProfileView.tsx
    │   ├── Profile card
    │   ├── Admin Dashboard link (admin only)
    │   └── Log Out
    └── BottomTabBar (5 tabs, badges: unread chat count + overdue tasks count)
```

### Admin Pages (7 + OT Dashboard at top-level):

**Top-level pages (not admin-gated):**
- `/ot-schedule` [OT — build pending] — OT Schedule Dashboard: 3-column desktop / single-scroll mobile, case cards with readiness donuts, date navigation, sequencing warnings, "+ Post Surgery" wizard
- `/admin` — Dashboard: user stats, roster count, open escalations, active admissions, quick actions (including Patient Changelog link)
- `/admin/admissions` — 3-tab: Stage Board (Kanban), Surgery Schedule, Discharge Readiness
- `/admin/changelog` — Patient Changelog: searchable patient list + fishbone timeline (horizontal desktop / vertical mobile) merging DB changelog, form submissions, and GetStream messages
- `/admin/duty-roster` — Table + Create modal + Handoff notifications
- `/admin/escalations` — Card list + Run Check button + Resolve modal
- `/admin/approvals` — Approve/reject signups
- `/admin/profiles` — Staff management + CSV import

### Form Pages:
- `/forms` — Form type picker grouped by patient journey stage
- `/forms/new` — Schema-driven renderer with validation + draft/submit
- `/forms/[id]` — Read-only view with readiness tracker

---

## 9. Build Progress Summary

| Step | Description | Status | Commit |
|------|------------|--------|--------|
| 0.1 | Project scaffold | ✅ Done | `2bc0609` |
| 0.2 | Custom auth (email+PIN) | ✅ Done | `b16b794` |
| 1.1 | Admin dashboard | ✅ Done | `b16b794` |
| 2.1 | GetStream foundation + token bridge | ✅ Done | `2d0ff9e` |
| 2.2 | Channel types + seed 23 channels | ✅ Done | `cdf57cd` |
| 2.3 | Chat UI shell (sidebar, messages) | ✅ Done | `7186689` |
| 2.4 | DMs, search, threading, reactions, files | ✅ Done | `1ada67c` |
| 3.1 | v5 database tables (6 tables, 30+ indexes) | ✅ Done | `f6f1d68` |
| 3.2 | API routes (10 files, 5 resource types) | ✅ Done | `3f34bc8` |
| 4.1 | Form Engine Core (registry, renderer, validation) | ✅ Done | `66efcff` |
| 4.2 | Form-in-Chat + View Page | ✅ Done | `ab637f4` |
| 4.3 | Form field enrichment (310 fields, 83 readiness) | ✅ Done | `8ca94f3` |
| 5.1 | Patient Thread + Channel Auto-Creation | ✅ Done | `19a8f7c` |
| 5.2 | Duty Roster UI + Shift Handoff | ✅ Done | `3161581` |
| 5.3 | Escalation Engine (4-level chain) | ✅ Done | `99677d5` |
| 6.1 | Admission Tracker (3-view dashboard) | ✅ Done | `0ab86ce` |
| 6.2 | UX Redesign (bottom tab bar) | ✅ Done | `f9044b1` |
| 6.2b | Deferred UX items (PatientDetail, slash cmds, badges) | ✅ Done | `558e49e` |
| 7.1 | PWA (offline, push notifications, install prompt) | ✅ Done | `3992add` |
| 8.1 | AI gap analysis (Ollama via Cloudflare Tunnel) | ✅ Done | `3992add`+`244d584` |
| 8.2 | AI daily briefing | ✅ Done | `3992add`+`244d584` |
| 8.3 | Predictive intelligence | ✅ Done | `3992add`+`244d584` |
| 9.1 | Departments & roles expansion (19 depts, 20 roles) | ✅ Done | `ccf9625` |
| 9.2 | Patient detail enhancements (inline edit, 11 stages, PAC, changelog) | ✅ Done | `ccf9625`+`9353cdb`+`610534e` |
| 9.3 | Admin Changelog page (fishbone timeline) | ✅ Done | `ccf9625` |
| 9.4 | Standalone Forms module (5th bottom tab, dual chat posting) | ✅ Done | `3eee752` |
| B.1 | Discharge timeline tracker (9-step milestones + TATs) | ✅ Done | `3108e0f` |
| B.1.5 | Billing DB migration (3 tables + admission_tracker extensions) | ✅ Done | `534332d` |
| B.2 | Insurance claim lifecycle tracker (24 events, STATUS_MAP) | ✅ Done | `530d2d9` |
| B.3 | Financial counseling enhancement + room rent calculator | ✅ Done | `b0ce33b` |
| B.4 | Enhancement alert system (auto-detect threshold breach) | ✅ Done | `d6258d6` |
| B.5 | Feedback attribution + billing intelligence dashboard | ✅ Done | `d1fc4d3` |
| OT PRD | OT Surgery Readiness PRD v1 + v2 (UX revision) | ✅ Done | `b66bb61`+`0bc214d` |
| OT.1 | Database + Core API + Procedure Defaults | ⏳ Next | — |
| OT.2 | PatientDetailView Surgery Panel + PAC Bottom Sheet | ⏳ Pending | — |
| OT.3 | OT Schedule Dashboard + Tasks Integration + Banner + Wizard | ⏳ Pending | — |
| OT.4 | Chat Integration + Escalation + Onboarding | ⏳ Pending | — |
| OT.5 | Polish + Equipment Vendor Workflow | ⏳ Pending | — |

---

## 10. Remaining Deferred Items & Setup Tasks

### Infrastructure (before AI features work live):
- **Cloudflare Tunnel**: Set up `cloudflared` on Mac Mini M4 Pro, create tunnel pointing to `localhost:11434`, get public URL
- **Ollama models**: Pull `qwen2.5:14b` and `llama3.1:8b` on Mac Mini
- **Vercel env vars**: Set `LLM_BASE_URL`, `LLM_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- **DB migration**: Run `/api/admin/migrate` to create `push_subscriptions` and `ai_analysis` tables

### From earlier steps:
- **Superuser PIN**: Still `1234`. Change via Neon SQL Editor.
- **Signup rate limiting**: Not implemented. Low priority for internal app.
- **Billing-coordination channel**: Identified gap from Patient Journey v2. Not yet in GetStream.
- **`NEXTAUTH_URL` cleanup**: Legacy env var still referenced in code.
- **Test data cleanup**: "Test Patient Alpha" in production DB.
- **Stage-aware nudges**: Banner in patient channels suggesting next required form (deferred from 6.2b).

### Billing Integration follow-ups:
- **Billing dashboard UI**: `/api/billing/metrics` and `/api/billing/insurer-performance` endpoints exist but have no frontend. Could build "Billing Intelligence" admin page.
- **Enhancement cron**: `/api/billing/check-enhancements` is manual. Add to Vercel cron for periodic scanning.
- **Monthly summary auto-post**: Design doc specifies monthly department channel summaries — not yet built.
- **Billing design doc**: `ROUNDS-BILLING-INTEGRATION-DESIGN.md` was created in a prior thread but may not be in the repo. Context seed at `docs/context-seeds/2026-04-02-billing-integration-phases-1-5.md` captures all decisions.

### OT Surgery Readiness (PRD complete, build next):
- **Build OT.1–OT.5**: See `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md` for full spec
- **Context seed**: `docs/context-seeds/2026-04-02-ot-surgery-readiness-prd-v2.md`
- **4 new tables**: surgery_postings, ot_readiness_items, ot_readiness_audit_log, ot_equipment_items
- **16 new API routes** under `/api/ot/`
- **Key files to create**: `src/lib/ot/procedure-defaults.ts`, `readiness-template.ts`, `readiness-status.ts`, `surgery-postings.ts`
- **UI components**: SurgeryPanel, ReadinessDonut, PACBottomSheet, OTDashboard, SurgeryWizard, OTItemsTab, OTActionBanner
- **FORMS_BY_STAGE change**: remove `surgery_posting` from `pre_op` (keep schema for backwards compat)

### Phase 10 — PRD Addendum (specified, not yet built):
Full PRD document at `Rounds-PRD-Addendum-Insurance-Files-Tabs.docx`. Note: Phase 10b (Insurance Module) was partially superseded by the Billing Integration — the claim lifecycle, TPA workflow, and event tracking are already built. Phase 10 now primarily covers:
1. **Foundation** (Phase 10a): `files` + `patient_files` tables, Vercel Blob storage, tabbed PatientDetailView (Overview | Files | Insurance), file upload/download/link UI
2. **Insurance Module** (Phase 10b): `insurance_policies` + `patient_insurance` tables for policy-level management (separate from claim-level tracking which is done). Policy details UI.
3. **Chat-to-Files** (Phase 10c): Auto-link chat file attachments to patient's file store
4. **AI Enhancements** (Phase 10d): AI-powered file analysis, insurance document parsing, auto-tagging

---

## 11. Key Personnel Context

- **IP Coordinators**: Tamanna & Kavya — SPOF for admission workflows
- **OT Coordinator**: Naveen Kumar — surgery scheduling
- **Customer Care**: Lavanya — marketing→admission handoff
- **AM**: Dr. Ankita Priya
- **V's boss**: Richa — uses dashboard on mobile, provides UI/UX feedback
- **Three EMR silos**: Even App (teleconsult), Pulse (OPD-only), KareXpert (IP HIS) — no auto-sync. Rounds runs parallel.

---

## 12. File Tree (~141 source files → ~170+ after OT build)

```
middleware.ts                              — Edge auth middleware
public/
├── sw.js                                  — Service worker (precache, offline, push)
├── manifest.json                          — PWA manifest
├── icon-192.png, icon-512.png             — PWA icons
├── apple-touch-icon.png, favicon.ico      — Apple/browser icons
src/
├── app/
│   ├── layout.tsx, page.tsx               — Root layout (+ SW reg, InstallPrompt) + AppShell entry
│   ├── offline/page.tsx                   — PWA offline fallback
│   ├── admin/                             — Admin dashboard (7 pages)
│   │   ├── page.tsx                       — Admin home (stats + quick actions + changelog link)
│   │   ├── admissions/page.tsx            — Admission tracker (3-tab)
│   │   ├── changelog/page.tsx             — Patient Changelog with fishbone timeline (~460 lines)
│   │   ├── duty-roster/page.tsx           — Roster CRUD + handoff
│   │   ├── escalations/page.tsx           — Escalation log + resolve
│   │   ├── approvals/page.tsx             — User approvals
│   │   └── profiles/, users/, departments/ — Staff management
│   ├── ot-schedule/page.tsx               — [OT — pending] Top-level OT dashboard
│   ├── auth/                              — Login, signup, pending (3 pages)
│   ├── forms/                             — Form picker, new, [id] view (3 pages)
│   └── api/                               — 66 API route files → ~82 after OT (see section 7)
│       ├── admin/{approvals, getstream/setup, getstream/seed-channels, migrate, changelog, changelog/[patientId]}
│       ├── auth/{login, logout, me, signup, stream-token}
│       ├── {departments, profiles, profiles/import, profiles/me, webhooks/getstream}
│       ├── patients/, patients/[id]/, patients/[id]/{stage,fields,pac-status,claim,discharge,enhance,files}
│       ├── patients/{archive,form-status,import}
│       ├── forms/, forms/[id]/
│       ├── readiness/{[formId],items/[itemId],overdue,completed}
│       ├── admission-tracker/
│       ├── billing/{roomcalc,check-enhancements,metrics,insurer-performance}
│       ├── ot/                            — [OT — pending] 16 route files
│       │   ├── postings/, postings/[id]/, postings/cleanup/
│       │   ├── readiness/{[item_id],add,mine,bulk-confirm,overdue}
│       │   ├── equipment/[id]/
│       │   ├── schedule/, schedule/{stats,digest}
│       │   └── escalation/check/
│       ├── duty-roster/, duty-roster/{[id],resolve,handoff}
│       ├── escalation/{cron,log}
│       ├── push/{vapid-key,subscribe,send}
│       └── ai/{gap-analysis,briefing,predict}
├── components/
│   ├── AppShell.tsx                       — Main app wrapper (outer + inner for GetStream badges)
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── ai/                                — GapAnalysisCard, DailyBriefing, PredictionCard
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea (+SlashCommandMenu with insurance claims + enhancement actions), ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge
│   ├── forms/                             — FormRenderer, FormCard, FormsView (~500 lines, standalone form-centric module)
│   ├── layout/                            — AuthProvider, Header, Sidebar, BottomTabBar (5 tabs)
│   ├── patients/                          — PatientsView, PatientDetailView (inline edit, PAC status, 11 stages)
│   ├── profile/                           — ProfileView
│   ├── pwa/                               — InstallPrompt, ServiceWorkerRegistration
│   ├── ot/                                — [OT — pending] SurgeryPanel, ReadinessDonut, PACBottomSheet, OTDashboard, SurgeryWizard, CaseCard, OTActionBanner, etc.
│   └── tasks/                             — TasksView (Briefing/OT Items/Overdue/Escalations tabs)
├── lib/
│   ├── auth.ts                            — JWT create/verify, getCurrentUser
│   ├── db.ts                              — Neon SQL helpers (original)
│   ├── db-v5.ts                           — v5 CRUD helpers (817+ lines, includes changelog functions)
│   ├── form-registry.ts                   — 13 form schemas (1,645 lines, FORMS_BY_STAGE for 11 stages)
│   ├── getstream.ts                       — Server client + helpers (236 lines)
│   ├── getstream-setup.ts                 — Channel type definitions
│   ├── llm.ts                             — OpenAI SDK client → Ollama via Cloudflare Tunnel
│   ├── ai.ts                              — AI functions (gap analysis, briefing, predictions)
│   ├── push.ts                            — web-push helpers (sendPushToUser, broadcast)
│   ├── patient-activity.ts                — Dual-post patient activity to thread + department
│   ├── discharge-milestones.ts            — 9-step discharge tracking with TAT calculation (420 lines)
│   ├── insurance-claims.ts                — Claim lifecycle, EVENT_STATUS_MAP, system messages (692 lines)
│   ├── enhancement-alerts.ts              — Auto-detect threshold breach, fire alerts (286 lines)
│   ├── billing-metrics.ts                 — Revenue/speed/satisfaction BI aggregations (539 lines)
│   └── ot/                                — [OT — pending]
│       ├── procedure-defaults.ts          — 26 procedure→defaults mappings + fuzzy matcher
│       ├── readiness-template.ts          — 22-item conditional readiness template
│       ├── readiness-status.ts            — Status computation + color maps
│       └── surgery-postings.ts            — Core business logic (create, update, cancel, recompute)
├── providers/
│   └── ChatProvider.tsx                   — GetStream StreamChat client wrapper
└── types/
    └── index.ts                           — Shared TypeScript types (expanded with PAC status, 11 stages, changelog types)
```

---

## 13. Dependencies (production)

```json
{
  "@neondatabase/serverless": "^0.10.4",
  "bcryptjs": "^2.4.3",
  "csv-parse": "^5.6.0",
  "jose": "^6.2.2",
  "lucide-react": "^0.460.0",
  "next": "14.2.35",
  "openai": "^4.x",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "stream-chat": "^9.38.0",
  "web-push": "^3.x"
}
```

---

## 14. How to Resume Development

```bash
# Clone and setup
git clone https://github.com/vinaybhardwaj-commits/rounds.git
cd rounds
npm install

# Set env vars (get from Vercel dashboard)
# POSTGRES_URL, JWT_SECRET, NEXT_PUBLIC_GETSTREAM_API_KEY, GETSTREAM_API_SECRET, CRON_SECRET

# Build check
npx next build

# Push pattern (PAT auth)
git remote set-url origin https://x-access-token:<PAT>@github.com/vinaybhardwaj-commits/rounds.git
git push origin main
```

**Login for testing**:
```bash
curl -c /tmp/cookies.txt -X POST https://rounds-sqxh.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vinay.bhardwaj@even.in","pin":"1234"}'
```

**Super admin profile ID**: `eaa39589-7305-4047-b94e-cda0025c2fed`

---

## 15. Instruction to AI Assistant

You are continuing work on the Rounds app. **Steps 0–9.4 + Billing Integration (Phases 1–5) are ALL complete. OT Surgery Readiness PRD v2 is complete and ready for build (OT.1–OT.5). Phase 10 (Files + Patient Tabs) is specified in a PRD addendum but not yet built.**

The user (V) prefers:
- Ask clarifying questions before starting work
- Never truncate metric labels on mobile
- All info card items must be clickable to source data
- Use Indian number notation (Cr/L/K) where applicable
- ChatShell must ALWAYS stay mounted (hidden class, not conditional render)
- Use `h-full` not `h-screen` inside AppShell's tab layout
- AI uses local Ollama via Cloudflare Tunnel (`src/lib/llm.ts`), NOT cloud APIs
- Forms data must be immutable once submitted — new submission rather than edit
- Insurance claim mutations go through `logClaimEvent()` only (single entry point)
- Form post-submission hooks are non-fatal (try/catch, form submission succeeds regardless)

Current focus areas:
1. **OT Surgery Readiness build**: Phase OT.1 is next (database + core API + procedure defaults). Full PRD at `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md`, context seed at `docs/context-seeds/2026-04-02-ot-surgery-readiness-prd-v2.md`.
2. **Billing testing**: Full insurance claim lifecycle test (counseling → pre-auth → enhancement → discharge → final → feedback → metrics)
3. **Billing dashboard UI**: Build admin page for `/api/billing/metrics` and `/api/billing/insurer-performance`
4. **Enhancement cron**: Add `/api/billing/check-enhancements` to Vercel cron
5. **Infrastructure**: Cloudflare Tunnel on Mac Mini, Vercel env vars for LLM + VAPID
6. **Phase 10**: Files + Patient Tabs — PRD addendum complete, build not started

Key OT files to read first:
- `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md` — Full PRD with 14 design decisions, data model, API routes, UI specs, build phases
- `docs/context-seeds/2026-04-02-ot-surgery-readiness-prd-v2.md` — Compact context seed with all key decisions and patterns

Key billing integration files:
- `src/lib/insurance-claims.ts` — Core claim logic, EVENT_STATUS_MAP, logClaimEvent()
- `src/lib/discharge-milestones.ts` — 9-step discharge tracking
- `src/lib/billing-metrics.ts` — BI aggregation layer
- `docs/context-seeds/2026-04-02-billing-integration-phases-1-5.md` — Full build context for all 5 phases

The build order document is at: `docs/ROUNDS-BUILD-ORDER.md`
The context seeds are at: `docs/context-seeds/`
The PRD addendum is at: `Rounds-PRD-Addendum-Insurance-Files-Tabs.docx` (in workspace folder)
