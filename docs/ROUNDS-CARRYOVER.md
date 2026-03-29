# Rounds — Thread Carryover Context Seed

**Purpose**: Paste this at the start of a new thread to restore full build context for continuing Rounds development. This captures everything a new session needs to pick up where we left off.

**Last updated**: 29 March 2026
**Current step**: Step 6.2 COMPLETE → Step 6.2b (deferred UX items) or Step 7.1 (PWA) is NEXT

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
| Messaging | GetStream Chat (`stream-chat` v9.38) | 5 channel types, 23 seeded channels |
| Database | Neon PostgreSQL (`@neondatabase/serverless`) | 15 tables, HTTP driver (no multi-statement) |
| Auth | Custom JWT (`jose` v6 + `bcryptjs`) | Email + 4-digit PIN, NOT NextAuth/OAuth |
| Hosting | Vercel (project: `rounds-sqxh`) | Auto-deploy from `main` branch |
| AI (Phase 3) | Claude API (Anthropic) | Not yet integrated |

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

### AppShell Pattern (Step 6.2)
The app entry point is `AppShell`, NOT `ChatPage`. AppShell wraps `ChatProvider` and manages 4 tabs via `BottomTabBar`. **ChatShell is ALWAYS mounted** (uses CSS `hidden` class) to keep GetStream WebSocket alive across tab switches. Never conditionally render ChatShell.

```
page.tsx → AppShell → ChatProvider
                    ├── PatientsView    (default tab)
                    ├── ChatShell       (always mounted, hidden when inactive)
                    ├── TasksView
                    ├── ProfileView
                    └── BottomTabBar
```

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

| Variable | Value/Notes |
|----------|------------|
| `POSTGRES_URL` | Neon connection string (set in Vercel) |
| `JWT_SECRET` | HMAC signing key (set in Vercel) |
| `NEXT_PUBLIC_GETSTREAM_API_KEY` | `ekbhy4vctj9g` |
| `GETSTREAM_API_SECRET` | GetStream server-side secret |
| `CRON_SECRET` | Auth header for `/api/escalation/cron` (Vercel cron or manual) |
| `NEXTAUTH_URL` | **Legacy** — still referenced, not functional. Clean up eventually. |

---

## 5. Database Schema (15 tables)

### Original 8 tables (Steps 0–1):
- `profiles` — staff accounts (id UUID, email, full_name, role, status, department_id, PIN hash)
- `departments` — 17 EHRC departments (id, name, slug, head_profile_id)
- `login_pins` — PIN hashes linked to profiles
- `user_sessions` — JWT session tracking
- `pending_approvals` — signup approval queue
- `api_keys` — API key management
- `audit_log` — action audit trail
- `_migrations` — migration version tracking

### v5 tables (Step 3.1 — 6 tables):
- `patient_threads` — patient → Rounds lifecycle link, 8 stages: opd, pre_admission, admitted, pre_op, surgery, post_op, discharge, post_discharge
- `form_submissions` — JSONB form data, 13 form types, version tracking, completion_score, ai_gap_report
- `readiness_items` — individual checklist items (per form), status: pending/confirmed/flagged/na, escalation_level, sla_deadline
- `escalation_log` — escalation events with 4-level chain, resolved flag, notes
- `admission_tracker` — 42-column enriched admission record covering full Patient Journey v2
- `duty_roster` — shift-based duty with override support, resolves "who's on duty now?"

### 13 Form Types:
marketing_cc_handoff, admission_advice, financial_counseling, ot_billing_clearance, admission_checklist, surgery_posting, pre_op_nursing_checklist, who_safety_checklist, nursing_shift_handoff, discharge_readiness, post_discharge_followup, daily_department_update, pac_clearance

---

## 6. GetStream Configuration

- **Org**: EHRC | **App ID**: 1563440 | **Region**: US Ohio
- **API Key** (public): `ekbhy4vctj9g`
- **5 Channel Types**: department, cross-functional, patient-thread, direct, ops-broadcast
- **23 Seeded Channels**: 17 department (one per EHRC dept) + 5 cross-functional (ops-daily-huddle, admission-coordination, discharge-coordination, surgery-coordination, emergency-escalation) + 1 broadcast (hospital-broadcast)
- **Auto-join on login**: Users auto-added to `hospital-broadcast` + their department channel
- **Patient channels**: `pt-{first8chars-of-uuid}`, auto-created with members on patient thread creation

