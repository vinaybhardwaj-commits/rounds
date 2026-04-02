# Rounds Build Order — Status Tracker

**Last updated**: 2 April 2026 (OT Surgery Readiness PRD v2 complete — ready for build)
**Repo**: https://github.com/vinaybhardwaj-commits/rounds
**Live**: https://rounds-sqxh.vercel.app
**Latest commit**: `0bc214d` — OT Surgery Readiness PRD v2 with UX/adoptability improvements

---

## Phase 1: Foundation (Steps 0–1)

### Step 0.1 — Project Scaffold ✅
**Commit**: `2bc0609` scaffold: Phase 1 Week 1-2
- Next.js 14 (App Router), Tailwind CSS 3, Neon Serverless Postgres
- Vercel project `rounds-sqxh` created, auto-deploy from `main`
- **Deviation**: Originally used `@vercel/postgres`, migrated to `@neondatabase/serverless` (commit `9b9bbae`)

### Step 0.2 — Auth System ✅
**Commit**: `b16b794` replace NextAuth with custom JWT auth
- **Major deviation**: Google OAuth via NextAuth.js v5 was the original plan. Pivoted to custom email + 4-digit PIN auth because V doesn't have Google Workspace admin access.
- Stack: `jose` for JWT, `bcryptjs` for PIN hashing, HTTP-only cookie `rounds_session`
- JWT payload: `{ profileId, email, role, status }` — CRITICAL: uses `profileId` not `id`
- Edge middleware (`middleware.ts`) at project root: verifies JWT, blocks inactive users, gates `/admin` to `super_admin`/`department_head`
- Login, signup, logout, /auth/pending pages
- Superuser account created (PIN: 1234 — **still needs changing via Neon SQL Editor**)

**Deferred from Step 0**:
- Change superuser PIN from 1234
- Signup rate limiting

### Step 1.1 — Admin Dashboard ✅
**Part of commit**: `b16b794`
- Admin panel at `/admin` with sub-pages: approvals, users, departments, profiles
- CSV import for bulk staff onboarding (`/admin/profiles/import`)
- Approval workflow: signup → pending → admin approves → active
- 17 EHRC departments seeded in Neon

---

## Phase 2: GetStream Chat Integration (Steps 2.1–2.4)

### Step 2.1 — GetStream Foundation ✅
**Commit**: `2d0ff9e` Milestone 0+1 — GetStream integration foundation
- GetStream app: EHRC, API Key `ekbhy4vctj9g`, App ID `1563440`, Region US Ohio
- Server client in `src/lib/getstream.ts` with `getStreamServerClient()`
- Token bridge: `/api/auth/stream-token` generates GetStream user token from our JWT
- GetStream webhook receiver at `/api/webhooks/getstream`
- `ChatProvider` wraps app with GetStream `StreamChat` client instance

### Step 2.2 — Channel Types & Seeding ✅
**Commit**: `cdf57cd` + `3dbafde` + `d08cf19` (multiple fixes)
- 5 channel types created via `/api/admin/getstream/setup`:
  - `department` — one per EHRC dept (17 channels)
  - `cross-functional` — ops-daily-huddle, admission-coordination, discharge-coordination, surgery-coordination, emergency-escalation (5 channels)
  - `patient-thread` — per-patient channels (created dynamically)
  - `direct` — 1:1 DMs (created on demand)
  - `ops-broadcast` — hospital-wide announcements (1 channel: `hospital-broadcast`)
- 23 channels seeded total (17 dept + 5 cross-functional + 1 broadcast)
- **Fix applied**: seed-channels route had to handle existing channels gracefully (upsert pattern) and add calling admin as member
- **Fix applied**: JWT payload uses `profileId` not `id` — broke initial seed-channels call

### Step 2.3 — Chat UI Shell ✅
**Commit**: `7186689` Chat UI shell with GetStream integration
- `ChatShell.tsx` — main layout container
- `ChannelSidebar.tsx` — channel list with category grouping
- `MessageArea.tsx` — message display + compose
- `ChatPage.tsx` — top-level page integrating shell
- `MessageTypeBadge.tsx` — visual badge for message types

### Step 2.4 — DMs, Search, Threading, Polish ✅ (Checkpoint A: "WhatsApp Replacement")
**Commit**: `1ada67c` Step 2.4
- `NewMessageDialog.tsx` — modal with debounced user search, creates `direct` channel
- `SearchOverlay.tsx` — global message search via `client.search()` across all channels
- `ThreadPanel.tsx` — slide-in side panel for thread replies (`parent_id` pattern)
- **MessageArea.tsx rewrite** (~430 lines):
  - Reactions: 5 emojis (✅👍👀🙏❓), hover toolbar
  - File upload via `channel.sendImage()`/`channel.sendFile()`
  - Attachment rendering (images inline, files as download cards)
  - Thread reply count links, filters out `parent_id` replies from main view
- **ChannelSidebar.tsx enhanced**: last message preview, relative timestamps, "New Message" button, global search button
- **Auto-join**: `autoJoinDefaultChannels()` in `getstream.ts` — on login, adds user to broadcast + their department channel
- **Login route updated**: JOINs departments table to get `department_slug` for auto-join

