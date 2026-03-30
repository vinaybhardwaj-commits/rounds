# Rounds Build Order — Status Tracker

**Last updated**: 30 March 2026 (Step 8.3 complete — development paused for testing & UX)
**Repo**: https://github.com/vinaybhardwaj-commits/rounds
**Live**: https://rounds-sqxh.vercel.app
**Latest commit**: `244d584` — AI refactor to local Ollama (pending: OpenAI SDK refactor)

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

## Current Status: DEVELOPMENT PAUSED — Testing & UX Phase

All core features (Steps 0 through 8.3) are implemented. Development is paused to focus on:
1. **Testing**: End-to-end workflow testing on Vercel with real staff accounts
2. **UI/UX polish**: Mobile usability, edge cases, visual refinements
3. **Infrastructure**: Set up Cloudflare Tunnel on Mac Mini, configure Vercel env vars for LLM

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

---

## Current File Tree (~90 source files)

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
│   ├── admin/                             — Admin dashboard (6 pages)
│   │   ├── page.tsx, admissions/, duty-roster/, escalations/, approvals/, profiles/, users/, departments/
│   ├── auth/                              — Login, signup, pending (3 pages)
│   ├── forms/                             — Form picker, new, [id] view (3 pages)
│   └── api/                               — 36 API routes
│       ├── admin/{approvals, getstream/setup, getstream/seed-channels, migrate}
│       ├── auth/{login, logout, me, signup, stream-token}
│       ├── {departments, profiles, profiles/import, profiles/me, webhooks/getstream}
│       ├── patients/, patients/[id]/, patients/[id]/stage/
│       ├── forms/, forms/[id]/
│       ├── readiness/[formId]/, readiness/items/[itemId]/, readiness/overdue/
│       ├── admission-tracker/
│       ├── duty-roster/, duty-roster/[id]/, duty-roster/resolve/, duty-roster/handoff/
│       ├── escalation/cron/, escalation/log/
│       ├── push/vapid-key/, push/subscribe/, push/send/
│       └── ai/gap-analysis/, ai/briefing/, ai/predict/
├── components/
│   ├── AppShell.tsx                       — Main app wrapper (outer + inner split for GetStream badges)
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── ai/                                — GapAnalysisCard, DailyBriefing, PredictionCard
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea (+ SlashCommandMenu), ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge
│   ├── forms/                             — FormRenderer, FormCard
│   ├── layout/                            — AuthProvider, Header, Sidebar, BottomTabBar
│   ├── patients/                          — PatientsView, PatientDetailView
│   ├── profile/                           — ProfileView
│   ├── pwa/                               — InstallPrompt, ServiceWorkerRegistration
│   └── tasks/                             — TasksView (with Briefing tab)
├── lib/
│   ├── auth.ts                            — JWT create/verify, getCurrentUser
│   ├── db.ts                              — Neon SQL helpers (original)
│   ├── db-v5.ts                           — v5 CRUD helpers (817 lines)
│   ├── form-registry.ts                   — 13 form schemas (1,541 lines)
│   ├── getstream.ts                       — Server client + helpers (236 lines)
│   ├── getstream-setup.ts                 — Channel type definitions
│   ├── llm.ts                             — OpenAI SDK client → Ollama via Cloudflare Tunnel
│   ├── ai.ts                              — AI functions (gap analysis, briefing, predictions)
│   └── push.ts                            — web-push helpers (sendPushToUser, broadcast)
├── providers/
│   └── ChatProvider.tsx                   — GetStream StreamChat client wrapper
└── types/
    └── index.ts                           — Shared TypeScript types (539 lines)
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