---

## 7. API Routes (30 total)

### Auth (5 routes):
- `POST /api/auth/login` — email+PIN → JWT cookie + GetStream token + auto-join channels
- `POST /api/auth/signup` — create profile (pending approval)
- `POST /api/auth/logout` — clear session cookie
- `GET /api/auth/me` — return current user from JWT
- `GET /api/auth/stream-token` — generate fresh GetStream user token

### Admin (4 routes):
- `GET/PATCH /api/admin/approvals` — list pending, approve/reject
- `POST /api/admin/getstream/setup` — one-time: create 5 channel types + system bot
- `POST /api/admin/getstream/seed-channels` — seed 23 channels (idempotent)
- `POST /api/admin/migrate` — execute v5 DB migration (idempotent)

### Data (4 routes):
- `GET /api/departments` — list all departments
- `GET /api/profiles` — list profiles with filters
- `POST /api/profiles/import` — CSV bulk import
- `POST /api/webhooks/getstream` — GetStream event webhook

### Patient Workflow (12 routes):
- `GET/POST /api/patients` — list (stage+dept filters) / create patient thread (auto-creates GetStream channel)
- `GET/PATCH /api/patients/[id]` — get (with form history) / partial update
- `PATCH /api/patients/[id]/stage` — stage transition with validation, channel update, member auto-add
- `GET/POST /api/forms` — list (type+patient+status filters) / submit form (server validation, readiness auto-gen)
- `GET /api/forms/[id]` — get form + readiness items + aggregate
- `GET /api/readiness/[formId]` — readiness items for a form
- `PATCH /api/readiness/items/[itemId]` — confirm/flag readiness item
- `GET /api/readiness/overdue` — all overdue readiness items (used by TasksView)
- `GET /api/admission-tracker` + `POST` — list active admissions / create new admission

### Duty Roster (4 routes):
- `GET/POST /api/duty-roster` — list / create (admin-only)
- `DELETE /api/duty-roster/[id]` — remove entry (admin-only)
- `GET /api/duty-roster/resolve?department_id=X&role=Y` — resolve current on-duty
- `POST /api/duty-roster/handoff` — send shift handoff message to department channel

### Escalation (2 routes):
- `POST /api/escalation/cron` — automated 4-level escalation runner (CRON_SECRET or super_admin)
- `GET/PATCH /api/escalation/log` — list escalations (filter by resolved/source_type) / resolve with notes

---

## 8. UI Structure

### Main App (after login):
```
AppShell (wraps ChatProvider)
├── Patients Tab (default) — PatientsView.tsx
│   ├── Search bar
│   ├── Stage filter pills (scrollable)
│   ├── Patient cards (stage-colored left border)
│   └── FAB → Create Patient modal
├── Chat Tab — ChatShell.tsx (always mounted)
│   ├── ChannelSidebar (category-grouped)
│   └── MessageArea (reactions, files, threads, form cards)
├── Tasks Tab — TasksView.tsx
│   ├── Overdue Items sub-tab
│   └── Escalations sub-tab
├── Me Tab — ProfileView.tsx
│   ├── Profile card
│   ├── Admin Dashboard link (admin only)
│   └── Log Out
└── BottomTabBar (fixed bottom, 4 tabs with badge support)
```

### Admin Pages (6):
- `/admin` — Dashboard: user stats, roster count, open escalations, active admissions, quick actions
- `/admin/admissions` — 3-tab: Stage Board (Kanban), Surgery Schedule, Discharge Readiness
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
| **6.2b** | **Deferred UX items** | **🔜 Next** | — |
| 7.1 | PWA (offline, push notifications) | Pending | — |
| 8.1 | AI gap analysis (Claude API) | Pending | — |
| 8.2 | AI daily briefing | Pending | — |
| 8.3 | Predictive intelligence | Pending | — |

---

## 10. Deferred Items (prioritize before 7.1)