**Deviation**: No `stream-chat-react` SDK used. All UI is custom React + Tailwind over raw `stream-chat` JS SDK. This was intentional to avoid bundle bloat (the React SDK was removed in commit `ac59b44`).

---

## Phase 3: Patient Workflow Database (Steps 3.1–3.2)

### Step 3.1 — v5 Database Tables ✅
**Commit**: `f6f1d68` + `7b34efd` (fix)
- 6 new tables created via `/api/admin/migrate`:
  1. `patient_threads` — links patient to Rounds lifecycle, 8 operational stages
  2. `form_submissions` — all structured form data as JSONB, 13 form types
  3. `readiness_items` — individual checklist items for readiness tracking
  4. `escalation_log` — escalation events with source, target, severity
  5. `admission_tracker` — 42-column enriched admission record (Patient Journey v2 data)
  6. `duty_roster` — shift-based duty assignments with override support
- 30+ indexes, `updated_at` triggers, `_migrations` tracking table
- CRUD helpers in `src/lib/db-v5.ts` (~470 lines initially, now 817 lines)
- **Major fix**: First migration attempt used file-based semicolon splitting of SQL — broke on CHECK constraints and `$`-quoted PL/pgSQL. Rewrote to programmatic per-statement execution. Second run: 47/47 success, 0 errors.

**Total DB tables**: 15 (8 original + 6 v5 + `_migrations`)

### Step 3.2 — API Routes for New Tables ✅
**Commit**: `3f34bc8` Step 3.2 API routes
- 10 route files, 575 lines total
- **Verified live**: Round-trip tested on Vercel — created "Test Patient Alpha," updated stage, submitted form, all returned correctly from Neon.

---

## Phase 4: Form Engine (Steps 4.1–4.3)

### Step 4.1 — Form Engine Core ✅
**Commit**: `66efcff` Step 4.1
- `src/lib/form-registry.ts` (~750 lines initially, now 1,541 lines): Declarative schemas for all 13 form types
  - Field types: text, textarea, number, date, datetime, time, select, multiselect, checkbox, radio, phone, email
  - Validation: required, min/max, minLength/maxLength, pattern/regex, requiredIf (conditional), visibleWhen (conditional visibility)
  - Readiness item markers on checkbox fields: itemName, category, responsibleRole, slaHours
  - Completion scoring: counts required + readiness fields filled vs total
- `src/components/forms/FormRenderer.tsx` (~350 lines): Dynamic renderer with completion progress bar
- `src/app/forms/page.tsx`: Form type picker grouped by patient journey stage + recent submissions
- `src/app/forms/new/page.tsx`: Full submission flow (schema load → render → validate → POST → success screen)
- **`/api/forms` POST upgraded**: server-side validation, auto readiness item generation, completion scoring

### Step 4.2 — Form-in-Chat + View Page ✅
**Commit**: `ab637f4` + `de24c0a` (fix)
- `src/app/forms/[id]/page.tsx` (~335 lines): Read-only form view with readiness tracker
- `src/components/forms/FormCard.tsx` (~115 lines): Compact clickable card for inline chat display
- Chat integration: "New Form" button in MessageArea header, form_submission attachment rendering
- **Fix**: Next.js 14 uses `params: { id: string }` not `params: Promise<{ id: string }>` (Next.js 15+ pattern)

### Step 4.3 — Remaining Form Field Enrichment ✅
**Commit**: `8ca94f3` Step 4.3
- All 11 skeleton schemas enriched to full multi-section forms
- **Totals**: 310 fields, 83 readiness items, 13 fully specified forms

---

## Phase 5: Workflow Orchestration (Steps 5.1–5.3)

### Step 5.1 — Patient Thread + Channel Auto-Creation ✅
**Commit**: `19a8f7c` Step 5.1
- `POST /api/patients` upgraded: auto-creates GetStream `patient-thread` channel on patient creation
  - Channel ID pattern: `pt-{first8chars-of-uuid}` (e.g., `pt-07d6d98d`)
  - Auto-adds members: creator, primary consultant, all IP coordinators, department head, stage-specific roles
  - Posts welcome system message to new channel
  - Stores getstream_channel_id back to patient_threads DB row
- New `PATCH /api/patients/[id]/stage` route for stage transitions:
  - Validates with VALID_TRANSITIONS map (forward + correction)
  - Auto-adds stage-specific roles (e.g., pre_op → anesthesiologist, ot_coordinator, nurse)
  - Posts stage transition system message
- New getstream helpers: `createPatientChannel`, `updatePatientChannel`, `addUsersToChannel`
- New DB helpers: `findProfilesByRole`, `getDepartmentHead`

### Step 5.2 — Duty Roster UI + Shift Handoff ✅
**Commit**: `3161581` Step 5.2
- `/admin/duty-roster` page (~500 lines): full CRUD with table, create modal, filters (department, role, active_only)
- Create modal: staff/department/role dropdowns, shift type selector (day/evening/night/on_call/visiting), day-of-week toggles, time pickers, date range, override toggle with reason + date
- Handoff notification: bell icon → `POST /api/duty-roster/handoff` → system message to department channel
- `sendShiftHandoffMessage()` helper in `getstream.ts`
- Admin dashboard: Duty Roster stat card + quick action link
- Fixed `DutyRosterEntry` type, added `SHIFT_TYPE_LABELS`, `DAY_LABELS`

