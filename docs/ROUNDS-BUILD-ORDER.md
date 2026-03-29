# Rounds Build Order — Status Tracker

**Last updated**: 29 March 2026 (Step 4.3 complete — Phase 4 DONE)
**Repo**: https://github.com/vinaybhardwaj-commits/rounds
**Live**: https://rounds-sqxh.vercel.app
**Latest commit**: `8ca94f3` — Step 4.3 Form Field Enrichment

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
- CRUD helpers in `src/lib/db-v5.ts` (~470 lines)
- **Major fix**: First migration attempt used file-based semicolon splitting of SQL — broke on CHECK constraints and `$`-quoted PL/pgSQL. Rewrote to programmatic per-statement execution. Second run: 47/47 success, 0 errors.

**Total DB tables**: 15 (8 original + 6 v5 + `_migrations`)

### Step 3.2 — API Routes for New Tables ✅
**Commit**: `3f34bc8` Step 3.2 API routes
- 10 route files, 575 lines total:
  - `patients/route.ts` — GET (list w/ stage+dept filters) + POST (create)
  - `patients/[id]/route.ts` — GET (patient + form history) + PATCH (partial update)
  - `forms/route.ts` — GET (list w/ type+patient+status filters) + POST (submit)
  - `forms/[id]/route.ts` — GET (form + readiness items + aggregate)
  - `readiness/[formId]/route.ts` — GET (items + aggregate for a form)
  - `readiness/items/[itemId]/route.ts` — PATCH (confirm/flag with status validation)
  - `admission-tracker/route.ts` — GET (active non-discharged admissions)
  - `duty-roster/route.ts` — GET (list w/ filters) + POST (admin-only create)
  - `duty-roster/[id]/route.ts` — DELETE (admin-only)
  - `duty-roster/resolve/route.ts` — GET `?department_id=X&role=Y` (resolve on-duty)
- **Verified live**: Round-trip tested on Vercel — created "Test Patient Alpha," updated stage, submitted form, all returned correctly from Neon.

---

## Phase 4: Form Engine (Steps 4.1–4.3)

### Step 4.1 — Form Engine Core ✅
**Commit**: `66efcff` Step 4.1
- `src/lib/form-registry.ts` (~750 lines): Declarative schemas for all 13 form types
  - Field types: text, textarea, number, date, datetime, time, select, multiselect, checkbox, radio, phone, email
  - Validation: required, min/max, minLength/maxLength, pattern/regex, requiredIf (conditional), visibleWhen (conditional visibility)
  - Readiness item markers on checkbox fields: itemName, category, responsibleRole, slaHours
  - Completion scoring: counts required + readiness fields filled vs total
  - Helpers: `getAllFields()`, `getReadinessItemDefs()`, `validateFormData()`, `computeCompletionScore()`
- `src/components/forms/FormRenderer.tsx` (~350 lines): Dynamic renderer
  - Reads schema, renders sections with grid layout (full/half/third width)
  - Conditional field visibility
  - Client-side validation with field-level errors (on blur + on submit)
  - Completion progress bar
  - Draft save + submit actions
  - Readiness badge on checkpoint fields
- `src/app/forms/page.tsx`: Form type picker grouped by patient journey stage + recent submissions
- `src/app/forms/new/page.tsx`: Full submission flow (schema load → render → validate → POST → success screen)
- **`/api/forms` POST upgraded**:
  - Server-side validation against schema (returns 422 with field errors)
  - Auto-generates readiness_items from checked readiness checkboxes
  - Computes completion_score from schema
  - Drafts skip validation and readiness generation
- **Two priority forms fully specified** (4.2 merged into 4.1):
  - Marketing → CC Handoff: 5 sections, 20 fields, 4 readiness items
  - Surgery Posting: 5 sections, 30+ fields, 16 readiness items
- **11 remaining forms have working skeleton schemas** (4.3 partially done):
  - All have correct sections, required fields, and readiness items where applicable
- **Verified live**: Surgery Posting submitted → 13 readiness items auto-created (3 unchecked skipped). Server validation rejects missing required fields with specific messages.

### Step 4.2 — Form-in-Chat + View Page ✅
**Commit**: `ab637f4` + `de24c0a` (fix)
- `src/app/forms/[id]/page.tsx` (~335 lines): Read-only form view
  - Fetches form + readiness items from API
  - Meta card: submitter, date, version, completion progress bar
  - Readiness tracker: items grouped by category, stacked color bar, status icons
  - Schema-driven field display: select labels, formatted dates, checkmarks for booleans
  - Fallback to raw JSON if no schema match
- `src/components/forms/FormCard.tsx` (~115 lines): Compact clickable card
  - Inline display in chat messages or sidebar
  - Shows form type label, status icon, submitter, date, completion %, readiness bar
  - Compact mode for message bubbles, full mode for sidebars
  - Navigates to `/forms/[id]` on click
- **Chat integration wiring**:
  - "New Form" (ClipboardList) button in MessageArea channel header
  - Navigates to `/forms` with channel context params (channel_type, channel_id, patient_id)
  - Form type picker and `/forms/new` pass channel context through to API
  - `POST /api/forms` now sends a GetStream system message with form_submission attachment to the channel after submission (non-blocking)
  - MessageArea detects `form_submission` type attachments and renders FormCard inline
- **Fix**: Next.js 14 uses `params: { id: string }` not `params: Promise<{ id: string }>` (the `use()` pattern is Next.js 15+)
- **Verified live**: `/forms/[id]` returns 200 with full readiness tracker and schema-driven display

