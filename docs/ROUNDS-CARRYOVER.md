# Rounds — Thread Carryover Context Seed

**Purpose**: Paste this at the start of a new thread to restore full build context for continuing Rounds development. This captures everything a new session needs to pick up where we left off.

**Last updated**: 1 April 2026
**Current step**: Steps 0 through 9.4 ALL COMPLETE — Phase 10 (Insurance + Files + Patient Tabs) specified in PRD addendum, not yet built

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
| Messaging | GetStream Chat (`stream-chat` v9.38) | 5 channel types, 25 seeded channels |
| Database | Neon PostgreSQL (`@neondatabase/serverless`) | 18 tables, HTTP driver (no multi-statement) |
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

## 5. Database Schema (18 tables)

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

### 13 Form Types:
marketing_cc_handoff, admission_advice, financial_counseling, ot_billing_clearance, admission_checklist, surgery_posting, pre_op_nursing_checklist, who_safety_checklist, nursing_shift_handoff, discharge_readiness, post_discharge_followup, daily_department_update, pac_clearance

---

## 6. GetStream Configuration

- **Org**: EHRC | **App ID**: 1563440 | **Region**: US Ohio
- **API Key** (public): `ekbhy4vctj9g`
- **5 Channel Types**: department, cross-functional, patient-thread, direct, ops-broadcast
- **25 Seeded Channels**: 19 department (one per EHRC dept, including Marketing & Administration added in Step 9) + 5 cross-functional (ops-daily-huddle, admission-coordination, discharge-coordination, surgery-coordination, emergency-escalation) + 1 broadcast (hospital-broadcast)
- **Auto-join on login**: Users auto-added to `hospital-broadcast` + their department channel
- **Patient channels**: `pt-{first8chars-of-uuid}`, auto-created with members on patient thread creation

---

## 7. API Routes (~46 total)

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

### Patient Workflow (16 routes):
- `GET/POST /api/patients` — list (stage+dept filters, include_archived param) / create patient thread (auto-creates GetStream channel)
- `GET/PATCH /api/patients/[id]` — get (with form history) / partial update
- `PATCH /api/patients/[id]/stage` — stage transition with validation, channel update, member auto-add, changelog logging
- `PATCH /api/patients/[id]/fields` — inline field editing (uhid, ip_number, consulting_doctor, department_id) with changelog logging
- `PATCH /api/patients/[id]/pac-status` — PAC status update with changelog logging
- `GET/POST /api/forms` — list (type+patient+status filters) / submit form (server validation, readiness auto-gen, dual chat posting to patient channel + department channel)
- `GET /api/forms/[id]` — get form + readiness items + aggregate
- `GET /api/readiness/[formId]` — readiness items for a form
- `PATCH /api/readiness/items/[itemId]` — confirm/flag readiness item
- `GET /api/readiness/overdue` — all overdue readiness items (used by TasksView badge)
- `GET /api/admission-tracker` + `POST` — list active admissions / create new admission

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
    │   ├── PredictionCard (AI: LOS, discharge readiness, risk)
    │   └── "Open Channel" link
    ├── Patients Tab (default) — PatientsView.tsx
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
    │   ├── Overdue Items sub-tab
    │   └── Escalations sub-tab
    ├── Me Tab — ProfileView.tsx
    │   ├── Profile card
    │   ├── Admin Dashboard link (admin only)
    │   └── Log Out
    └── BottomTabBar (5 tabs, badges: unread chat count + overdue tasks count)