### Step 5.3 — Escalation Engine ✅
**Commit**: `99677d5` Step 5.3
- `POST /api/escalation/cron`: 4-level automated escalation chain
  - Level 1: Warning in patient thread channel
  - Level 2: Escalate to department head
  - Level 3: Escalate to on-duty staff (via duty roster resolve)
  - Level 4+: Broadcast to emergency-escalation channel
  - 60-minute cooldown between re-escalation
  - Auth: CRON_SECRET header or super_admin session
- `GET/PATCH /api/escalation/log`: List (filter by resolved/source_type), resolve with notes
- `/admin/escalations` page: card list with level badges, "Run Escalation Check" button, resolve modal
- New DB helpers: `markReadinessItemEscalated()`, `listEscalations()`

---

## Phase 6: Dashboard, Tracking & UX (Steps 6.1–6.2)

### Step 6.1 — Admission Tracker Dashboard ✅
**Commit**: `0ab86ce` Step 6.1
- `/admin/admissions` page (~550 lines) with 3-tab interface:
  1. **Stage Board**: Kanban columns (Admitted → Pre-Op → In Surgery → Post-Op → Discharge Planned) with patient cards
  2. **Surgery Schedule**: Table sorted by planned date, TODAY/OVERDUE indicators, readiness + status badges
  3. **Discharge Readiness**: Scored checklist per patient (7 items), progress bar and percentage
- `POST /api/admission-tracker`: Create admission (admin/dept_head/ip_coordinator)
- `createAdmissionTracker()` DB helper (23 input fields)
- `AdmissionTrackerEntry` expanded to 42 fields, new labels/colors/enums added to types

### Step 6.2 — UX Redesign: Bottom Tab Bar ✅
**Commit**: `f9044b1` Step 6.2
- **Major UX pivot**: Replaced chat-first layout with patient-first bottom tab navigation after V's live testing revealed usability gaps (system messages not actionable, no patient creation UI, forms undiscoverable, no onboarding)
- New `AppShell.tsx` replaces `ChatPage` as main entry (page.tsx updated)
- New `BottomTabBar.tsx`: 4 tabs — Patients | Chat | Tasks | Me (WhatsApp-like pattern)
- New `PatientsView.tsx`: patient list with search, stage filter pills, FAB for create, bottom-sheet create modal
- New `TasksView.tsx`: two sub-tabs (Overdue Items from `/api/readiness/overdue`, Escalations from `/api/escalation/log`)
- New `ProfileView.tsx`: profile card, admin link (role-gated), logout
- New `/api/readiness/overdue` route
- **Critical fix**: ChatShell `h-screen` → `h-full` (3 occurrences) for tab bar compatibility
- **Architecture**: ChatShell ALWAYS mounted (CSS `hidden` toggle, not conditional render) to keep GetStream WebSocket alive

**Deferred from 6.2 (see Step 6.2b below)**:
- Patient Detail View, slash commands, actionable system messages, stage-aware nudges, tab badge wiring

---

## Phase 6b: UX Completion (Step 6.2b) ✅

### Step 6.2b — Deferred UX Items ✅
**Commit**: `558e49e` Step 6.2b — Patient Detail View, actionable system messages, slash commands, tab badges
1. **Patient Detail View** (`src/components/patients/PatientDetailView.tsx`): Stage progress bar, "Advance Stage" button, form history, channel link, AI predictions card
2. **AppShell refactor**: Split into `AppShell` (outer, wraps ChatProvider) + `AppShellInner` (inner, uses useChatContext for unread badges). Added `selectedPatientId` state for patient detail navigation.
3. **Tab badge wiring**: Unread count from GetStream `total_unread_count` + event listeners (`notification.message_new`, `notification.mark_read`)
4. **Slash commands**: Type "/" in chat composer → context-aware form menu showing stage-relevant forms via `FORMS_BY_STAGE`
5. **Actionable system messages**: Color-coded cards (purple for stage transitions, red for escalations) with action buttons (Fill Stage Form, View Escalations, Duty Roster, View Forms)
6. **Cleaned up ChatPage.tsx**: Deleted orphaned file

---

## Phase 7: PWA & Mobile (Step 7.1) ✅