### From Step 6.2 UX Redesign:
- **Patient Detail View**: Dedicated view with stage progress bar, "Advance Stage" button, forms section, channel link. Currently patients list exists but tapping a patient doesn't go anywhere useful.
- **Slash commands**: Type "/" in chat for context-aware form menu (e.g., in a surgery patient channel, "/" shows Surgery Posting, Pre-Op Checklist, WHO Safety Checklist)
- **Actionable system messages**: Stage transition messages should have "View Patient" / "Fill Form" buttons instead of plain text
- **Stage-aware nudges**: Banner in patient channels suggesting the next required form based on current stage
- **Tab badge wiring**: Unread message count on Chat tab, overdue item count on Tasks tab
- **Clean up ChatPage.tsx**: Orphaned — no longer imported from page.tsx but still in codebase

### From earlier steps:
- **Superuser PIN**: Still `1234`. Change via Neon SQL Editor.
- **Signup rate limiting**: Not implemented. Low priority for internal app.
- **Billing-coordination channel**: Identified gap from Patient Journey v2. Not yet in GetStream.
- **`NEXTAUTH_URL` cleanup**: Legacy env var still referenced in code.
- **Test data cleanup**: "Test Patient Alpha" in production DB.

---

## 11. Key Personnel Context

- **IP Coordinators**: Tamanna & Kavya — SPOF for admission workflows
- **OT Coordinator**: Naveen Kumar — surgery scheduling
- **Customer Care**: Lavanya — marketing→admission handoff
- **AM**: Dr. Ankita Priya
- **V's boss**: Richa — uses dashboard on mobile, provides UI/UX feedback
- **Three EMR silos**: Even App (teleconsult), Pulse (OPD-only), KareXpert (IP HIS) — no auto-sync. Rounds runs parallel.

---

## 12. File Tree (74 source files)

```
middleware.ts                              — Edge auth middleware
src/
├── app/
│   ├── layout.tsx, page.tsx               — Root layout + AppShell entry
│   ├── admin/                             — Admin dashboard (6 pages)
│   │   ├── page.tsx                       — Admin home (stats + quick actions)
│   │   ├── admissions/page.tsx            — Admission tracker (3-tab)
│   │   ├── duty-roster/page.tsx           — Roster CRUD + handoff
│   │   ├── escalations/page.tsx           — Escalation log + resolve
│   │   ├── approvals/page.tsx             — User approvals
│   │   └── profiles/, users/, departments/ — Staff management
│   ├── auth/                              — Login, signup, pending (3 pages)
│   ├── forms/                             — Form picker, new, [id] view (3 pages)
│   └── api/                               — 30 API routes (see section 7)
├── components/
│   ├── AppShell.tsx                       — Main app wrapper (tab management)
│   ├── admin/                             — CSVImport, DepartmentList, ProfilesTable
│   ├── chat/                              — ChatShell, ChannelSidebar, MessageArea, ThreadPanel, SearchOverlay, NewMessageDialog, MessageTypeBadge, ChatPage (orphaned)
│   ├── forms/                             — FormRenderer, FormCard
│   ├── layout/                            — AuthProvider, Header, Sidebar, BottomTabBar
│   ├── patients/                          — PatientsView
│   ├── profile/                           — ProfileView
│   └── tasks/                             — TasksView
├── lib/
│   ├── auth.ts                            — JWT create/verify, getCurrentUser
│   ├── db.ts                              — Neon SQL helpers (original)
│   ├── db-v5.ts                           — v5 CRUD helpers (817 lines)
│   ├── form-registry.ts                   — 13 form schemas (1,541 lines)
│   ├── getstream.ts                       — Server client + helpers (236 lines)
│   └── getstream-setup.ts                 — Channel type definitions
├── providers/
│   └── ChatProvider.tsx                   — GetStream StreamChat client wrapper
└── types/
    └── index.ts                           — Shared TypeScript types (539 lines)
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
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "stream-chat": "^9.38.0"
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

You are continuing development of the Rounds app. The user (V) prefers:
- Ask clarifying questions before starting work
- Never truncate metric labels on mobile
- All info card items must be clickable to source data
- Use Indian number notation (Cr/L/K) where applicable
- Proceed step-by-step through the build order
- After each step: build verify → commit → push → test live → update progress
- ChatShell must ALWAYS stay mounted (hidden class, not conditional render)
- Use `h-full` not `h-screen` inside AppShell's tab layout

The build order document is at: `docs/ROUNDS-BUILD-ORDER.md`
The context seeds are at: `docs/context-seeds/`
The full ops suite documentation is at: `EHRC-OPS-SUITE-DOCUMENTATION.md`
