# Rounds — Thread Carryover Context Seed

**Purpose**: Paste this at the start of a new thread to restore full build context for continuing Rounds development. This captures everything a new session needs to pick up where we left off.

**Last updated**: 29 March 2026
**Current step**: Step 5.1 COMPLETE → Step 5.2 (Duty Roster Integration) is NEXT

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
| `GETSTREAM_API_SECRET` | Set in Vercel (server-only) |
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
- `readiness_items` — individual checklist items (per form), status: pending/confirmed/flagged/na
- `escalation_log` — escalation events with severity levels, auto/manual source
- `admission_tracker` — 42-column enriched admission record covering full Patient Journey v2
- `duty_roster` — shift-based duty with override support, resolves "who's on duty now?"

### 13 Form Types (defined in CHECK constraint):
marketing_cc_handoff, admission_advice, financial_counseling, ot_billing_clearance, admission_checklist, surgery_posting, pre_op_nursing_checklist, who_safety_checklist, nursing_shift_handoff, discharge_readiness, post_discharge_followup, daily_department_update, pac_clearance

---

## 6. GetStream Configuration

- **Org**: EHRC | **App ID**: 1563440 | **Region**: US Ohio
- **API Key** (public): `ekbhy4vctj9g`
- **5 Channel Types**: department, cross-functional, patient-thread, direct, ops-broadcast
- **23 Seeded Channels**: 17 department (one per EHRC dept) + 5 cross-functional (ops-daily-huddle, admission-coordination, discharge-coordination, surgery-coordination, emergency-escalation) + 1 broadcast (hospital-broadcast)
- **Auto-join on login**: Users auto-added to `hospital-broadcast` + their department channel

---

## 7. API Routes (27 total)

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

### Patient Workflow (10 routes — Step 3.2): ← NEWEST
- `GET/POST /api/patients` — list (stage+dept filters) / create patient thread
- `GET/PATCH /api/patients/[id]` — get (with form history) / partial update
- `GET/POST /api/forms` — list (type+patient+status filters) / submit form
- `GET /api/forms/[id]` — get form + readiness items + aggregate
- `GET /api/readiness/[formId]` — readiness items for a form
- `PATCH /api/readiness/items/[itemId]` — confirm/flag readiness item
- `GET /api/admission-tracker` — active (non-discharged) admissions
- `GET/POST /api/duty-roster` — list / create (admin-only)
- `DELETE /api/duty-roster/[id]` — remove entry (admin-only)
- `GET /api/duty-roster/resolve?department_id=X&role=Y` — resolve current on-duty

---

## 8. Build Progress Summary

| Step | Description | Status | Commit |
|------|------------|--------|--------|
| 0.1 | Project scaffold | ✅ Done | `2bc0609` |
| 0.2 | Custom auth (email+PIN) | ✅ Done | `b16b794` |
| 1.1 | Admin dashboard | ✅ Done | `b16b794` |
| 2.1 | GetStream foundation + token bridge | ✅ Done | `2d0ff9e` |
| 2.2 | Channel types + seed 23 channels | ✅ Done | `cdf57cd` |
| 2.3 | Chat UI shell (sidebar, messages) | ✅ Done | `7186689` |
| 2.4 | DMs, search, threading, reactions, files | ✅ Done | `1ada67c` |
| 3.1 | v5 database tables (6 tables, 30+ indexes) | ✅ Done | `f6f1d68` + `7b34efd` |
| 3.2 | API routes (10 files, 5 resource types) | ✅ Done | `3f34bc8` |
| 4.1 | Form Engine Core (registry, renderer, validation, readiness auto-gen) | ✅ Done | `66efcff` |
| 4.2 | Form-in-Chat + View Page | ✅ Done | `ab637f4` + `de24c0a` |
| 4.3 | Remaining form field enrichment (310 fields, 83 readiness) | ✅ Done | `8ca94f3` |
| 5.1 | Patient Thread + Channel Auto-Creation | ✅ Done | `19a8f7c` |
| **5.2** | **Duty Roster Integration** | **🔜 Next** | — |
| 5.1 | Patient thread + channel auto-creation | Pending | — |
| 5.2 | Duty roster UI + integration | Pending | — |
| 5.3 | Escalation engine | Pending | — |
| 6.1 | Admission tracker dashboard | Pending | — |
| 6.2 | 3-tab sidebar (Chats/Updates/Patients) | Pending | — |
| 7.1 | PWA (offline, push notifications) | Pending | — |
| 8.1 | AI gap analysis (Claude API) | Pending | — |
| 8.2 | AI daily briefing | Pending | — |
| 8.3 | Predictive intelligence | Pending | — |