### Step 7.1 — Progressive Web App ✅
**Commit**: `3992add` feat: Steps 7.1 + 8.1-8.3
- `public/sw.js`: Service worker with precache, network-first strategy, offline fallback, push notification handler
- `src/app/offline/page.tsx`: Offline fallback page with retry button
- `src/components/pwa/InstallPrompt.tsx`: "Add to Home Screen" banner via `beforeinstallprompt`
- `src/components/pwa/ServiceWorkerRegistration.tsx`: SW registration + `subscribeToPush()` helper with VAPID
- `src/app/api/push/vapid-key/route.ts`, `subscribe/route.ts`, `send/route.ts`: Push notification API routes
- `src/lib/push.ts`: web-push library — `sendPushToUser`, `sendPushToUsers`, `sendPushBroadcast`
- DB migration adds `push_subscriptions` table (profile_id, endpoint, subscription_json)
- Updated `public/manifest.json` with scope, categories, maskable icons
- PWA icons: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico`

---

## Phase 8: AI Integration (Steps 8.1–8.3) ✅

### AI Infrastructure
**Decision (30 March 2026)**: Local LLM inference via Ollama + Cloudflare Tunnel instead of cloud API.
- **Hardware**: Mac Mini M4 Pro, 24GB unified memory (V's local machine)
- **Inference**: Ollama serving two models:
  - `qwen2.5:14b` — complex analysis, reasoning, structured JSON output (MODEL_PRIMARY)
  - `llama3.1:8b` — tool use, classification, quick tasks (MODEL_FAST)
- **Network**: Cloudflare Tunnel provides public HTTPS URL (e.g., `https://llm.yourdomain.com`) → forwards to `localhost:11434`
- **Client**: `openai` npm SDK pointed at Ollama's OpenAI-compatible endpoint via `LLM_BASE_URL` env var
- **Why not Tailscale?**: Vercel serverless functions can't reach Tailscale private IPs. Cloudflare Tunnel provides a public URL.
- **Implementation**: `src/lib/llm.ts` — shared OpenAI client; `src/lib/ai.ts` — all AI functions use `llm.chat.completions.create()`

### Step 8.1 — AI Gap Analysis ✅
**Commit**: `3992add` (initial) + `244d584` (Ollama refactor) + uncommitted (OpenAI SDK refactor)
- `src/lib/ai.ts` → `analyzeFormGaps()`: Scores form completeness (0-100), identifies critical gaps, flags concerning patterns
- `src/components/ai/GapAnalysisCard.tsx`: "Analyze" button on form view pages, renders score, gaps, recommendations
- `src/app/api/ai/gap-analysis/route.ts`: API route
- DB migration adds `ai_analysis` table (analysis_type, source_id, source_type, result JSONB, model, token_count)

### Step 8.2 — AI Daily Briefing ✅
- `src/lib/ai.ts` → `generateDailyBriefing()`: Queries active patients, overdue items, escalations, duty roster → LLM generates structured morning briefing
- `src/components/ai/DailyBriefing.tsx`: Expandable sections (admissions, surgeries, discharges, overdue, escalations, staff alerts), action items with priority colors
- `src/app/api/ai/briefing/route.ts`: API route
- `TasksView.tsx` updated: "Briefing" tab added as default tab

### Step 8.3 — Predictive Intelligence ✅
- `src/lib/ai.ts` → `predictPatientOutcomes()`: LOS estimate, discharge readiness %, escalation risk, risk factors
- `src/components/ai/PredictionCard.tsx`: Visual card showing predictions per patient
- `src/app/api/ai/predict/route.ts`: API route
- `PatientDetailView.tsx` updated: Shows PredictionCard

---

## Phase 9: Expansion & Forms Module (Steps 9.1–9.4) ✅

### Step 9.1 — Departments & Roles Expansion ✅
**Commit**: `ccf9625` (part of patient detail enhancements commit)
- Departments expanded from 17 to 19: added **Marketing** and **Administration**
- GetStream department channels seeded for both new departments (25 total channels)
- Roles expanded from 16 to 20: added `administrator`, `medical_administrator`, `operations_manager`, `unit_head`, `marketing_executive`
- Signup flow enhanced: blocks duplicate signups with status-specific error messages (active, pending, rejected)

### Step 9.2 — Patient Detail Enhancements ✅
**Commits**: `ccf9625` + `9353cdb` (migration fix) + `610534e` (cleanup)
- **Inline field editing**: UHID, IP Number, Consulting Doctor, Department — editable directly in PatientDetailView via `PATCH /api/patients/[id]/fields`
- **Patient stages expanded**: 8 → 11 stages. Added `medical_management`, `post_op_care`, `long_term_followup`
  - DB CHECK constraint updated (required fixing one row with legacy `admission_scheduled` value → `opd`)
  - Stage progress bar updated in PatientDetailView
  - `FORMS_BY_STAGE` updated in form-registry.ts for 3 new stages
- **PAC Status**: New `pac_status` column on `patient_threads` (4 states: `telemed_pac_pending`, `inpatient_pac_pending`, `telemed_pac_passed`, `inpatient_pac_passed`). New `PATCH /api/patients/[id]/pac-status` route. Selector in PatientDetailView.
- **Patient Changelog**: New `patient_changelog` table (immutable audit trail). All field edits, stage transitions, and PAC status changes are logged with old/new values, changed_by, and metadata JSONB.
- **Migration**: One-time migration endpoint created, run against live Neon DB, then deleted. Migration added: pac_status column, 11-stage CHECK constraint, pac_status CHECK constraint, patient_changelog table + 3 indexes.

### Step 9.3 — Admin Changelog Page ✅
**Commit**: `ccf9625`
- New `/admin/changelog` page (~460 lines) with fishbone timeline visualization
- **Patient list**: Searchable list of all non-archived patients, fetched from `GET /api/admin/changelog`
- **Timeline**: Merged view of DB changelog entries, form submissions, and GetStream chat messages via `GET /api/admin/changelog/[patientId]`
  - Horizontal fishbone on desktop (alternating top/bottom cards along spine)
  - Vertical timeline on mobile
  - Color-coded by type: blue (changelog), green (forms), purple (messages)
  - Date-grouped event clusters