```

### Admin Pages (7):
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

### Phase 10 — PRD Addendum (specified, not yet built):
Full PRD document at `Rounds-PRD-Addendum-Insurance-Files-Tabs.docx`. Four implementation phases:
1. **Foundation** (Phase 10a): `files` + `patient_files` tables, Vercel Blob storage, tabbed PatientDetailView (Overview | Files | Insurance), file upload/download/link UI
2. **Insurance Module** (Phase 10b): `insurance_policies` + `patient_insurance` + `insurance_events` tables, TPA workflow with 17 event types, policy management UI in Insurance tab
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

## 12. File Tree (~95 source files)

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
│   ├── auth/                              — Login, signup, pending (3 pages)
│   ├── forms/                             — Form picker, new, [id] view (3 pages)
│   └── api/                               — ~46 API routes (see section 7)
│       ├── admin/{approvals, getstream/setup, getstream/seed-channels, migrate, changelog, changelog/[patientId]}
│       ├── auth/{login, logout, me, signup, stream-token}
│       ├── {departments, profiles, profiles/import, profiles/me, webhooks/getstream}
│       ├── patients/, patients/[id]/, patients/[id]/stage/, patients/[id]/fields/, patients/[id]/pac-status/
│       ├── forms/, forms/[id]/
│       ├── readiness/[formId]/, readiness/items/[itemId]/, readiness/overdue/
│       ├── admission-tracker/
│       ├── duty-roster/, duty-roster/[id]/, duty-roster/resolve/, duty-roster/handoff/
│       ├── escalation/cron/, escalation/log/
│       ├── push/vapid-key/, push/subscribe/, push/send/
│       └── ai/gap-analysis/, ai/briefing/, ai/predict/
├── components/
│   ├── AppShell.tsx                       — Main app wrapper (outer + inner for GetStream badges)
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── ai/                                — GapAnalysisCard, DailyBriefing, PredictionCard
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea (+SlashCommandMenu), ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge
│   ├── forms/                             — FormRenderer, FormCard, FormsView (~500 lines, standalone form-centric module)
│   ├── layout/                            — AuthProvider, Header, Sidebar, BottomTabBar (5 tabs)
│   ├── patients/                          — PatientsView, PatientDetailView (inline edit, PAC status, 11 stages)
│   ├── profile/                           — ProfileView
│   ├── pwa/                               — InstallPrompt, ServiceWorkerRegistration
│   └── tasks/                             — TasksView (Briefing/Overdue/Escalations tabs)
├── lib/
│   ├── auth.ts                            — JWT create/verify, getCurrentUser
│   ├── db.ts                              — Neon SQL helpers (original)
│   ├── db-v5.ts                           — v5 CRUD helpers (817+ lines, includes changelog functions)
│   ├── form-registry.ts                   — 13 form schemas (1,541+ lines, FORMS_BY_STAGE updated for 11 stages)
│   ├── getstream.ts                       — Server client + helpers (236 lines)
│   ├── getstream-setup.ts                 — Channel type definitions
│   ├── llm.ts                             — OpenAI SDK client → Ollama via Cloudflare Tunnel
│   ├── ai.ts                              — AI functions (gap analysis, briefing, predictions)
│   └── push.ts                            — web-push helpers (sendPushToUser, broadcast)
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

You are continuing work on the Rounds app. **Steps 0–9.4 are complete. Phase 10 (Insurance + Files + Patient Tabs) is specified in a PRD addendum but not yet built.**

The user (V) prefers:
- Ask clarifying questions before starting work
- Never truncate metric labels on mobile
- All info card items must be clickable to source data
- Use Indian number notation (Cr/L/K) where applicable
- ChatShell must ALWAYS stay mounted (hidden class, not conditional render)
- Use `h-full` not `h-screen` inside AppShell's tab layout
- AI uses local Ollama via Cloudflare Tunnel (`src/lib/llm.ts`), NOT cloud APIs
- Forms data must be immutable once submitted — new submission rather than edit

Current focus areas:
1. **Testing**: End-to-end workflow testing on Vercel with real staff accounts
2. **UI/UX polish**: Mobile usability, edge cases, visual refinements
3. **Infrastructure setup**: Cloudflare Tunnel on Mac Mini, Vercel env vars for LLM + VAPID
4. **Phase 10 planning**: Insurance lifecycle, file management (Vercel Blob), tabbed PatientDetailView — see PRD addendum

The build order document is at: `docs/ROUNDS-BUILD-ORDER.md`
The context seeds are at: `docs/context-seeds/`
The full ops suite documentation is at: `EHRC-OPS-SUITE-DOCUMENTATION.md`
The PRD addendum is at: `Rounds-PRD-Addendum-Insurance-Files-Tabs.docx` (in workspace folder)
