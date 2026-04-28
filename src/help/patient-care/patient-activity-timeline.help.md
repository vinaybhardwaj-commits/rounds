---
feature: patient-activity-timeline
title: Patient Activity Timeline (Audit log per patient)
roles: [super_admin, hospital_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/patient]
category: patient-care
related: [patient-detail, glass-mode-capability]
since: "2026-04-27"
keywords: [activity, audit, timeline, history, log, who, when, what, change, action, undo, mutation]
---

## What is this?

Every patient detail view has an **Activity** tab that shows the full timeline of mutations (every change anyone made to this patient's records). Tap a patient → tap the "Activity" tab (bottom nav).

The timeline answers: *who did what to this patient, and when?* — without you having to chase logs or ask the rest of the team. Each row shows:
- **Action** (e.g. "patient.create", "form.submit (consolidated_marketing_handoff)", "case.book_ot", "patient.discharge")
- **Summary** (1-line description: "Created surgical case for patient", "PAC scheduled for 28 Apr 2026", etc.)
- **Actor** (full name + role)
- **Timestamp** (relative: "12 min ago", "yesterday", "2d ago")
- **Source** (web / mobile / cron / system / admin_console — small pill on each row)

Visible to **every authenticated user** with access to that patient (i.e. every clinical user; hospital tenancy still applies — you can't see activity for a patient at a hospital you don't have access to).

## How to use it

**Open the timeline:**
1. Open a patient detail view.
2. Tap the **Activity** tab in the bottom navigation (between "Files" and "Forms").
3. The timeline loads with the most recent activity at the top, oldest at the bottom.
4. Tap **Refresh** (top-right of the timeline) to fetch the latest entries (new activity arrives in real-time, but a refresh forces a re-fetch).

**What you'll see in the timeline:**

The timeline includes activity from three sources:
1. **Patient record changes** — created, stage advanced, archived, discharged, edits to consultant/department/bed/etc.
2. **Form submissions** — every form filled for this patient (Marketing Handoff, PAC Clearance, Surgery Posting, etc.). Each row links to the form's version chain.
3. **Case mutations** — surgical case created, PAC scheduled, OT booked, equipment requested, condition cards added/reviewed, case cancelled or completed.

Plus undo events: if someone undid an action via the Undo banner, the timeline shows both the original action AND the `.undo` event.

**Drilling into an entry:**

Tap any row to expand it for full detail:
- **Before/after snapshot** — for state changes, you'll see the value before and after (e.g. stage went from `pre_op` to `admitted`).
- **Linked records** — if the action affected a form/case/equipment request, you see a quick link.
- **Source request** — for actions taken via API/admin console, you see the request ID for ops debugging.

## Common questions

**Q: Why don't I see activity from before April 27, 2026?**
A: The audit log was deployed on Apr 27. Activity before that wasn't captured. (The patient's record itself still shows fields like `created_at` for the initial creation event — but per-mutation history starts from the audit log launch.)

**Q: Can I filter the timeline (e.g. only show form submissions)?**
A: Not on the patient-level timeline yet. The admin-level audit log (super_admin only at `/admin/audit-log`) has filters. Per-patient filtering is on the v1.1 roadmap.

**Q: How far back does the timeline go?**
A: The `audit_log` table has a 90-day retention (a nightly cron archives older entries). Patient timelines auto-trim to the most recent 50 entries by default. Tap "Load more" for older entries up to 200.

**Q: I see an action I don't recognize ("case.book_ot" — what does that mean?)**
A: Each action follows a `domain.verb` pattern. Common ones:
- `patient.create`, `patient.discharge`, `patient.archive`, `patient.stage_advance`
- `form.submit`, `form.doctor_hospital_mismatch` (soft warning)
- `case.create`, `case.book_ot`, `case.cancel`, `pac.schedule`, `pac.publish_outcome`
- `equipment.request_create`, `equipment.request_update`
- `task.create`, `task.acknowledge`, `task.complete`, `task.cancel`
- `<action>.undo` — when an action was reversed via the Undo banner

**Q: Can I undo an action from the timeline?**
A: Not directly from the timeline — Undo only applies in the 24h window via the Undo banner that appears immediately after an action. After 24h, contact a super_admin to manually reverse.

**Q: I'm a nurse — can I see who created a patient or who submitted a form?**
A: Yes. The timeline is visible to every authenticated user with access to that patient. Identity + tenancy still apply (you only see patients in your hospital), but within that scope, every action is visible to every team member.

## Troubleshooting

**Problem: The Activity tab is empty even though I know there's been activity.**
Solution: Refresh. If still empty, the patient's `hospital_id` may have changed (e.g. moved to a different hospital) and your scope no longer matches. Try opening the Activity tab on a different patient first to confirm the feature works for you.

**Problem: I see an entry with no actor name (just "(unknown)").**
Solution: The actor's profile was deleted or anonymized. The audit log preserves the action but the actor reference is gone. This is rare — usually only when a staff member is deleted entirely.

**Problem: Two timeline entries seem to show the same action twice.**
Solution: Either two duplicate writes happened (rare; usually means a retry on a failed POST that actually succeeded the first time), OR the action was a transition+side effect pair (e.g. submitting a form ALSO updates the patient's stage — that's two log entries by design).

## Edge cases

- **Cron actions:** the SLA-sweeper, cleanup-audit, and other crons appear as actor "(system)" with source "cron." They don't have a human actor — that's normal.
- **Bulk actions:** if you bulk-archive 10 patients, you'll see 10 separate audit entries (one per patient). Click each patient's Activity tab to see the entry on their timeline.
- **Glass-mode capability:** the timeline now shows actions from all roles (clinical staff doing things they couldn't before Glass mode shipped). The action's actor_role lets you see who actually did what.
- **Cross-hospital admin actions:** super_admin actions on a patient appear in the timeline with the super_admin's name + role. Hospital_admin actions are scoped to their hospital.
- **Form submission AND its system messages:** submitting a marketing handoff produces ONE form.submit audit entry. The system messages it auto-posts to the patient's chat thread + marketing channel + department channel are NOT separate audit entries — they're side effects.