### Step 4.3 — Remaining Form Field Enrichment ✅
**Commit**: `8ca94f3` Step 4.3
- All 11 skeleton schemas enriched to full multi-section forms
- `src/lib/form-registry.ts` grew from ~933 to ~1,541 lines
- **Totals**: 310 fields, 83 readiness items, 13 fully specified forms
- Each form now has 2–5 sections with proper validation, readiness items, and Indian hospital workflow fields
- Forms enriched: admission_advice (4 sections, 3 readiness), financial_counseling (4 sections, 3 readiness), ot_billing_clearance (3 sections, 1 readiness), admission_checklist (4 sections, 8 readiness), pre_op_nursing_checklist (4 sections with actual vitals fields, 9 readiness), who_safety_checklist (3 WHO phases, compliance readiness), nursing_shift_handoff (5 sections with vitals, 1 readiness), discharge_readiness (3 sections enhanced, 9 readiness), post_discharge_followup (4 sections, 1 readiness), daily_department_update (4 sections, 0 readiness — report form), pac_clearance (4 sections, 4 readiness)
- **Verified live**: Admission Advice → 3 readiness items. PAC Clearance → 4 readiness items. Server validation catches missing required fields.

---

## Phase 5: Workflow Orchestration (Steps 5.1–5.3)

### Step 5.1 — Patient Thread + Channel Auto-Creation
- When a patient thread is created, auto-create a GetStream `patient-thread` channel
- Auto-add relevant staff (consultant, IP coordinator, department head)
- Stage transitions trigger channel membership changes

### Step 5.2 — Duty Roster Integration
- Duty roster UI in admin panel
- On-duty resolution used by escalation engine
- Shift handoff notifications via GetStream

### Step 5.3 — Escalation Engine
- Auto-escalate overdue readiness items
- Escalation chain: responsible → department head → on-duty → ops broadcast
- Escalation log entries created automatically
- Cron job for periodic overdue checks

---

## Phase 6: Dashboard & Tracking (Steps 6.1–6.2)

### Step 6.1 — Admission Tracker Dashboard
- Active admissions board with stage visualization
- Surgery schedule view
- Discharge readiness scoring

### Step 6.2 — 3-Tab Sidebar (Chats / Updates / Patients)
- Replace single channel list with tabbed navigation
- Chats: existing channel sidebar
- Updates: form submissions, escalations, stage transitions
- Patients: active patient threads with status badges

---

## Phase 7: PWA & Mobile (Step 7.1)

### Step 7.1 — Progressive Web App
- Service worker for offline shell
- Push notifications via GetStream + web push
- Install prompt for mobile home screen
- Mobile-optimized layouts (already responsive via Tailwind)

---

## Phase 8: AI Integration (Steps 8.1–8.3) — Phase 3 per PRD

### Step 8.1 — AI Gap Analysis
- Claude API integration for form completeness analysis
- "Gap report" on form submissions: what's missing, what's concerning

### Step 8.2 — AI Daily Briefing
- Auto-generated morning briefing for ops team
- Summarizes: admissions, pending surgeries, overdue items, escalations

### Step 8.3 — Predictive Intelligence
- Length-of-stay predictions
- Discharge readiness scoring
- Escalation risk flagging

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
| `NEXTAUTH_URL` env var | Removed from code | Still referenced in `process.env` | Legacy; harmless but should clean up |

---

## Current File Tree (source only, 55 files)

```
middleware.ts                              — Edge auth middleware
src/
├── app/
│   ├── layout.tsx, page.tsx               — Root layout + main chat page
│   ├── admin/                             — Admin dashboard (5 pages)
│   ├── auth/                              — Login, signup, pending (3 pages)
│   └── api/
│       ├── admin/approvals/               — Approve/reject users
│       ├── admin/getstream/setup/         — One-time channel type creation
│       ├── admin/getstream/seed-channels/ — Seed 23 channels
│       ├── admin/migrate/                 — v5 DB migration
│       ├── auth/{login,logout,me,signup}/ — Auth endpoints
│       ├── auth/stream-token/             — GetStream token bridge
│       ├── departments/                   — Department CRUD
│       ├── profiles/, profiles/import/    — Staff profiles + CSV import
│       ├── patients/, patients/[id]/      — Patient thread CRUD ← NEW
│       ├── forms/, forms/[id]/            — Form submission CRUD ← NEW
│       ├── readiness/[formId]/            — Readiness items ← NEW
│       ├── readiness/items/[itemId]/      — Confirm/flag item ← NEW
│       ├── admission-tracker/             — Active admissions ← NEW
│       ├── duty-roster/, [id]/, resolve/  — Duty roster CRUD ← NEW
│       └── webhooks/getstream/            — GetStream webhook
├── components/
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea, ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge
│   └── layout/                            — AuthProvider, Header, Sidebar
├── lib/
│   ├── auth.ts                            — JWT create/verify, getCurrentUser
│   ├── db.ts                              — Neon SQL helpers (original)
│   ├── db-v5.ts                           — v5 CRUD helpers (470 lines)
│   ├── getstream.ts                       — GetStream server client + autoJoinDefaultChannels
│   ├── getstream-setup.ts                 — Channel type definitions
│   └── migration-v5-tables.sql            — Reference SQL (not executed directly)
├── providers/
│   └── ChatProvider.tsx                   — GetStream StreamChat client wrapper
└── types/
    └── index.ts                           — Shared TypeScript types
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
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "stream-chat": "^9.38.0"
}
```

## Env Vars (Vercel)

| Variable | Purpose |
|----------|---------|
| `POSTGRES_URL` | Neon connection string |
| `JWT_SECRET` | HMAC key for JWT signing |
| `NEXT_PUBLIC_GETSTREAM_API_KEY` | GetStream client-side key (`ekbhy4vctj9g`) |
| `GETSTREAM_API_SECRET` | GetStream server-side secret |
| `NEXTAUTH_URL` | **Legacy** — still in code, not used. Should clean up. |