- **Admin dashboard**: Added Patient Changelog quick action link with purple ClipboardList icon

### Step 9.4 — Standalone Forms Module (5th Bottom Tab) ✅
**Commit**: `3eee752`
- **Major UX change**: Forms elevated from chat sub-feature to first-class bottom tab
- **BottomTabBar**: 4 → 5 tabs (Patients | Chat | Forms | Tasks | Me), icon size 22→20 for fit
- **FormsView.tsx** (~500 lines): New standalone form-centric component with 4 view states:
  1. `list`: All 13 forms searchable, grouped by patient journey stage, with stage badges
  2. `pick-patient`: Patient picker (fetches non-archived patients, searchable by name/UHID/IP/department)
  3. `fill`: Uses existing FormRenderer, shows stage mismatch warning if form doesn't match patient stage
  4. `success`: Confirmation with "Submit Another Form" and "View Submitted Form" options
- **Dual chat posting**: Form submissions now post to BOTH the patient's chat channel AND the submitter's department channel
  - `POST /api/forms` enhanced: new `post_to_department` flag triggers department channel lookup chain (profiles.department_id → departments.slug → GetStream `department` channel)
  - Department message includes patient name context
- **AppShell.tsx**: Added FormsView import and Forms tab content div
- **Existing chat clipboard shortcut preserved**: Forms still accessible from chat via the existing icon

---

## Billing Integration (Phases 1–5) — Based on meeting with Mohan (IPD Billing Head)

**Design doc**: `ROUNDS-BILLING-INTEGRATION-DESIGN.md` (created in prior thread)
**Context seed**: `docs/context-seeds/2026-04-02-billing-integration-phases-1-5.md`

### Phase 1 — Discharge Timeline Tracker ✅
**Commit**: `3108e0f` Add discharge timeline tracker (billing integration phase 1)
- `src/lib/discharge-milestones.ts` (420 lines): 9-step discharge milestone tracking with per-step TAT calculation
- `src/app/api/patients/[id]/discharge/route.ts`: GET + POST + PATCH
- Steps: discharge_ordered → pharmacy_clearance → lab_clearance → discharge_summary → billing_closure → final_bill_submitted → final_approval → patient_settled → patient_departed
- Auto-identifies bottleneck step, posts system messages to patient thread + department channels

### Phase 1.5 — Database Migration ✅
**Commit**: `534332d` Add billing tables to admin migrate route
- 3 new tables: `insurance_claims` (40+ columns), `claim_events` (immutable event log), `discharge_milestones` (9-step TAT tracking)
- 8 new columns on `admission_tracker`: insurance_claim_id, insurer_name, submission_channel, sum_insured, room_rent_eligibility, proportional_deduction_risk, running_bill_amount, cumulative_approved_amount, enhancement_alert_threshold
- Triggers, indexes, migration record. Run via browser console on deployed app.

### Phase 2 — Insurance Claim Lifecycle Tracker ✅
**Commit**: `530d2d9` Add insurance claim lifecycle tracker (billing integration phase 2)
- `src/lib/insurance-claims.ts` (692 lines): `getOrCreateClaim()`, `logClaimEvent()` (main action — inserts event, updates status via EVENT_STATUS_MAP, calculates TATs + recovery rate), `formatClaimMessage()` with Mohan's timing advisories, `postClaimMessage()` dual-post
- `src/app/api/patients/[id]/claim/route.ts`: GET (claim + timeline + summary with headroom), POST (create), PATCH (log event)
- `src/types/index.ts`: 12 ClaimStatus values, 24 ClaimEventType values, CLAIM_STATUS_LABELS/COLORS, CLAIM_EVENT_LABELS/COLORS, IRDA_TAT, ROOM_RENT_ELIGIBILITY_PCT, DEFAULT_ENHANCEMENT_THRESHOLD
- `MessageArea.tsx`: Insurance Claim section in SlashCommandMenu (13 buttons: Start/View Claim + 11 event types)
- `PatientDetailView.tsx`: Insurance Claim panel with status badge, financials grid, risk indicators, TATs, timeline