---

## 9. What Step 5.1 (Next Step) Should Build

Phase 4 (Form Engine) is COMPLETE. The full form stack is live:
- `src/lib/form-registry.ts` (~1,541 lines): All 13 form schemas (310 fields, 83 readiness items)
- `src/components/forms/FormRenderer.tsx` (~350 lines): Dynamic renderer with completion bar
- `src/components/forms/FormCard.tsx` (~115 lines): Compact card for inline chat display
- `src/app/forms/[id]/page.tsx` (~335 lines): Read-only view with readiness tracker
- `/forms` page: form type picker grouped by stage (passes channel context)
- `/forms/new` page: full submission + draft flow (passes channel context to API)
- `/api/forms` POST: server validation, auto readiness items, completion scoring, GetStream form card posting
- MessageArea: "New Form" button in header + FormCard rendering for form_submission attachments

**Step 5.1 should**:
1. When a patient thread is created (via API), auto-create a GetStream `patient-thread` channel
2. Auto-add relevant staff to the channel: primary consultant, IP coordinator, department head
3. Set channel custom data: patient_thread_id, patient_name, current_stage, uhid
4. Stage transitions trigger channel membership changes (e.g., add OT coordinator when pre_op)
5. Create `/api/patients/[id]/stage` PATCH route for stage transitions

**Key design constraint**: Forms must work on mobile (Richa, V's boss, uses the dashboard on mobile). No truncated labels. All items must be tappable/clickable to source data.

---

## 10. Deferred / Known Issues

- **Superuser PIN**: Still `1234`. Must change via Neon SQL Editor directly (no admin UI for this).
- **Signup rate limiting**: Not implemented. Low priority for internal-only app.
- **Billing-coordination channel**: Identified as a gap from Patient Journey v2 analysis. Not yet created in GetStream.
- **`NEXTAUTH_URL` env var**: Legacy reference in code. Should grep and remove.
- **3-tab sidebar**: Deferred until forms exist (Step 4.x gives it content for the "Updates" and "Patients" tabs).
- **Test data cleanup**: "Test Patient Alpha" exists in production DB from verification. Should delete before go-live.

---

## 11. Key Personnel Context (Patient Journey v2)

- **IP Coordinators**: Tamanna & Kavya — SPOF for admission workflows, their process is being digitized
- **OT Coordinator**: Naveen Kumar — surgery scheduling
- **Customer Care**: Lavanya — handles marketing→admission handoff
- **AM (Admin Manager)**: Dr. Ankita Priya
- **Three EMR silos**: Even App (teleconsult), Pulse (OPD-only), KareXpert (IP HIS) — no auto-sync between them. Rounds runs parallel, does NOT attempt to integrate with KareXpert.

---

## 12. How to Resume Development

```bash
# Clone and setup
git clone https://github.com/vinaybhardwaj-commits/rounds.git
cd rounds
npm install

# Set env vars (get from Vercel dashboard)
# POSTGRES_URL, JWT_SECRET, NEXT_PUBLIC_GETSTREAM_API_KEY, GETSTREAM_API_SECRET

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

## 13. Instruction to AI Assistant

You are continuing development of the Rounds app. The user (V) prefers:
- Ask clarifying questions before starting work
- Never truncate metric labels on mobile
- All info card items must be clickable to source data
- Use Indian number notation (Cr/L/K) where applicable
- Proceed step-by-step through the build order (Step 4.1 is next)
- After each step: build verify → commit → push → test live → update progress

The build order document is at: `ROUNDS-BUILD-ORDER.md` in the workspace folder.
The full ops suite documentation is at: `EHRC-OPS-SUITE-DOCUMENTATION.md`.