### Phase 3 — Financial Counseling Enhancement ✅
**Commit**: `b0ce33b` Add enhanced financial counseling form + room rent calculator (billing phase 3)
- `src/app/api/billing/roomcalc/route.ts`: Room rent calculator with hospital rates (general ₹2K → NICU ₹18K), eligibility, proportional deduction %, recommendation
- `form-registry.ts`: FINANCIAL_COUNSELING v1→v2 (6 sections: payment_profile, insurance_details, room_rent_eligibility, cost_estimate, deposit_payment, patient_consent with 4 new readiness-item checkboxes)
- `forms/route.ts`: Financial counseling→insurance claim hook (creates claim, calculates room rent eligibility + proportional deduction risk, updates insurance_claims + admission_tracker, logs counseling_completed event, posts to patient thread + #billing)
- `MessageArea.tsx`: Room Rent Calculator button added

### Phase 4 — Enhancement Alert System ✅
**Commit**: `d6258d6` Add enhancement alert system (billing integration phase 4)
- `src/lib/enhancement-alerts.ts` (286 lines): `checkPatientEnhancement()`, `checkAllEnhancements()`, `fireEnhancementAlert()`, `submitCaseSummary()`, `updateRunningBill()` (auto-fires alert if threshold breached)
- `src/app/api/billing/check-enhancements/route.ts`: GET (dry run) + POST (fire alerts)
- `src/app/api/patients/[id]/enhance/route.ts`: GET (status) + POST (doctor case summary) + PATCH (update running bill)
- `MessageArea.tsx`: 3 enhancement buttons for admitted stages

### Phase 5 — Feedback Attribution + BI Dashboard ✅
**Commit**: `d1fc4d3` Add feedback attribution + billing intelligence dashboard (billing phase 5)
- `src/lib/billing-metrics.ts` (539 lines): Revenue metrics (recovery rate, deduction prevention, enhancement capture, denial by insurer, leakage by reason), Speed metrics (discharge TAT total + per-step, billing TAT, pre-auth TAT, enhancement + query response times), Satisfaction metrics (5 rating averages, attribution accuracy), Insurer performance (per-insurer: TAT, recovery, denial, queries), `calculateMilestoneAttribution()` (clinical/billing/insurer contribution breakdown)
- `src/app/api/billing/metrics/route.ts`: GET → full BI dashboard with `?from=&to=` date filters
- `src/app/api/billing/insurer-performance/route.ts`: GET → per-insurer benchmarks
- `form-registry.ts`: POST_DISCHARGE_FOLLOWUP v1→v2 (new discharge_experience section: 5 segmented 1-5 ratings + improvement textarea)
- `forms/route.ts`: Feedback attribution hook — on post_discharge_followup submit, calculates milestone attribution and merges into form JSONB

---

## OT Surgery Readiness (Phases OT.1–OT.5 — PRD COMPLETE, READY FOR BUILD)

**PRD**: `docs/ROUNDS-OT-SURGERY-READINESS-PRD.md` (v2, UX-revised)
**Context seed**: `docs/context-seeds/2026-04-02-ot-surgery-readiness-prd-v2.md`

### PRD Development
**Commits**: `b66bb61` (PRD v1) → `0bc214d` (PRD v2 — UX revision)
- V's original PRD: `Rounds-M8-OT-Surgery-Readiness-PRD.md` (uploaded)
- 8 design questions asked and answered before v1 writing
- V requested UX/adoptability self-critique → 10 problems identified → all 10 fixed in v2
- Architecture audit performed: confirmed zero breakage across 16 existing subsystems
- 14 design decisions locked in (D1–D14)

### Phase OT.1 — Database + Core API + Procedure Defaults (NOT YET BUILT)
- Migration: 4 new tables (surgery_postings, ot_readiness_items, ot_readiness_audit_log, ot_equipment_items)
- `src/lib/ot/procedure-defaults.ts` — 26 procedure→defaults mappings with fuzzy matcher
- `src/lib/ot/readiness-template.ts` — 22-item conditional readiness template
- `src/lib/ot/readiness-status.ts` — status computation + color maps
- `src/lib/ot/surgery-postings.ts` — core business logic
- 16 API route files under `/api/ot/`
- Seed `#ot-schedule` GetStream channel (cross-functional type)
- Deprecate `surgery_posting` from `FORMS_BY_STAGE.pre_op`

### Phase OT.2 — PatientDetailView Surgery Panel + PAC Bottom Sheet (NOT YET BUILT)
- SurgeryPanel component (collapsed summary + expanded accordion)
- ReadinessDonut chart (reusable)
- PAC confirmation bottom sheet (standalone, 3 entry points)
- Role-gated action buttons, tap-to-confirm inline dialogs
- Role-aware equipment display (simplified dots vs. full vendor detail)

### Phase OT.3 — OT Schedule Dashboard + Tasks Integration + Action Banner (NOT YET BUILT)
- `/ot-schedule` top-level page (responsive 3-col desktop / single-scroll mobile)
- Surgery posting wizard (3-step, mobile-first, 7 required fields)
- Tasks tab: new "OT Items" sub-tab with action-first cards + bulk confirm
- Patients tab: OT action banner ("3 OT items need your action")
- Merge OT overdue items into existing Overdue sub-tab + badge count

### Phase OT.4 — Chat Integration + Escalation + Onboarding (NOT YET BUILT)
- SlashCommandMenu: new Surgery section (5 commands)
- System messages to patient thread + #ot-schedule
- Escalation cron (30 min), daily digest cron (6 AM), stale cleanup cron (10 PM)
- Contextual tooltips, empty state messaging

### Phase OT.5 — Polish + Equipment Vendor Workflow (NOT YET BUILT)
- Equipment vendor detail UI for SCM users
- Push notifications for readiness assignments
- Wizard autocomplete polish (fuzzy matching)
- Wound class sequencing validation
- Desktop drag-to-reorder case slots

---

## Phase 10: Insurance + Files + Patient Tabs (PRD Addendum — NOT YET BUILT)

Full specification in `Rounds-PRD-Addendum-Insurance-Files-Tabs.docx`. Four sub-phases:

### Phase 10a — Foundation (Files + Tabs)
- 2 new tables: `files` (Vercel Blob storage, metadata JSONB), `patient_files` (many-to-many linking)
- Tabbed PatientDetailView: Overview | Files | Insurance
- File upload, download, preview, search, tag, and multi-patient linking UI

### Phase 10b — Insurance Module
- 3 new tables: `insurance_policies`, `patient_insurance` (many-to-many), `insurance_events` (immutable TPA workflow timeline with 17 event types)
- Insurance tab in PatientDetailView: policy details, TPA workflow timeline, coverage limits
- Standalone insurance management for policy-level operations

### Phase 10c — Chat-to-Files Bridge
- Auto-link file attachments sent in patient chat channels to the patient's file store
- Retroactive linking of existing attachments

### Phase 10d — AI Enhancements
- AI-powered file analysis (document parsing, auto-tagging)
- Insurance document extraction (coverage, exclusions, limits)
- Smart search across file metadata

**5 new DB tables total**: files, patient_files, insurance_policies, patient_insurance, insurance_events
**New dependency**: `@vercel/blob`

---

## Current Status: Steps 0–9.4 + Billing (B.1–B.5) COMPLETE. OT PRD v2 READY FOR BUILD.

All core features, expansion (Steps 0–9.4), and billing integration (Phases 1–5) are implemented and deployed. OT Surgery Readiness PRD v2 has been written, UX-reviewed, and approved.

**Next build priority**: OT Surgery Readiness — Phase OT.1 (database + core API + procedure defaults).

Other pending items:
1. **Billing testing**: End-to-end insurance claim lifecycle test on Vercel
2. **Billing dashboard UI**: `/api/billing/metrics` and `/api/billing/insurer-performance` endpoints have no frontend yet
3. **Enhancement cron**: `/api/billing/check-enhancements` exists as manual trigger — add to Vercel cron
4. **Monthly summary auto-post**: Design doc specifies monthly department channel summaries — not yet built
5. **Infrastructure**: Set up Cloudflare Tunnel on Mac Mini, configure Vercel env vars for LLM + VAPID
6. **Phase 10 (Files + Patient Tabs)**: PRD addendum complete, build not started

---

## Known Deviations from Original PRD

| Area | Original Plan | What Actually Happened | Why |
|------|--------------|----------------------|-----|
| Auth | Google OAuth (NextAuth.js v5) | Custom email+PIN (jose+bcryptjs) | V lacks Google Workspace admin |
| DB driver | `@vercel/postgres` | `@neondatabase/serverless` | Vercel deprecated their Postgres wrapper |
| Chat SDK | `stream-chat-react` | Custom UI over raw `stream-chat` | Bundle bloat; React SDK removed |
| Migration | SQL file parsing | Programmatic per-statement | Semicolons in CHECK/PL/pgSQL broke parser |
| JWT payload | `{ id, email, role }` | `{ profileId, email, role, status }` | `id` was ambiguous; `status` needed for middleware gating |
| Channel seeding | One-shot idempotent | Multiple fix commits | Existing channels, missing members, profileId bug |
| Step 6.2 | 3-Tab Sidebar (Chats/Updates/Patients) | Bottom Tab Bar (Patients/Chat/Tasks/Me) | V's live testing: chat-first was wrong; staff think in patients |
| App entry | ChatPage as root | AppShell with tab management | UX redesign required new wrapper architecture |
| AI provider | Claude API (Anthropic) | Local Ollama via Cloudflare Tunnel | Cost control, data privacy, V has Mac Mini M4 Pro |
| AI SDK | `@anthropic-ai/sdk` | `openai` npm (Ollama-compatible) | Ollama exposes OpenAI-compatible `/v1` endpoint |
| `NEXTAUTH_URL` env var | Removed from code | Still referenced in `process.env` | Legacy; harmless but should clean up |
| Patient stages | 8 stages | 11 stages (added medical_management, post_op_care, long_term_followup) | Real patient journeys don't always follow linear path |
| Bottom tabs | 4 tabs (Patients/Chat/Tasks/Me) | 5 tabs (added Forms) | Forms were undiscoverable inside chat; needed standalone module |
| Forms access | Only via chat clipboard shortcut | Both: standalone tab + chat shortcut | Form-centric workflow more natural for staff |
| Departments | 17 | 19 (added Marketing, Administration) | Gaps found during operational use |
| Phase 10 insurance | `insurance_policies` + `insurance_events` tables (PRD) | `insurance_claims` + `claim_events` (Mohan-informed design) | Mohan meeting revealed real workflow differs from PRD assumptions; built claim lifecycle instead of policy management |
| Insurance UI location | Separate Insurance tab in PatientDetailView (PRD) | Inline Insurance panel + SlashCommandMenu actions | Claim data lives alongside patient context; slash commands match existing UX pattern |
| OT Dashboard location | Under `/admin/ot-schedule` (PRD v1) | Top-level `/ot-schedule` route (PRD v2) | OT staff need this as their daily home screen; /admin sends wrong signal for non-admin users |
| Surgery posting mechanism | `surgery_posting` form type in FORMS_BY_STAGE (existing) | First-class entity in `surgery_postings` table, 3-step wizard | Surgery postings need structured fields (OT room, slot order, team, readiness generation) that don't fit generic FormSchema pipeline |
| OT readiness items | Could extend existing `readiness_items` table | New `ot_readiness_items` table | Existing table has hard FK to form_submissions, different status values (no 'blocked'), no audit log. OT readiness is fundamentally different domain. |

---

## Current File Tree (~141 source files, will grow to ~170+ after OT build)

```
middleware.ts                              — Edge auth middleware
public/
├── sw.js                                  — Service worker (precache, offline, push)
├── manifest.json                          — PWA manifest
├── icon-192.png, icon-512.png             — PWA icons
├── apple-touch-icon.png, favicon.ico      — Apple/browser icons
src/
├── app/
│   ├── layout.tsx, page.tsx               — Root layout (+ SW registration, InstallPrompt) + AppShell entry
│   ├── offline/page.tsx                   — PWA offline fallback
│   ├── admin/                             — Admin dashboard (7 pages)
│   │   ├── page.tsx                       — Admin home (stats + quick actions + changelog link)
│   │   ├── admissions/page.tsx            — Admission tracker (3-tab)
│   │   ├── changelog/page.tsx             — Patient Changelog with fishbone timeline (~460 lines)
│   │   ├── duty-roster/, escalations/, approvals/, profiles/, users/, departments/
│   ├── auth/                              — Login, signup, pending (3 pages)
│   ├── forms/                             — Form picker, new, [id] view (3 pages)
│   └── api/                               — 66 API route files
│       ├── admin/{approvals, getstream/setup, getstream/seed-channels, migrate, changelog, changelog/[patientId]}
│       ├── auth/{login, logout, me, signup, stream-token}
│       ├── {departments, profiles, profiles/import, profiles/me, webhooks/getstream}
│       ├── patients/, patients/[id]/, patients/[id]/stage/, patients/[id]/fields/, patients/[id]/pac-status/
│       ├── patients/[id]/claim/, patients/[id]/discharge/, patients/[id]/enhance/, patients/[id]/files/
│       ├── patients/archive/, patients/form-status/, patients/import/
│       ├── forms/, forms/[id]/
│       ├── readiness/[formId]/, readiness/items/[itemId]/, readiness/overdue/, readiness/completed/
│       ├── admission-tracker/
│       ├── billing/roomcalc/, billing/check-enhancements/, billing/metrics/, billing/insurer-performance/
│       ├── duty-roster/, duty-roster/[id]/, duty-roster/resolve/, duty-roster/handoff/
│       ├── escalation/cron/, escalation/log/
│       ├── push/vapid-key/, push/subscribe/, push/send/
│       └── ai/gap-analysis/, ai/briefing/, ai/predict/
├── components/
│   ├── AppShell.tsx                       — Main app wrapper (5 tabs, outer + inner split for GetStream badges)
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── ai/                                — GapAnalysisCard, DailyBriefing, PredictionCard
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea (+ SlashCommandMenu), ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge
│   ├── forms/                             — FormRenderer, FormCard, FormsView (~500 lines, standalone module)
│   ├── layout/                            — AuthProvider, Header, Sidebar, BottomTabBar (5 tabs)
│   ├── patients/                          — PatientsView, PatientDetailView (inline edit, PAC, 11 stages)
│   ├── profile/                           — ProfileView
│   ├── pwa/                               — InstallPrompt, ServiceWorkerRegistration
│   └── tasks/                             — TasksView (with Briefing tab)
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
│   ├── insurance-claims.ts                — Claim lifecycle, event logging, system messages (692 lines)
│   ├── enhancement-alerts.ts              — Auto-detect threshold breach, fire alerts (286 lines)
│   └── billing-metrics.ts                 — Revenue/speed/satisfaction BI aggregations (539 lines)
├── providers/
│   └── ChatProvider.tsx                   — GetStream StreamChat client wrapper
└── types/
    └── index.ts                           — Shared TypeScript types (expanded: PAC, 11 stages, changelog)
```

## Dependencies (production)

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

## Env Vars (Vercel)

| Variable | Purpose | Status |
|----------|---------|--------|
| `POSTGRES_URL` | Neon connection string | ✅ Set |
| `JWT_SECRET` | HMAC key for JWT signing | ✅ Set |
| `NEXT_PUBLIC_GETSTREAM_API_KEY` | GetStream client-side key (`ekbhy4vctj9g`) | ✅ Set |
| `GETSTREAM_API_SECRET` | GetStream server-side secret | ✅ Set |
| `CRON_SECRET` | Auth for escalation cron endpoint | ✅ Set |
| `LLM_BASE_URL` | Cloudflare Tunnel URL for Ollama (e.g., `https://llm.yourdomain.com/v1`) | ⏳ Needs Cloudflare Tunnel setup |
| `LLM_API_KEY` | Placeholder for Ollama (`ollama`) | ⏳ Needs setting |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key | ⏳ Needs setting |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key | ⏳ Needs setting |
| `NEXTAUTH_URL` | **Legacy** — still in code, not used. Should clean up. | 🧹 Cleanup |
